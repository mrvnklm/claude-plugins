// pinpoint bridge: a stdio MCP server ("Channel") that also runs a localhost
// HTTP listener used by the browser overlay to POST UI annotations.
//
// One-way channel (v1): annotations flow overlay -> bridge -> Claude Code as
// <channel source="pinpoint"> tags. No replies back to the overlay.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ---------------------------------------------------------------------------
// MCP server declaring the channel capability. The `experimental` capability
// key `claude/channel` is what makes Claude Code treat this as a Channel.
// ---------------------------------------------------------------------------
const mcp = new Server(
  { name: 'pinpoint', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions:
      'UI annotations from the pinpoint browser overlay arrive as ' +
      '<channel source="pinpoint"> tags. For each tag: read the screenshot PNG ' +
      'named in the "screenshot" attribute using the Read tool; use the ' +
      '"selector", "url" and "source_hint" attributes to locate the right ' +
      'component/source file (grep the selector or the source_hint path to find ' +
      'it); then implement the fix the note asks for. When several tags arrive ' +
      'together, treat them as one batch and handle them in order. This is a ' +
      'one-way channel (v1): do not attempt to reply back to the overlay.',
  }
)

// ---------------------------------------------------------------------------
// Config: <cwd>/.pinpoint/config.json = { port, token }. Bridge owns the file.
// ---------------------------------------------------------------------------
const cwd = process.cwd()
const dir = join(cwd, '.pinpoint')
mkdirSync(dir, { recursive: true })
const configPath = join(dir, 'config.json')

let config
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    console.error('pinpoint: failed to parse config.json, recreating:', err)
    config = null
  }
}
if (!config || typeof config.port !== 'number' || typeof config.token !== 'string') {
  config = {
    port: Number(process.env.PINPOINT_PORT) || 4849,
    token: randomUUID(),
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}
const { port, token } = config

// Incrementing annotation id (module-level).
let nextId = 1

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Pinpoint-Token',
}

function sendJson(res, status, obj) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const http = createServer(async (req, res) => {
  try {
    const method = req.method || 'GET'
    const url = (req.url || '/').split('?')[0]

    // Preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }

    if (method === 'GET' && url === '/health') {
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && url === '/overlay.js') {
      const overlayPath = join(__dirname, '..', 'bridge', 'overlay.dist.js')
      try {
        const js = readFileSync(overlayPath)
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/javascript' })
        res.end(js)
      } catch (err) {
        console.error('pinpoint: overlay.dist.js not readable:', err)
        sendJson(res, 404, { ok: false, error: 'overlay not found' })
      }
      return
    }

    if (method === 'POST' && url === '/annotation') {
      // 1. Token gate.
      if (req.headers['x-pinpoint-token'] !== token) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }

      const raw = await readBody(req)
      let data
      try {
        data = JSON.parse(raw || '{}')
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }

      const id = nextId++

      // 2. Persist screenshot if present.
      let screenshotPath
      if (typeof data.screenshot === 'string' && data.screenshot.length > 0) {
        try {
          const b64 = data.screenshot.replace(/^data:image\/png;base64,/, '')
          const buf = Buffer.from(b64, 'base64')
          screenshotPath = join(dir, `shot-${id}.png`)
          writeFileSync(screenshotPath, buf)
        } catch (err) {
          console.error('pinpoint: failed to write screenshot:', err)
          screenshotPath = undefined
        }
      }

      // 3. Build content + meta and notify Claude.
      const note = typeof data.note === 'string' ? data.note : ''
      const selector = typeof data.selector === 'string' ? data.selector : ''
      const pageUrl = typeof data.url === 'string' ? data.url : ''
      const title = typeof data.title === 'string' ? data.title : ''
      const vw = data.viewport && typeof data.viewport === 'object' ? data.viewport : {}
      const viewportStr = `${vw.w ?? ''}x${vw.h ?? ''}`

      const content = `${note}\n\n(pinpoint annotation on ${selector} at ${pageUrl})`

      const meta = {
        selector,
        url: pageUrl,
        title,
        id: String(id),
        viewport: viewportStr,
      }
      if (screenshotPath) meta.screenshot = screenshotPath
      if (typeof data.sourceHint === 'string' && data.sourceHint.length > 0) {
        meta.source_hint = data.sourceHint
      }

      try {
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: { content, meta },
        })
      } catch (err) {
        // No Claude peer connected (e.g. standalone smoke test) — fine.
        console.error('pinpoint: channel notification failed (no peer?):', err)
      }

      // 4. Respond.
      sendJson(res, 200, { ok: true, id })
      return
    }

    sendJson(res, 404, { ok: false, error: 'not found' })
  } catch (err) {
    console.error('pinpoint: request handler error:', err)
    try {
      sendJson(res, 500, { ok: false, error: 'internal error' })
    } catch {
      /* response may already be sent */
    }
  }
})

// Start listening regardless of whether a Claude peer attaches, so a standalone
// `node src/server.mjs` still opens the port for smoke testing.
http.listen(port, '127.0.0.1', () => {
  console.error(
    `pinpoint bridge listening on http://127.0.0.1:${port} (token in .pinpoint/config.json)`
  )
})

// Connect the stdio MCP transport so the process stays alive as an MCP server.
// connect() for stdio resolves immediately.
await mcp.connect(new StdioServerTransport())
