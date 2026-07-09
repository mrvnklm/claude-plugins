# pinpoint — UI Redesign Handoff

**Purpose of this doc:** a self-contained brief to redesign the pinpoint **browser overlay UI** from scratch (state-of-the-art), in a fresh Claude session, without needing any prior conversation. Pair it with the `frontend-design` skill. The redesign is **UI-only**: it must remain a drop-in replacement that speaks the exact same bridge API and build pipeline described below.

---

## 1. What pinpoint is

A Claude Code **Channel plugin** for live in-browser UI annotation. You run your dev app, click UI elements in an overlay, type a note, and it streams into your running Claude Code session as a task. Claude works on it and reports status back, which the overlay shows live.

**The loop:**
```
browser overlay  →  POST /annotation  →  bridge  →  Claude session (channel push + get_inbox)
     ▲                                                        │
     └───────────  SSE /events  ◄── update_status MCP tool ◄──┘
```

The thing being redesigned is the **overlay** — the in-page UI. The bridge (a Node MCP server that also serves HTTP on `127.0.0.1:<port>`) and Claude side stay as-is.

---

## 2. Hard technical constraints (non-negotiable)

The overlay is **`src/overlay.js`**, bundled by esbuild (`build.mjs`, `platform=browser, format=iife`) into `bridge/overlay.dist.js`, which the bridge serves at `GET /overlay.js` and a host page injects via a `<script>` tag.

- **Shadow DOM, open mode.** Everything lives inside a single `host.attachShadow({mode:'open'})` so host-app CSS can't leak in and ours can't leak out. All styles are a single `<style>` block in the shadow root. Never mutate the target element's own styles.
- **Vanilla JS only.** No framework (no Vue/React). No build-time templating beyond esbuild.
- **Allowed deps:** `@medv/finder` (stable unique CSS selector) and `html-to-image` (`toJpeg`) only. No new runtime deps, no CDN/external fetches, no web fonts (`skipFonts:true` — capturing web fonts spams the host console with 404s).
- **XSS-safe:** every value injected into `innerHTML` goes through `escapeHtml`; status text goes via `textContent`.
- **Single instance:** guard on `window.__pinpointLoaded`.
- **z-index:** the host sits at `2147483647`; layered children (hover box, cart boxes, panel, toast) manage their own stacking below that.
- **Config:** read from the injecting `<script id="pinpoint-overlay" data-pinpoint-port="…" data-pinpoint-token="…">` dataset (fallback `window.__PINPOINT__`). Base URL is `http://127.0.0.1:<port>`.
- **Persistence:** `localStorage` keys currently in use — `pinpoint.tasks` (history array, bounded to 50), `pinpoint.dock` (`"float"|"dock"`), `pinpoint.fab` (`{side,top}`). Keep localStorage well under the ~5 MB quota (thumbnails are the risk — see §6).

---

## 3. Bridge API contract (the overlay MUST speak exactly this)

Base: `http://127.0.0.1:<port>`. Token from config, sent as header `X-Pinpoint-Token` on mutating calls.

| Method / path | Auth | Body | Response |
|---|---|---|---|
| `GET /health` | none | — | `{ok:true}` |
| `GET /overlay.js` | none | — | the bundled JS |
| `GET /events` | none | — | **SSE** stream; frames are `data: {json}\n\n` |
| `POST /annotation` | token | `{ task: string, items: Item[] }` | `{ok:true, task_id:"N"}` |
| `POST /followup` | token | `{ task_id: string, text: string }` | `{ok:true}` |

**`Item`** (one per picked element, sent in `/annotation`):
```ts
{
  selector: string,      // @medv/finder selector (or fallback nth-child path)
  url: string,           // location.href
  title: string,         // document.title
  viewport: { w:number, h:number },
  rect: { x:number, y:number, width:number, height:number },
  domPath: string,       // "body > main > div.card > button"
  outerHtml: string,     // sliced to ~2000 chars
  sourceHint?: string,   // data-v-inspector value if present
  screenshot?: string,   // JPEG data URL of the element (near-native, pixelRatio capped at 2)
}
```
Body size cap on the bridge is **24 MB** (a batch of JPEGs) → clean 413. Keep captures bounded.

