# Injecting the pinpoint overlay (dev-only)

The overlay is a script served by the bridge at
`http://127.0.0.1:<port>/overlay.js`. To load it, inject a `<script>` tag into
your dev app that follows the **overlay config contract** below. The `port` and
`token` come from `<project>/.pinpoint/config.json`, which the bridge writes on
its first run:

```json
{ "port": 4849, "token": "<uuid>" }
```

> The injection must be **dev-only** — never ship it to production. Each snippet
> below is guarded (env check or localhost hostname check).

## Overlay config contract

However you inject it, the `<script>` element MUST carry these three attributes
so the overlay can read its config and authenticate to the bridge:

| attribute              | value                                        |
| ---------------------- | -------------------------------------------- |
| `id="pinpoint-overlay"`| fixed — also used to avoid double-injection  |
| `data-pinpoint-port`   | `port` from `.pinpoint/config.json`          |
| `data-pinpoint-token`  | `token` from `.pinpoint/config.json`         |

The overlay reads `data-pinpoint-token` and sends it as the `X-Pinpoint-Token`
header on `POST /annotation`; a mismatch is rejected with `403`.

## Nuxt

Use the ready template: copy
[`nuxt-inject-template.ts`](./nuxt-inject-template.ts) to
`plugins/pinpoint.client.ts` and fill in `__PORT__` / `__TOKEN__`. **Never edit
`nuxt.config.ts`** — Nuxt auto-registers `plugins/`, and the `.client.ts` suffix
+ `import.meta.dev` guard keep it browser- and dev-only.

## Plain Vite (main.ts / main.js)

Add this to your entry file, guarded by `import.meta.env.DEV` so it is
tree-shaken out of production builds:

```ts
// main.ts — pinpoint dev overlay
if (import.meta.env.DEV && !document.getElementById('pinpoint-overlay')) {
  const PORT = '4849'                 // from .pinpoint/config.json
  const TOKEN = '<uuid>'              // from .pinpoint/config.json
  const s = document.createElement('script')
  s.id = 'pinpoint-overlay'
  s.src = `http://127.0.0.1:${PORT}/overlay.js`
  s.dataset.pinpointPort = PORT
  s.dataset.pinpointToken = TOKEN
  document.body.appendChild(s)
}
```

## Plain HTML page

Guard by hostname so it only runs on your local dev host, and paste the values
from `.pinpoint/config.json`:

```html
<!-- pinpoint dev overlay — remove/skip in production -->
<script>
  (function () {
    var host = location.hostname
    if (host !== 'localhost' && host !== '127.0.0.1') return
    if (document.getElementById('pinpoint-overlay')) return
    var PORT = '4849'                // from .pinpoint/config.json
    var TOKEN = '<uuid>'             // from .pinpoint/config.json
    var s = document.createElement('script')
    s.id = 'pinpoint-overlay'
    s.src = 'http://127.0.0.1:' + PORT + '/overlay.js'
    s.dataset.pinpointPort = PORT
    s.dataset.pinpointToken = TOKEN
    document.body.appendChild(s)
  })()
</script>
```

Once injected, open your app, click an element, and type a note — it streams to
Claude as a `<channel source="pinpoint">` tag (see the pinpoint SKILL for how
Claude handles it).
