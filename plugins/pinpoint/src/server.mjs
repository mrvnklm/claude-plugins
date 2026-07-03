// pinpoint bridge: a stdio MCP server ("Channel") that also runs a localhost
// HTTP listener used by the browser overlay to POST UI annotations.
//
// One-way channel (v1): annotations flow overlay -> bridge -> Claude Code as
// <channel source="pinpoint"> tags. No replies back to the overlay.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MAX_BODY_BYTES = 12 * 1024 * 1024 // 12 MB — a base64 screenshot of a large element can be big
const MAX_PORT_PROBES = 20 // how many ports to try if the preferred one is taken

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
// Config: <cwd>/.pinpoint/{config.json,.gitignore}. Bridge owns these.
// ---------------------------------------------------------------------------
const cwd = process.cwd()
const dir = join(cwd, '.pinpoint')
mkdirSync(dir, { recursive: true })

// The token is the ONLY gate on the bridge, and screenshots may contain PII —
// keep the whole .pinpoint/ directory out of version control.
const gitignorePath = join(dir, '.gitignore')
if (!existsSync(gitignorePath)) {
  try {
    writeFileSync(gitignorePath, '*\n')
  } catch (err) {
    console.error('pinpoint: could not write .pinpoint/.gitignore:', err)
  }
}

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
if (!config || typeof config.token !== 'string') {
  config = { port: undefined, token: randomUUID() }
}
const token = config.token
// Preferred port: explicit env override wins, else the last-used port, else 4849.
const desiredPort = Number(process.env.PINPOINT_PORT) || Number(config.port) || 4849

function persistConfig(actualPort) {
  config.port = actualPort
  try {
    writeFileSync(configPath, JSON.stringify({ port: config.port, token: config.token }, null, 2))
  } catch (err) {
    console.error('pinpoint: failed to write config.json:', err)
  }
}

// Seed the annotation id above any screenshot already on disk, so a restart
// never clobbers a shot-<id>.png that a still-open <channel> tag references.
let nextId = 1
try {
  const maxN = readdirSync(dir)
    .map((f) => /^shot-(\d+)\.png$/.exec(f))
    .filter(Boolean)
    .reduce((m, x) => Math.max(m, Number(x[1])), 0)
  nextId = maxN + 1
} catch {
  /* dir just created / unreadable — start at 1 */
}

// Constant-time token comparison (avoids a timing side channel on the gate).
function tokenOk(provided) {
  if (typeof provided !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

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

// Sentinel returned by readBody when the request body exceeds the size cap, so
// the handler can answer a clean 413 instead of the socket being reset.
const TOO_LARGE = Symbol('too-large')

// Read the request body with a hard size cap so a giant capture can't blow up
// memory or stall the event loop.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (c) => {
      if (over) return // keep draining so we can still send a response, but stop buffering
      size += c.length
      if (size > MAX_BODY_BYTES) {
        over = true
        chunks.length = 0 // release what we buffered
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(over ? TOO_LARGE : Buffer.concat(chunks).toString('utf8')))
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
      if (!tokenOk(req.headers['x-pinpoint-token'])) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }

      let raw
      try {
        raw = await readBody(req)
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'read error' })
        return
      }
      if (raw === TOO_LARGE) {
        sendJson(res, 413, { ok: false, error: 'payload too large' })
        return
      }

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

// ---------------------------------------------------------------------------
// Listen, with automatic fallback if the preferred port is taken (two projects
// each run their own bridge). The actual port is persisted to config.json so
// the overlay injection — generated from that file — always matches.
// ---------------------------------------------------------------------------
let steadyErrorAttached = false

function tryListen(port, attemptsLeft) {
  function cleanup() {
    http.removeListener('error', onError)
    http.removeListener('listening', onListening)
  }
  function onError(err) {
    cleanup()
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.error(`pinpoint: port ${port} in use, trying ${port + 1}`)
      tryListen(port + 1, attemptsLeft - 1)
    } else {
      console.error('pinpoint: HTTP server failed to bind:', err)
      process.exit(1)
    }
  }
  function onListening() {
    cleanup()
    if (!steadyErrorAttached) {
      http.on('error', (e) => console.error('pinpoint: HTTP error:', e))
      steadyErrorAttached = true
    }
    if (port !== config.port) persistConfig(port)
    if (port !== desiredPort) {
      console.error(
        `pinpoint: NOTE bound to ${port} instead of ${desiredPort}; .pinpoint/config.json updated — regenerate the overlay injection with the new port.`
      )
    }
    console.error(
      `pinpoint bridge listening on http://127.0.0.1:${port} (token in .pinpoint/config.json)`
    )
  }
  http.once('error', onError)
  http.once('listening', onListening)
  http.listen(port, '127.0.0.1')
}

// Start the HTTP listener regardless of whether a Claude peer attaches, so a
// standalone `node bridge/server.mjs` still opens the port for smoke testing.
tryListen(desiredPort, MAX_PORT_PROBES)

// ---------------------------------------------------------------------------
// Lifecycle: die with the session. When Claude Code closes the stdio pipe (or
// on a signal), shut the HTTP listener and exit so we don't linger holding the
// port and crash the next session with EADDRINUSE.
// ---------------------------------------------------------------------------
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    http.close()
  } catch {
    /* ignore */
  }
  process.exit(0)
}

const transport = new StdioServerTransport()
transport.onclose = shutdown
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown)

// Connect the stdio MCP transport so the process stays alive as an MCP server.
// connect() for stdio resolves immediately.
await mcp.connect(transport)
