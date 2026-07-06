---
name: pinpoint
description: Use when the user wants to set up or use pinpoint — live in-browser UI annotation that streams clicked elements + notes into the Claude session. Triggers on "pinpoint", "annotate the UI", "live UI feedback", "inject the overlay", "point at elements in the browser".
---

# pinpoint

pinpoint is a Claude Code **Channel** plugin. A bundled MCP "bridge" runs a
localhost HTTP server and injects a browser overlay into your running dev app.
The overlay lets you **cart up several elements**, type one shared note, and send
them as a single **task**. The bridge pushes that task into the live Claude
session as one `<channel source="pinpoint" kind="task">` tag — carrying the note
plus a numbered list of the selected elements, each with its own screenshot, CSS
selector, URL, and source hint. You can then send **follow-ups** to a task, and
Claude reports progress **back** to the overlay via the `update_status` tool —
so v0.2 is a **two-way** channel.

## ⚠️ Requirement: launch with the channel flag

Channels are a research preview. A normal `/plugin install` is **not** enough to
activate the channel — the session must be started with the development-channels
flag:

```
claude --dangerously-load-development-channels plugin:pinpoint@mrvnklm
```

(`mrvnklm` is the marketplace name from `mrvnklm/claude-plugins`.)
Requires **Claude Code v2.1.80+** and an **Anthropic login** (channels are not
available on non-Anthropic providers). If the flag is missing, no pinpoint tags
will ever arrive no matter what the browser does.

## Setup (dev-only overlay injection)

The overlay is loaded by injecting a small dev-only `<script>` into your app that
points at the bridge. The bridge writes its port + token to
`<project>/.pinpoint/config.json` on first run:

```json
{ "port": 4849, "token": "<uuid>" }
```

Read that file to get the current `port` and `token`, then wire the injection:

### Nuxt

Create `plugins/pinpoint.client.ts` from the template in
[`docs/nuxt-inject-template.ts`](../../docs/nuxt-inject-template.ts), replacing
`__PORT__` and `__TOKEN__` with the values from `.pinpoint/config.json`.

**CRITICAL: never edit `nuxt.config.ts`.** Nuxt auto-registers files in
`plugins/`, so the client plugin is all that is needed. The `.client.ts` suffix
plus the `import.meta.dev` guard ensure it only ever runs in the browser during
development.

### Other frameworks

Point the user to [`docs/injection.md`](../../docs/injection.md) for Vite and
plain-HTML snippets. In every case the injected `<script>` must be **guarded so
it NEVER loads in production** (dev-only env check or localhost hostname check).

## Workflow — handling a `<channel source="pinpoint">` tag

### A task tag (`kind="task"`)

A task arrives as **one** tag that bundles **N** elements under a single shared
note. It looks like:

```
<channel source="pinpoint" kind="task" id="7" count="2" url="http://localhost:3000/settings" title="Settings — Acme" viewport="1440x900">Make these two controls emerald and match their padding

Task #7 — 2 Element(e):
1. selector: body > main > button.save | url: http://localhost:3000/settings | source: /src/SettingsForm.vue:42:7 | screenshot: /abs/project/.pinpoint/shot-7-0.jpg
2. selector: body > main > button.cancel | url: http://localhost:3000/settings | source: — | screenshot: /abs/project/.pinpoint/shot-7-1.jpg

Rufe update_status({task_id:"7", status:"working"}) wenn du startest und status:"done" wenn fertig.</channel>
```

The body is the **shared instruction** followed by a numbered list of the N
elements. Do this:

1. **Signal you started.** Call the `mcp__pinpoint__update_status` tool with
   `{ task_id: "7", status: "working" }`. This is the **only** way the user's
   overlay shows progress — do it before you dig in.
2. **Read every screenshot.** For each of the N items, Read the absolute
   `screenshot:` path (a `.jpg` on disk) to see exactly what is being pointed at.
   A path may be `—` if the browser could not capture that item.
3. **Locate each source.** Loop over the N items; for each use its `selector`,
   `url`, and `source` hint to find the responsible component/file:
   - `source` (when not `—`) is a `/src/File.vue:line:col` path from the nearest
     `[data-v-inspector]` — grep/open that file directly.
   - grep the `selector` (class names, ids, text) across the codebase.
   - the `url` maps to the route/page component.
4. **Apply the shared instruction across all N elements.** The note in the body
   applies to every listed element — implement it for each one.
5. **Signal you finished.** Call `mcp__pinpoint__update_status` with
   `{ task_id: "7", status: "done", note: "<short summary>" }` (use
   `status: "blocked"` with a `note` if you cannot proceed). Then report in the
   session as usual.

### A follow-up tag (`kind="followup"`)

A follow-up continues an existing task; its original `kind="task"` tag is earlier
in the session:

```
<channel source="pinpoint" kind="followup" task_id="7">Also round the corners while you're at it</channel>
```

Re-read the original Task #`task_id` context above, apply the extra instruction to
the same element(s), and call `update_status` again (`working` → `done`) exactly
as for a task.

### Legacy single-annotation tags

Older overlays (or the single-item back-compat path) may send a task with a single
element. Treat it as a one-item task — the flow above collapses to N = 1.

## Troubleshooting

- **No pinpoint tags ever arrive** → the session was not started with
  `--dangerously-load-development-channels plugin:pinpoint@mrvnklm`
  (channel not active). Restart Claude Code with the flag.
- **Overlay not visible in the browser** → injection not wired, wrong `port`, or
  wrong `token`. Confirm the `<script id="pinpoint-overlay">` is present in the
  page, that `data-pinpoint-port`/`data-pinpoint-token` match
  `.pinpoint/config.json`, and that the bridge is running (`GET /health` returns
  `{ ok: true }`).
- **POST /annotation returns 403** → token mismatch. Re-copy `token` from
  `.pinpoint/config.json` into the injected script (`data-pinpoint-token`).
- **Task status never updates in the overlay** → you did not call the
  `mcp__pinpoint__update_status` tool (`working` on start, `done` on finish), or
  the overlay's SSE stream to `GET /events` is not connected. Confirm the bridge
  is running and that you invoked `update_status` with the correct `task_id`.
