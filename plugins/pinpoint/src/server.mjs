// pinpoint bridge: a stdio MCP server ("Channel") that also runs a localhost
// HTTP listener used by the browser overlay to POST UI annotations.
//
// Two-way channel (v0.2): task annotations flow overlay -> bridge -> Claude Code
// as <channel source="pinpoint" kind="task"> tags; status updates flow back
// Claude -> bridge -> overlay via the update_status MCP tool broadcast over a
// GET /events SSE stream. Follow-ups flow overlay -> bridge -> Claude too.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MAX_BODY_BYTES = 24 * 1024 * 1024 // 24 MB — a batch of JPEG screenshots can be big
const MAX_PORT_PROBES = 20 // how many ports to try if the preferred one is taken
const HEARTBEAT_MS = 25000 // SSE keep-alive comment interval

// ---------------------------------------------------------------------------
// MCP server declaring the channel capability. The `experimental` capability
// key `claude/channel` is what makes Claude Code treat this as a Channel. We
// also declare `tools` so the update_status tool is exposed (two-way).
// ---------------------------------------------------------------------------
const mcp = new Server(
  { name: 'pinpoint', version: '0.4.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions:
      'Task annotations from the pinpoint browser overlay arrive as ' +
      '<channel source="pinpoint" kind="task" id=".." count="N" ...> tags. The ' +
      'body has a shared task note followed by a numbered list of N elements, ' +
      'each with a screenshot path, a CSS selector and a source hint. Read every ' +
      'screenshot with the Read tool, use the selector/source hint to locate the ' +
      'right component/source file (grep the selector or the source_hint path), ' +
      'then apply the shared instruction across all N elements. Follow-ups arrive ' +
      'as <channel source="pinpoint" kind="followup" task_id=".."> tags — continue ' +
      'that task (its original task tag appears earlier in the session). ' +
      'IMPORTANT: call the update_status tool with the task_id and status "working" ' +
      'when you start and status "done" when finished (optionally a short note) — ' +
      'that is the ONLY way the user\'s overlay shows progress. ' +
      'Live channel pushes can be missed (plugin still loading, or the session ' +
      'launched without the development-channels flag), so ALSO call the get_inbox ' +
      'tool at session start and whenever the user asks whether a task arrived: it ' +
      'returns any queued tasks/follow-ups (same content format as the tags) that ' +
      'you may not have received live, and marks them delivered.',
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

// Seed the task counter above any screenshot already on disk, so a restart
// never clobbers a shot-<id>-<i>.jpg (or a legacy shot-<id>.png) that a still-
// open <channel> tag references.
let nextTaskId = 1
try {
  const maxN = readdirSync(dir)
    .map((f) => /^shot-(\d+)(?:-\d+)?\.(?:jpg|png)$/.exec(f))
    .filter(Boolean)
    .reduce((m, x) => Math.max(m, Number(x[1])), 0)
  nextTaskId = maxN + 1
} catch {
  /* dir just created / unreadable — start at 1 */
}

// ---------------------------------------------------------------------------
// Disk-backed inbox — the live-delivery safety net.
//
// mcp.notification() is fire-and-forget: if no channel consumer is attached at
// that instant (plugin still loading, or the session launched without
// --dangerously-load-development-channels) the task is silently lost. So every
// accepted /annotation and /followup is ALSO appended here as one JSON line, and
// the get_inbox MCP tool — a normal request/response call that works even
// WITHOUT the channel flag — drains the pending records. This is the reliable
// path; the live push stays as the happy-path fast lane.
//
// Lives under .pinpoint/ which is already git-ignored ('*'), so screenshots
// referenced by content never leak into version control.
// ---------------------------------------------------------------------------
const INBOX_MAX = 200 // bound both the file and the in-memory mirror to the last N
const inboxPath = join(dir, 'inbox.jsonl')
let inbox = [] // in-memory mirror of the records on disk

// Rewrite the whole file from the mirror. Used after trimming to the bound and
// after marking records delivered (an in-place flag flip needs a full rewrite).
function rewriteInbox() {
  try {
    writeFileSync(inboxPath, inbox.map((r) => JSON.stringify(r)).join('\n') + (inbox.length ? '\n' : ''))
  } catch (err) {
    console.error('pinpoint: failed to rewrite inbox.jsonl:', err)
  }
}

// Load the mirror on boot. A crash mid-append can leave a corrupt/partial
// trailing line — skip any line that won't parse, never crash startup.
function loadInbox() {
  if (!existsSync(inboxPath)) return
  let text
  try {
    text = readFileSync(inboxPath, 'utf8')
  } catch (err) {
    console.error('pinpoint: could not read inbox.jsonl:', err)
    return
  }
  const recs = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = JSON.parse(trimmed)
      if (rec && typeof rec === 'object') recs.push(rec)
    } catch {
      /* corrupt/partial line — skip it */
    }
  }
  if (recs.length > INBOX_MAX) {
    // File grew past the bound (or was hand-appended) — keep the tail, rewrite.
    inbox = recs.slice(-INBOX_MAX)
    rewriteInbox()
  } else {
    inbox = recs
  }
}

