// pinpoint — Nuxt dev-only overlay injection
//
// 1. Copy this file to  plugins/pinpoint.client.ts  in your Nuxt project.
//    (The `.client.ts` suffix makes Nuxt run it in the browser only; Nuxt
//     auto-registers everything in `plugins/`, so DO NOT touch nuxt.config.ts.)
// 2. Replace __PORT__ and __TOKEN__ below with the `port` and `token` values
//    from  <project>/.pinpoint/config.json  (the bridge writes that file on its
//    first run).
// 3. Do NOT commit this file to production — it is a local dev tool. The
//    `import.meta.dev` guard already prevents it from ever running in a prod
//    build, but keeping it out of version control avoids leaking the token.

export default defineNuxtPlugin(() => {
  if (!import.meta.dev) return               // NEVER in production
  if (document.getElementById('pinpoint-overlay')) return
  const s = document.createElement('script')
  s.id = 'pinpoint-overlay'
  s.src = 'http://127.0.0.1:__PORT__/overlay.js'
  s.dataset.pinpointPort = '__PORT__'
  s.dataset.pinpointToken = '__TOKEN__'
  document.body.appendChild(s)
})
