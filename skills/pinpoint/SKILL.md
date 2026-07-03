---
name: pinpoint
description: Use when the user wants to set up or use pinpoint — live in-browser UI annotation that streams clicked elements + notes into the Claude session. Triggers on "pinpoint", "annotate the UI", "live UI feedback", "inject the overlay", "point at elements in the browser".
---

# pinpoint

pinpoint is a Claude Code **Channel** plugin. A bundled MCP "bridge" runs a
localhost HTTP server and injects a browser overlay into your running dev app.
When you click an element and type a note, the overlay POSTs it to the bridge,
which pushes it into the live Claude session as a `<channel source="pinpoint">`
tag — carrying the note, a screenshot, the CSS selector, the URL, and a source
hint. This lets you point at real UI in your browser and have Claude act on it
directly.

## ⚠️ Requirement: launch with the channel flag

Channels are a research preview. A normal `/plugin install` is **not** enough to
activate the channel — the session must be started with the development-channels
flag:

```
claude --dangerously-load-development-channels plugin:pinpoint@<marketplace>
```

Replace `<marketplace>` with the marketplace the plugin was installed from.
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

When a tag arrives, it looks like:

```
<channel source="pinpoint" selector="body > main > button.save" url="http://localhost:3000/settings" screenshot="/abs/project/.pinpoint/shot-1.png" source_hint="/src/SettingsForm.vue:42:7" id="1">Make this button green</channel>
```

Do this:

1. **Read the screenshot.** Use the Read tool on the absolute path in the
   `screenshot` attribute (it is a PNG on disk) to see exactly what the user is
   pointing at. It may be absent if the browser could not capture one.
2. **Locate the source.** Use `selector`, `url`, and `source_hint` to find the
   responsible component/file:
   - `source_hint` (when present) is a `/src/File.vue:line:col` path from the
     nearest `[data-v-inspector]` — grep/open that file directly.
   - grep the `selector` (class names, ids, text) across the codebase.
   - the `url` maps to the route/page component.
3. **Implement the fix** described in the note text (the tag body).
4. **Batch:** if several tags arrive together, treat them as one batch and handle
   them in order.
5. **One-way in v1:** do not try to message the overlay back — there is no return
   channel. Just act and report normally in the session.

## Troubleshooting

- **No pinpoint tags ever arrive** → the session was not started with
  `--dangerously-load-development-channels plugin:pinpoint@<marketplace>`
  (channel not active). Restart Claude Code with the flag.
- **Overlay not visible in the browser** → injection not wired, wrong `port`, or
  wrong `token`. Confirm the `<script id="pinpoint-overlay">` is present in the
  page, that `data-pinpoint-port`/`data-pinpoint-token` match
  `.pinpoint/config.json`, and that the bridge is running (`GET /health` returns
  `{ ok: true }`).
- **POST /annotation returns 403** → token mismatch. Re-copy `token` from
  `.pinpoint/config.json` into the injected script (`data-pinpoint-token`).