// Append one accepted task/follow-up. Cheap O(1) append in the common case; a
// full rewrite only when we cross the bound and have to drop the oldest.
function appendInbox(rec) {
  inbox.push(rec)
  if (inbox.length > INBOX_MAX) {
    inbox = inbox.slice(-INBOX_MAX)
    rewriteInbox()
  } else {
    try {
      appendFileSync(inboxPath, JSON.stringify(rec) + '\n')
    } catch (err) {
      console.error('pinpoint: failed to append inbox.jsonl:', err)
    }
  }
}

// Render one record for get_inbox in the SAME content format the channel tags
// carry, prefixed with its id/kind so Claude can act on it identically (the
// screenshot paths are already inside rec.content).
function renderInboxRecord(rec) {
  return `[pinpoint id=${str(rec.id)} kind=${str(rec.kind)}]\n${str(rec.content)}`
}

loadInbox()

// Constant-time token comparison (avoids a timing side channel on the gate).
function tokenOk(provided) {
  if (typeof provided !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// MCP tools: update_status is the return path (Claude -> overlay).
// ---------------------------------------------------------------------------
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'update_status',
      description:
        'Report progress on a pinpoint task back to the user\'s browser overlay. ' +
        'Call with status "working" when you start and "done" when finished.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: {
            type: 'string',
            description: 'queued|working|done|blocked',
          },
          note: { type: 'string' },
        },
        required: ['task_id', 'status'],
      },
    },
    {
      name: 'get_inbox',
      description:
        'Drain the pinpoint inbox: return any pinpoint tasks/follow-ups that were ' +
        'queued (including ones that may have been missed by the live channel push) ' +
        'in the same content format as the channel tags. Call this at session start ' +
        'and whenever the user asks whether a task arrived. Returned pending records ' +
        'are marked delivered so a later call does not repeat them.',
      inputSchema: {
        type: 'object',
        properties: {
          include_delivered: {
            type: 'boolean',
            description:
              'Include already-delivered records too (default false = pending only).',
          },
        },
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  if (name === 'update_status') {
    const task_id = args && args.task_id != null ? String(args.task_id) : ''
    const status = args && args.status != null ? String(args.status) : ''
    const note = args && typeof args.note === 'string' ? args.note : undefined
    broadcast({ type: 'status', task_id, status, note })
    return { content: [{ type: 'text', text: 'ok' }] }
  }
  if (name === 'get_inbox') {
    const includeDelivered = !!(args && args.include_delivered)
    // Snapshot the selected records first so we mark exactly what we return.
    const selected = inbox.filter((r) => includeDelivered || !r.delivered)
    if (selected.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: includeDelivered
              ? 'pinpoint inbox is empty.'
              : 'No pending pinpoint tasks — the inbox is drained.',
          },
        ],
      }
    }
    const body = selected.map(renderInboxRecord).join('\n\n---\n\n')
    const text = `${selected.length} pinpoint inbox record(s):\n\n${body}`
    // Side effect: mark the pending records we just handed over as delivered so
    // the next drain does not repeat them. include_delivered replays without
    // changing state for anything already delivered.
    let changed = false
    for (const r of selected) {
      if (!r.delivered) {
        r.delivered = true
        changed = true
      }
    }
    if (changed) rewriteInbox()
    return { content: [{ type: 'text', text }] }
  }
  return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
})

// ---------------------------------------------------------------------------
// SSE fan-out: the overlay opens GET /events; update_status broadcasts to all.
// ---------------------------------------------------------------------------
const sseListeners = new Set()