**SSE status frame** (bridge → overlay, from Claude's `update_status`):
```ts
{ type: "status", task_id: string, status: "queued"|"working"|"done"|"blocked", note?: string }
```
Native `EventSource` auto-reconnects; just re-apply on message.

**IDs:** `task_id` is assigned by the bridge and returned from `/annotation`. Screenshots are persisted server-side as `.pinpoint/shot-<taskId>-<i>.jpg` (the overlay doesn't need to know the path).

---

## 4. Current UI surfaces & features (what exists today — v0.3.2)

The redesign should cover all of these functions; the *form* is open.

1. **Launcher** — an edge-anchored vertical **tab/flag** (not a floating circle) flush to the left/right viewport edge. Draggable up/down; drag across snaps to the other edge; a plain click (below a ~5px threshold) toggles the panel. Position+side persisted (`pinpoint.fab`). Also `Cmd/Ctrl+Shift+K`. Hidden while the sidebar is docked+open.
2. **Panel** — two modes, toggled in the header and persisted (`pinpoint.dock`):
   - **Floating** (default): bottom-right card, `width: min(340px, calc(100vw-40px))`.
   - **Docked**: full-height right sidebar (360px), page reflows via a `margin-right`/`width` set on `<html>` (+ a `--pinpoint-dock-width` custom prop). Suppressed below ~500px viewport (falls back to floating). No drop-shadow when docked (flush).
3. **Pick mode** — crosshair cursor; the element under the cursor gets a transient filled highlight box; clicking **adds** it to the cart (stays on to collect more). Must NOT highlight the overlay's own UI (hover-through fix). Dedup: the same selector can't be added twice.
4. **Cart** — list of picked elements: index badge, selector (monospace, ellipsis, must not overflow/overlap the remove ✕), a small **thumbnail**, remove button. Live count. Plus **persistent on-page highlight boxes** for every cart item (numbered, distinct from the hover box), tracking the live element on scroll/resize (rAF-throttled); hovering a cart row emphasizes its box.
5. **Compose** — a shared task `<textarea>` ("Was soll an diesen Elementen passieren?") + "Task senden (N)". Sends on `Shift+Enter` or `Cmd/Ctrl+Enter`; `Esc` closes.
6. **History ("Verlauf")** — persisted list of sent tasks. Each row: status badge (`queued/working/done/blocked`), `#id`, relative time, element count, note. **Expandable** (accordion, independent rows): expanded shows full note, `statusNote`, per-element thumbnails + selectors, and a follow-up input (`→`). Live status via SSE patches the row in place (no rebuild, preserves expand state + typed follow-up text). Bounded to 50 tasks; thumbnails downscaled (~240px q0.8), max 4 stored per task.
7. **Toast** — transient bottom feedback (ok / warn / err).

**Palette today:** single green accent `#10b981`, light surface `#fff`, greys. Status badges: queued grey, working amber, done green, blocked red.

---

## 5. Why we're redesigning (accumulated feedback)

Incremental tweaks got us far, but the user wants a **ground-up, state-of-the-art pass**. Recurring pain points:
- **Space usage / spacing** feels off — too much padding in places, cramped in others; not a tight, intentional rhythm.
- **History** looked minimalistic / not state-of-the-art (addressed partially with expandable rows, but the whole thing deserves a real design).
- **Thumbnail quality** was blurry (now 240px, but the visual treatment of imagery can be better).
- **Uniformity** — spacing around elements not consistent on all sides.
- General "this isn't state of the art yet."

Treat these as symptoms; the redesign should establish a coherent visual system rather than patch spots.

---

## 6. Redesign goals

- **A coherent, modern visual system**: type scale, spacing scale, radii, elevation, color — documented and applied consistently. Dense but breathable; every gap intentional and uniform.
- **Crisp imagery**: thumbnails and on-page highlights that look sharp on Retina; consistent aspect handling; no layout jump between placeholder and loaded image.
- **Clear information hierarchy** for the two dense lists (cart + history): scannable at a glance, details on demand (the expandable pattern is good — refine it).
- **Both layouts first-class**: floating card AND docked sidebar, each looking intentional (not one stretched into the other). Responsive from ~300px floating to a wide docked sidebar.
- **Dark-mode aware** (bonus): host apps are often dark (this one is a "stealth slate" dark UI). Consider `prefers-color-scheme` or a token set that reads well over any host — today's overlay is hard-light `#fff` only.
- **Accessible**: sufficient contrast, focus states, ≥44px tap targets on interactive controls, ARIA on the toggles/checkbox-like controls, respects `prefers-reduced-motion` for the expand animation and the tab drag.
- **Keep it lightweight**: still one vanilla-JS file + one `<style>` block; no perf regressions on scroll (the on-page highlight boxes re-position every frame while dragging/scrolling).

---

## 7. What MUST be preserved (functional contract)

- The bridge API calls & payload shapes in §3 (annotation/followup/SSE/health/overlay.js), the token header, the config injection, the `localStorage` responsibilities, and the esbuild build.
- Every capability in §4 (launcher, float/dock, pick+dedup, cart + on-page boxes, compose + send shortcuts, history + expand + follow-up + live SSE status, toast).
- The safety rails in §2 (Shadow DOM isolation, escapeHtml, single-instance guard, skipFonts, 24 MB-safe captures, no new deps).

## 8. Deliverable shape (suggested)

1. A short **design-system section** (tokens: color/spacing/type/radius/elevation, light + dark).
2. **Mockups** of: the edge tab, the floating panel (empty / picking / cart-with-items / composing), the docked sidebar, a history row (collapsed + expanded), the on-page highlight boxes, the toast.
3. Then implement it in `src/overlay.js` (single file), run `node build.mjs`, and verify it still speaks the API (smoke-test `/health`, `/overlay.js`, a `POST /annotation`, an SSE status round-trip).

---

## 9. Pointers

- Current source to read first: `src/overlay.js` (the overlay), `src/server.mjs` (the bridge — for the exact API), `build.mjs`, and the earlier design note `docs/2026-07-09-v0.3-design.md`.
- Repo: `mrvnklm/claude-plugins`, plugin dir `plugins/pinpoint/`. Install/dev: the built `bridge/*` must be synced to the installed plugin cache (`~/.claude/plugins/cache/mrvnklm/pinpoint/<version>/bridge/`) for a running session to pick it up; overlay changes then need only a **page reload**, bridge changes need a **session relaunch** with `--dangerously-load-development-channels plugin:pinpoint@mrvnklm`.
- To iterate visually against a real app, inject the overlay into any local dev app via a `<script src="http://127.0.0.1:<port>/overlay.js" data-pinpoint-port="<port>" data-pinpoint-token="<token>">` (values from `<cwd>/.pinpoint/config.json`).