function broadcast(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`
  for (const res of sseListeners) {
    try {
      res.write(payload)
    } catch {
      /* a dead listener will fire 'close' and get removed */
    }
  }
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

// Coerce a value to a string, using a fallback for null/undefined/non-string.
function str(v, fallback = '') {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
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

    // ----- SSE stream: status updates flow back to the overlay -------------
    if (method === 'GET' && url === '/events') {
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      // Never let node close this socket on idle.
      if (typeof res.setTimeout === 'function') res.setTimeout(0)
      if (req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0)
      res.write(': connected\n\n')

      const heartbeat = setInterval(() => {
        try {
          res.write(':ka\n\n')
        } catch {
          /* ignore — 'close' will clean up */
        }
      }, HEARTBEAT_MS)
      if (typeof heartbeat.unref === 'function') heartbeat.unref()

      sseListeners.add(res)
      req.on('close', () => {
        clearInterval(heartbeat)
        sseListeners.delete(res)
      })
      return
    }

    // ----- Batch (or legacy single) annotation -> one channel task ---------
    if (method === 'POST' && url === '/annotation') {
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

      // Normalize batch vs legacy single into { task, items[] }.
      let task
      let items
      if (Array.isArray(data.items)) {
        task = str(data.task)
        items = data.items
      } else {
        // Legacy single shape: the whole body is one item; note is the task.
        task = str(data.note)
        items = [data]
      }
      if (!Array.isArray(items) || items.length === 0) {
        sendJson(res, 400, { ok: false, error: 'no items' })
        return
      }

      const taskId = nextTaskId++

      // Persist each item's screenshot as shot-<taskId>-<i>.jpg.
      const shotPaths = items.map((item, i) => {
        const shot = item && typeof item.screenshot === 'string' ? item.screenshot : ''
        if (!shot) return undefined
        try {
          const b64 = shot.replace(/^data:image\/\w+;base64,/, '')
          const buf = Buffer.from(b64, 'base64')
          const p = join(dir, `shot-${taskId}-${i}.jpg`)
          writeFileSync(p, buf)
          return p
        } catch (err) {
          console.error(`pinpoint: failed to write screenshot for item ${i}:`, err)
          return undefined
        }
      })

      const N = items.length
      const first = items[0] || {}
      const firstVp = first.viewport && typeof first.viewport === 'object' ? first.viewport : {}
      const firstViewport = `${firstVp.w ?? ''}x${firstVp.h ?? ''}`

      // Build the numbered element list.
      let lines = ''
      items.forEach((item, i) => {
        const selector = str(item && item.selector, '—') || '—'
        const pageUrl = str(item && item.url, '—') || '—'
        const source = str(item && item.sourceHint, '') || '—'
        const shotPath = shotPaths[i] || '—'
        lines += `${i + 1}. selector: ${selector} | url: ${pageUrl} | source: ${source} | screenshot: ${shotPath}\n`
      })

      const content =
        `${task}\n\n` +
        `Task #${taskId} — ${N} Element(e):\n` +
        lines +
        `\nRufe update_status({task_id:"${taskId}", status:"working"}) wenn du startest und status:"done" wenn fertig.`

      const meta = {
        id: String(taskId),
        count: String(N),
        url: str(first.url),
        title: str(first.title),
        viewport: firstViewport,
        kind: 'task',
      }

      // Safety net first: persist BEFORE the live push so a task is never lost
      // even if the notification (or this process) dies right after.
      appendInbox({ id: String(taskId), kind: 'task', content, meta, ts: Date.now(), delivered: false })

      try {
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: { content, meta },
        })
      } catch (err) {
        // No Claude peer connected (e.g. standalone smoke test) — fine, the
        // inbox record above still lets get_inbox deliver it later.
        console.error('pinpoint: channel notification failed (no peer?):', err)
      }

      sendJson(res, 200, { ok: true, task_id: String(taskId) })
      return
    }

    // ----- Follow-up on an existing task -----------------------------------
    if (method === 'POST' && url === '/followup') {
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

      const taskId = str(data.task_id)
      const text = str(data.text)
      if (!taskId || !text) {
        sendJson(res, 400, { ok: false, error: 'task_id and text required' })
        return
      }

      const content = `Follow-up zu Task #${taskId}:\n\n${text}`
      const meta = { task_id: taskId, kind: 'followup' }

      // Safety net first (see /annotation). id references the parent task_id;
      // the delivered flag — not the id — is what dedups drains, so reusing the
      // task_id here is safe even with several follow-ups on the same task.
      appendInbox({ id: taskId, kind: 'followup', content, meta, ts: Date.now(), delivered: false })

      try {
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: { content, meta },
        })
      } catch (err) {
        console.error('pinpoint: channel notification failed (no peer?):', err)
      }

      sendJson(res, 200, { ok: true })
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
  // Close any open SSE streams so http.close() can settle.
  for (const res of sseListeners) {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
  sseListeners.clear()
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
