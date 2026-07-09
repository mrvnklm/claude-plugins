// pinpoint/overlay.js — v0.4
// In-browser annotation overlay. Bundled by esbuild (platform=browser, format=iife)
// into bridge/overlay.dist.js and injected into the host page by the bridge.
//
// v0.4 — pixel-faithful visual rebuild on the approved "teal blueprint" design
// system (IBM Plex Sans/Mono, teal #0D9488 accent, hairline borders, 3–6px radii,
// light-first with a prefers-color-scheme dark layer). 100% of the v0.2/v0.3
// behavior is preserved:
//   - Edge launcher FLAG (dark ink vertical tab, teal accent strip, vertical
//     "PINPOINT" label) + Cmd/Ctrl+Shift+K shortcut open the panel & pick mode.
//   - In pick mode the element under the cursor is highlighted; each CLICK ADDS
//     that element to the cart (selector, dom path, rect, outerHTML, + a JPEG
//     screenshot) and pick mode STAYS ON so more elements can be collected.
//   - The panel shows the cart (per-item remove + live count + on-page highlight
//     boxes), a shared task <textarea>, and "Send task (N) →". Send POSTs
//     { task, items[] } to /annotation.
//   - On success the task is pushed into a persisted HISTORY list; each row
//     carries a status dot (queued/working/done/blocked) and a follow-up input
//     that POSTs { task_id, text } to /followup.
//   - Status updates stream back over an SSE EventSource(/events) and patch the
//     matching history row live.
//   - NEW states: empty, offline (health-poll + banner + disabled send), and a
//     2-line "Show more" note clamp.
//
// Everything lives inside a Shadow DOM so host-app CSS can't leak in and our CSS
// can't leak out. We never mutate the target element's own styles.

import { finder } from '@medv/finder';
import { toJpeg } from 'html-to-image';

// ---------------------------------------------------------------------------
// 0. Double-injection guard
// ---------------------------------------------------------------------------
if (window.__pinpointLoaded) {
  // Already running in this document — bail out silently.
} else {
  window.__pinpointLoaded = true;
  init();
}

function init() {
  // -------------------------------------------------------------------------
  // 1. Read config (port + token) from the injecting <script> tag.
  // -------------------------------------------------------------------------
  const cfg = readConfig();
  const base = `http://127.0.0.1:${cfg.port}`;
  const token = cfg.token;
  const hostLabel = `127.0.0.1:${cfg.port}`; // shown in the offline banner

  const TASKS_KEY = 'pinpoint.tasks';
  const SOFT_LIMIT = 8; // soft-warn if the cart grows beyond this

  // -------------------------------------------------------------------------
  // 2. Build the Shadow DOM UI.
  // -------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = '__pinpoint_host';
  // Keep the host itself out of layout/paint flow; the fixed children position
  // themselves relative to the viewport.
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;';
  document.body.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      /* ===================================================================
         Design tokens — light-first, dark via prefers-color-scheme.
         Fonts use graceful stacks (NO external <link>: we never fetch web
         fonts — captures use skipFonts:true and the constraint forbids it).
         =================================================================== */
      :host {
        all: initial;

        --pp-sans: 'IBM Plex Sans', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        --pp-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

        /* surfaces + ink */
        --pp-paper: #FBFBF9;
        --pp-sub: #F0F0EC;
        --pp-ink: #14161C;
        --pp-text: #14161C;
        --pp-field: #ffffff;

        /* muted text */
        --pp-muted: rgba(20,22,28,.55);
        --pp-muted-2: rgba(20,22,28,.4);

        /* accent (teal) */
        --pp-accent: #0D9488;
        --pp-accent-soft: #DDF0EE;
        --pp-accent-soft-2: #E3F3F1;
        --pp-accent-glow: rgba(13,148,136,.3);
        --pp-on-accent: #ffffff;

        /* borders / hairlines */
        --pp-border: rgba(20,22,28,.14);
        --pp-border-10: rgba(20,22,28,.10);
        --pp-border-08: rgba(20,22,28,.08);

        /* elevation */
        --pp-shadow-panel: 0 8px 28px rgba(20,22,28,.16);
        --pp-shadow-float: 0 6px 22px rgba(20,22,28,.12);
        --pp-shadow-btn: 0 2px 10px rgba(13,148,136,.3);

        /* segmented control active pill */
        --pp-seg-fg: rgba(20,22,28,.55);
        --pp-seg-active-bg: #14161C;
        --pp-seg-active-fg: #ffffff;

        /* status dots + soft callout backgrounds */
        --pp-st-queued: #64748B;   --pp-st-queued-bg: #F0F0EC;
        --pp-st-working: #B45309;  --pp-st-working-bg: #FBEFDD;
        --pp-st-done: #15803D;     --pp-st-done-bg: #E4F3E9;
        --pp-st-blocked: #DC2626;  --pp-st-blocked-bg: #FBE7E7;

        /* history expanded tint + flag */
        --pp-hist-exp: #EFF9F7;
        --pp-flag-bg: #14161C;
        --pp-flag-fg: #ffffff;

        /* toast */
        --pp-toast-bg: #14161C;
        --pp-toast-fg: #ffffff;
        --pp-toast-ok: #34D3B8;
        --pp-toast-warn: #F5B041;
        --pp-toast-err: #F87171;

        /* thumbnail placeholder stripe */
        --pp-stripe: repeating-linear-gradient(135deg,#F0F0EC 0 5px,#E4E4DE 5px 10px);
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --pp-paper: #101219;
          --pp-sub: #171922;
          --pp-ink: #F0F0EC;
          --pp-text: #E7E7E3;
          --pp-field: #1a1d27;

          --pp-muted: rgba(255,255,255,.55);
          --pp-muted-2: rgba(255,255,255,.4);

          --pp-accent: #34D3B8;
          --pp-accent-soft: rgba(52,211,184,.16);
          --pp-accent-soft-2: rgba(52,211,184,.12);
          --pp-accent-glow: rgba(52,211,184,.32);
          --pp-on-accent: #06231f;

          --pp-border: rgba(255,255,255,.12);
          --pp-border-10: rgba(255,255,255,.10);
          --pp-border-08: rgba(255,255,255,.07);

          --pp-shadow-panel: 0 8px 28px rgba(0,0,0,.5);
          --pp-shadow-float: 0 6px 22px rgba(0,0,0,.45);
          --pp-shadow-btn: 0 2px 10px rgba(52,211,184,.28);

          --pp-seg-fg: rgba(255,255,255,.55);
          --pp-seg-active-bg: rgba(255,255,255,.14);
          --pp-seg-active-fg: #F0F0EC;

          --pp-st-queued: #94A3B8;   --pp-st-queued-bg: rgba(148,163,184,.14);
          --pp-st-working: #F5B041;  --pp-st-working-bg: rgba(245,176,65,.14);
          --pp-st-done: #5FD38B;     --pp-st-done-bg: rgba(95,211,139,.14);
          --pp-st-blocked: #F87171;  --pp-st-blocked-bg: rgba(248,113,113,.14);

          --pp-hist-exp: rgba(52,211,184,.08);
          --pp-flag-bg: #1b1e29;
          --pp-flag-fg: #F0F0EC;

          --pp-stripe: repeating-linear-gradient(135deg,#242736 0 5px,#20232f 5px 10px);
        }
      }

      * {
        box-sizing: border-box;
        font-family: var(--pp-sans);
      }

      /* ===================================================================
         Edge launcher FLAG — dark ink vertical tab flush to the edge, rounded
         outer corners, a thin teal accent strip, a vertical "PINPOINT" label.
         Draggable up/down; drag across snaps to the other edge; a plain click
         (below the drag threshold) toggles the panel. Offsets set by positionTab().
         =================================================================== */
      .tab {
        position: fixed;
        width: 28px; height: 104px;
        background: var(--pp-flag-bg); color: var(--pp-flag-fg);
        border: none; cursor: grab; padding: 0;
        box-shadow: 0 3px 12px rgba(20,22,28,.28);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483647;
        transition: box-shadow .15s, background .15s;
        /* prevent the browser from turning a vertical drag into a page scroll
           on touch, and stop text-selection while dragging */
        touch-action: none; user-select: none; -webkit-user-select: none;
      }
      .tab > * { pointer-events: none; }
      .tab.side-left  { left: 0;  border-radius: 0 6px 6px 0; }
      .tab.side-right { right: 0; border-radius: 6px 0 0 6px; }
      .tab:hover { box-shadow: 0 5px 16px rgba(20,22,28,.34); }
      .tab.dragging { cursor: grabbing; transition: none; opacity: .95; }
      /* the teal accent strip sits on the flush edge */
      .tab .tab-accent {
        position: absolute; top: 12px; width: 4px; height: 80px;
        background: var(--pp-accent); transition: top .15s, height .15s, background .15s;
      }
      .tab.side-left  .tab-accent { left: 0;  border-radius: 0 2px 2px 0; }
      .tab.side-right .tab-accent { right: 0; border-radius: 2px 0 0 2px; }
      .tab .tab-label {
        font: 600 9px var(--pp-mono); letter-spacing: .16em; color: var(--pp-flag-fg);
        writing-mode: vertical-rl; transform: rotate(180deg);
      }
      /* Active (picking) tint: the accent strip fills the full height + a teal glow. */
      .tab.active { box-shadow: 0 3px 16px var(--pp-accent-glow); }
      .tab.active .tab-accent { top: 0; height: 100%; }

      /* ===================================================================
         Transient hover highlight box (dashed teal outline + soft fill + a
         selector label chip) drawn over the element under the cursor.
         =================================================================== */
      .highlight {
        position: fixed; pointer-events: none; z-index: 2147483646;
        outline: 1px dashed var(--pp-accent); outline-offset: 2px;
        background: rgba(13,148,136,.16);
        border-radius: 3px; display: none;
      }
      .highlight .hl-chip {
        position: absolute; bottom: -18px; left: 0;
        background: var(--pp-ink); color: var(--pp-paper);
        font: 500 8px var(--pp-mono); padding: 2px 6px; border-radius: 3px;
        white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis;
      }

      /* ===================================================================
         Persistent on-page highlight boxes for every cart item — a solid teal
         numbered outline; hovering the matching cart row emphasizes it (dashed
         + soft fill). Positioned via getBoundingClientRect each frame.
         =================================================================== */
      .cart-highlights { position: fixed; inset: 0; pointer-events: none; z-index: 2147483644; }
      .cart-hl {
        position: fixed; pointer-events: none; display: none;
        outline: 2px solid var(--pp-accent); outline-offset: 2px; border-radius: 2px;
        transition: background .1s, outline-color .1s;
      }
      .cart-hl .num {
        position: absolute; top: -9px; left: -2px;
        background: var(--pp-accent); color: var(--pp-on-accent);
        font: 700 9px var(--pp-mono); padding: 1px 5px; border-radius: 3px;
        box-shadow: 0 1px 3px rgba(20,22,28,.35);
      }
      .cart-hl.emph {
        outline-style: dashed; background: rgba(13,148,136,.18);
      }

      /* ===================================================================
         Panel — floating card (default) or docked right sidebar.
         =================================================================== */
      .panel {
        position: fixed; bottom: 80px; right: 20px;
        /* Never wider than the viewport (minus the 20px right + a small left gap). */
        width: min(340px, calc(100vw - 40px));
        max-height: calc(100vh - 110px);
        background: var(--pp-paper); color: var(--pp-text);
        border-radius: 6px; border: 1px solid var(--pp-border);
        box-shadow: var(--pp-shadow-panel);
        z-index: 2147483647; display: none;
        overflow: hidden; flex-direction: column;
      }
      .panel.open { display: flex; }

      /* Docked mode: full-height right sidebar. The page reflows via a
         margin/width set on <html> by updateLayout(); this styles the panel. */
      .panel.docked {
        top: 0; right: 0; bottom: auto; left: auto;
        width: 360px; height: 100vh; max-height: none;
        border-radius: 0; border: none;
        border-left: 1px solid var(--pp-border-10);
        box-shadow: none;
      }

      /* Header */
      .hd {
        position: relative;
        display: flex; align-items: center; gap: 8px;
        padding: 12px 14px; border-bottom: 1px solid var(--pp-border-10);
        flex: 0 0 auto;
      }
      .hd-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--pp-accent); flex: 0 0 auto; transition: background .15s;
      }
      .hd.offline .hd-dot { background: var(--pp-st-blocked); }
      .hd-ttl { font: 700 12px var(--pp-sans); letter-spacing: .02em; color: var(--pp-ink); }
      .hd-ver { font: 400 9px var(--pp-mono); color: var(--pp-muted-2); }
      .hd-offline {
        display: none; font: 500 8px var(--pp-mono); color: var(--pp-st-blocked);
        margin-left: 4px;
      }
      .hd.offline .hd-offline { display: inline; }
      .hd-ctrls { margin-left: auto; display: flex; gap: 2px; align-items: center; }
      .seg-btn {
        width: 26px; height: 26px; border: none; background: transparent; cursor: pointer;
        border-radius: 5px; color: var(--pp-seg-fg);
        font: 500 12px var(--pp-sans); display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .seg-btn:hover { color: var(--pp-ink); }
      .seg-btn.active { background: var(--pp-seg-active-bg); color: var(--pp-seg-active-fg); }
      .hd-x {
        width: 26px; height: 26px; border: none; background: transparent; cursor: pointer;
        border-radius: 5px; color: var(--pp-seg-fg);
        font: 500 13px var(--pp-sans); display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .hd-x:hover { color: var(--pp-ink); }

      /* Picking overlay: the whole header turns teal with "Picking…" + ESC chip. */
      .hd-pick {
        position: absolute; inset: 0; display: none;
        align-items: center; gap: 8px; padding: 12px 14px;
        background: var(--pp-accent); color: var(--pp-on-accent);
      }
      .hd.picking .hd-pick { display: flex; }
      .hd-pick .pk-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pp-on-accent); flex: 0 0 auto; }
      .hd-pick .pk-ttl { font: 700 12px var(--pp-sans); letter-spacing: .02em; }
      .hd-pick .esc-chip {
        margin-left: auto; font: 600 10px var(--pp-mono); border-radius: 4px;
        padding: 3px 9px; background: rgba(255,255,255,.2); color: var(--pp-on-accent);
        cursor: pointer;
      }

      /* Scroll body */
      .body { overflow-y: auto; flex: 1 1 auto; }

      /* Section frame */
      .sec { padding: 13px 14px; border-bottom: 1px solid var(--pp-border-10); }

      /* Offline banner */
      .offline-banner {
        display: none; margin: 13px 14px 0;
        background: var(--pp-st-blocked-bg); border-radius: 5px; padding: 9px 10px;
      }
      .offline-banner .ob-title { font: 600 10px var(--pp-sans); color: var(--pp-st-blocked); margin: 0 0 3px; }
      .offline-banner .ob-sub { font: 400 9px var(--pp-mono); color: var(--pp-st-blocked); opacity: .9; margin: 0; }
      .offline-banner .ob-retry { opacity: .7; }

      /* Primary pick button */
      .pick-btn {
        width: 100%; height: 42px; background: var(--pp-accent); color: var(--pp-on-accent);
        border: none; border-radius: 6px; cursor: pointer;
        font: 600 12px var(--pp-sans); letter-spacing: .01em;
        box-shadow: var(--pp-shadow-btn);
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .pick-btn:hover { filter: brightness(1.04); }
      .pick-btn.active { box-shadow: 0 0 0 2px var(--pp-accent-glow), var(--pp-shadow-btn); }
      .pick-glyph { font-size: 14px; line-height: 1; }
      .pick-help {
        display: none; font: 400 10px/1.6 var(--pp-sans); color: var(--pp-muted);
        margin: 12px 0 0; text-align: center;
      }

      /* Cart section */
      .cart-hd { display: flex; align-items: center; padding: 0 0 9px; }
      .cart-hd .cart-lbl { font: 600 10px var(--pp-sans); letter-spacing: .02em; color: var(--pp-muted); }
      .cart-hd .cart-pill {
        margin-left: auto; font: 600 9px var(--pp-sans); color: var(--pp-accent);
        background: var(--pp-accent-soft); border-radius: 20px; padding: 3px 10px;
      }
      .cart-list { display: flex; flex-direction: column; }
      .cart-empty {
        text-align: center; padding: 14px 6px 4px;
      }
      .cart-empty .ce-glyph {
        width: 34px; height: 34px; margin: 0 auto 12px;
        border: 1.5px dashed var(--pp-border); border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font: 400 15px var(--pp-sans); color: var(--pp-muted-2);
      }
      .cart-empty .ce-title { font: 600 11px var(--pp-sans); color: var(--pp-ink); margin: 0 0 4px; }
      .cart-empty .ce-sub { font: 400 9.5px/1.5 var(--pp-sans); color: var(--pp-muted); margin: 0; }

      /* Cart row: [idx] [52x34 thumb] [selector (flex, ellipsis)] [remove ✕].
         The ✕ is flex:none so a long selector can never overlap it. */
      .cart-item {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 0; border-bottom: 1px solid var(--pp-border-08);
      }
      .cart-item:last-child { border-bottom: none; }
      .ci-idx {
        flex: 0 0 auto; width: 20px; height: 20px;
        background: var(--pp-accent-soft); color: var(--pp-accent); border-radius: 5px;
        font: 700 10px var(--pp-sans); display: flex; align-items: center; justify-content: center;
      }
      .ci-thumb-wrap { flex: 0 0 auto; width: 52px; height: 34px; border-radius: 4px; overflow: hidden; }
      .ci-thumb { width: 52px; height: 34px; object-fit: cover; display: block; }
      .ci-thumb.placeholder {
        width: 52px; height: 34px; background: var(--pp-stripe);
        display: flex; align-items: center; justify-content: center;
        color: var(--pp-muted-2); font-size: 11px;
      }
      .ci-sel {
        flex: 1 1 auto; min-width: 0; font: 500 10px var(--pp-mono); color: var(--pp-text);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ci-rm {
        flex: 0 0 auto; width: 24px; height: 24px; border: none; background: transparent;
        border-radius: 5px; color: var(--pp-muted); cursor: pointer;
        font: 500 12px var(--pp-sans); display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .ci-rm:hover { color: var(--pp-st-blocked); }

      /* Compose */
      textarea.task {
        width: 100%; min-height: 70px; resize: vertical;
        border: 1px solid var(--pp-border); border-radius: 5px; background: var(--pp-field);
        padding: 9px; font: 400 11px/1.5 var(--pp-sans); color: var(--pp-text); outline: none;
      }
      textarea.task:focus { border-color: var(--pp-accent); }
      .compose-row { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
      .compose-hint { font: 400 8.5px var(--pp-mono); color: var(--pp-muted-2); }
      .send-btn {
        margin-left: auto; height: 38px; padding: 0 16px;
        background: var(--pp-accent); color: var(--pp-on-accent); border: none; border-radius: 5px;
        font: 600 11px var(--pp-sans); cursor: pointer; box-shadow: var(--pp-shadow-btn);
      }
      .send-btn:hover:not(:disabled) { filter: brightness(1.04); }
      .send-btn:disabled { background: var(--pp-sub); color: var(--pp-muted-2); box-shadow: none; cursor: not-allowed; }
      .compose-queued {
        display: none; font: 400 8.5px/1.5 var(--pp-sans); color: var(--pp-muted);
        margin: 10px 0 0; text-align: center;
      }

      /* History */
      .hist-hd { display: flex; align-items: center; padding: 0 0 4px; }
      .hist-hd .hist-lbl { font: 600 10px var(--pp-sans); color: var(--pp-muted); }
      .hist-hd .hist-cnt { margin-left: auto; font: 400 9px var(--pp-mono); color: var(--pp-muted-2); }
      .hist-empty {
        font: 400 8.5px var(--pp-mono); color: var(--pp-muted-2);
        text-align: center; padding: 12px 0 4px;
      }
      .hist-list { display: flex; flex-direction: column; }

      .hist-row { border-bottom: 1px solid var(--pp-border-08); }
      .hist-row:last-child { border-bottom: none; }
      .hist-row[data-expanded="1"] { background: var(--pp-hist-exp); }

      .hist-head {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 0; cursor: pointer; user-select: none; -webkit-user-select: none;
      }
      .hist-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--pp-st-queued); }
      .hist-dot.dot-queued  { background: var(--pp-st-queued); }
      .hist-dot.dot-working { background: var(--pp-st-working); }
      .hist-dot.dot-done    { background: var(--pp-st-done); }
      .hist-dot.dot-blocked { background: var(--pp-st-blocked); }
      .hist-note-1 {
        flex: 1 1 auto; min-width: 0; font: 500 10px var(--pp-sans); color: var(--pp-text);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .hist-id { color: var(--pp-muted-2); font-family: var(--pp-mono); }
      .hist-time { flex: 0 0 auto; font: 400 9px var(--pp-mono); color: var(--pp-muted-2); }
      .hist-chevron {
        flex: 0 0 auto; font: 500 10px var(--pp-sans); color: var(--pp-muted-2);
        transition: transform .2s ease, color .2s ease;
      }
      .hist-row[data-expanded="1"] .hist-chevron { transform: rotate(90deg); color: var(--pp-accent); }

      /* Expanded detail — smooth grid-rows disclosure (0fr → 1fr). */
      .hist-detail { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
      .hist-row[data-expanded="1"] .hist-detail { grid-template-rows: 1fr; }
      .hist-detail-inner { overflow: hidden; min-height: 0; }
      .hist-detail-pad { padding: 0 0 13px 17px; display: flex; flex-direction: column; gap: 8px; }

      .hist-note-full {
        font: 400 10px/1.6 var(--pp-sans); color: var(--pp-text);
        overflow-wrap: anywhere; white-space: pre-wrap; margin: 0;
      }
      .hist-note-full.clamp {
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; white-space: normal;
      }
      .hist-note-more {
        display: none; font: 500 9px var(--pp-sans); color: var(--pp-accent); cursor: pointer;
        margin-top: 2px;
      }

      /* statusNote callout — colored by status. */
      .hist-status { border-radius: 5px; padding: 7px 9px; font: 500 9px/1.5 var(--pp-sans); overflow-wrap: anywhere; }
      .hist-status.st-queued  { background: var(--pp-st-queued-bg);  color: var(--pp-st-queued); }
      .hist-status.st-working { background: var(--pp-st-working-bg); color: var(--pp-st-working); }
      .hist-status.st-done    { background: var(--pp-st-done-bg);    color: var(--pp-st-done); }
      .hist-status.st-blocked { background: var(--pp-st-blocked-bg); color: var(--pp-st-blocked); }

      /* Per-element thumbs + selectors. */
      .hist-els { display: flex; flex-wrap: wrap; gap: 8px; }
      .hist-el { flex: 1 1 calc(50% - 4px); min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .hist-el-img {
        width: 100%; height: 42px; object-fit: cover; display: block;
        border-radius: 5px; border: 1px solid var(--pp-border-08); background: var(--pp-sub);
      }
      .hist-el-img.placeholder {
        display: flex; align-items: center; justify-content: center;
        color: var(--pp-muted-2); font-size: 13px;
      }
      .hist-el-sel {
        min-width: 0; font: 400 8.5px var(--pp-mono); color: var(--pp-muted);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .hist-fu { display: flex; gap: 6px; }
      .hist-fu input {
        flex: 1 1 auto; min-width: 0; border: 1px solid var(--pp-border); border-radius: 6px;
        padding: 8px 10px; font: 400 10px var(--pp-sans); color: var(--pp-text);
        background: var(--pp-field); outline: none;
      }
      .hist-fu input:focus { border-color: var(--pp-accent); }
      .btn-fu {
        flex: 0 0 auto; width: 36px; border: none; background: var(--pp-ink); color: var(--pp-paper);
        border-radius: 6px; cursor: pointer; font: 500 13px var(--pp-sans);
        display: flex; align-items: center; justify-content: center;
      }
      .btn-fu:hover { filter: brightness(1.1); }

      /* Toast — dark ink pill, colored status dot, white text. */
      .toast {
        position: fixed; bottom: 80px; right: 20px;
        display: flex; align-items: center; gap: 9px;
        background: var(--pp-toast-bg); color: var(--pp-toast-fg);
        padding: 10px 12px; border-radius: 6px;
        z-index: 2147483647; opacity: 0; transition: opacity .2s; pointer-events: none;
        box-shadow: 0 6px 22px rgba(20,22,28,.3);
        max-width: min(320px, calc(100vw - 40px));
      }
      .toast.show { opacity: 1; }
      .toast .toast-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: var(--pp-toast-ok); }
      .toast .toast-msg { font: 500 10px var(--pp-sans); overflow-wrap: anywhere; }

      /* Keyboard focus — a visible AA ring on every interactive control. The
         2px offset drops the ring onto the surrounding paper (not the teal fill)
         so it stays legible even on the teal-filled Pick/Send buttons. Mouse
         users never see it (:focus-visible only). */
      .tab:focus-visible,
      .seg-btn:focus-visible,
      .hd-x:focus-visible,
      .esc-chip:focus-visible,
      .pick-btn:focus-visible,
      .send-btn:focus-visible,
      .ci-rm:focus-visible,
      .btn-fu:focus-visible,
      .hist-note-more:focus-visible {
        outline: 2px solid var(--pp-accent);
        outline-offset: 2px;
      }
      .hd-x:focus-visible, .seg-btn:focus-visible, .ci-rm:focus-visible {
        outline-offset: 1px;
      }

      @media (prefers-reduced-motion: reduce) {
        .hist-detail, .hist-chevron, .tab, .tab-accent, .hd-dot, .toast { transition: none; }
      }
    </style>

    <button class="tab side-left" title="Pinpoint — pick elements (Cmd/Ctrl+Shift+K) · drag to move" aria-label="Pinpoint launcher">
      <span class="tab-accent"></span>
      <span class="tab-label">PINPOINT</span>
    </button>
    <div class="highlight"><span class="hl-chip"></span></div>
    <div class="cart-highlights"></div>

    <div class="panel" role="dialog" aria-label="Pinpoint">
      <div class="hd">
        <span class="hd-dot"></span>
        <span class="hd-ttl">Pinpoint</span>
        <span class="hd-ver">v0.4</span>
        <span class="hd-offline">offline</span>
        <span class="hd-ctrls">
          <button class="seg-btn seg-float" data-act="float" title="Float" aria-label="Float panel">▢</button>
          <button class="seg-btn seg-dock" data-act="dock" title="Dock" aria-label="Dock panel">▤</button>
          <button class="hd-x" data-act="close" title="Close" aria-label="Close">✕</button>
        </span>
        <div class="hd-pick">
          <span class="pk-dot"></span>
          <span class="pk-ttl">Picking…</span>
          <span class="esc-chip" data-act="stop-pick" role="button">ESC</span>
        </div>
      </div>

      <div class="body">
        <div class="offline-banner">
          <p class="ob-title">Bridge offline</p>
          <p class="ob-sub"><span class="ob-host"></span><span class="ob-retry"></span></p>
        </div>

        <div class="sec">
          <button class="pick-btn" data-act="pick" aria-pressed="false">
            <span class="pick-glyph">＋</span><span>Pick elements</span>
          </button>
          <p class="pick-help">Click any element on the page to attach it to a task.</p>
        </div>

        <div class="sec cart-sec">
          <div class="cart-hd">
            <span class="cart-lbl">Cart</span>
            <span class="cart-pill">0</span>
          </div>
          <div class="cart-list"></div>
        </div>

        <div class="sec compose-sec">
          <textarea class="task" placeholder="What should happen to these elements?"></textarea>
          <div class="compose-row">
            <span class="compose-hint">⌘↵ / ⇧↵ to send</span>
            <button class="send-btn" data-act="send">Send task (0) →</button>
          </div>
          <p class="compose-queued">Queued locally — sends when the bridge is back.</p>
        </div>

        <div class="sec hist-sec" style="border-bottom:none">
          <div class="hist-hd">
            <span class="hist-lbl">History</span>
            <span class="hist-cnt"></span>
          </div>
          <div class="hist-list"></div>
        </div>
      </div>
    </div>

    <div class="toast"><span class="toast-dot"></span><span class="toast-msg"></span></div>
  `;

  // Cache element refs.
  const tab          = root.querySelector('.tab');
  const highlight    = root.querySelector('.highlight');
  const hlChip       = root.querySelector('.highlight .hl-chip');
  const cartHlEl     = root.querySelector('.cart-highlights');
  const panel        = root.querySelector('.panel');
  const hdEl         = root.querySelector('.hd');
  const pickBtn      = root.querySelector('[data-act="pick"]');
  const pickHelpEl   = root.querySelector('.pick-help');
  const floatBtn     = root.querySelector('[data-act="float"]');
  const dockBtn      = root.querySelector('[data-act="dock"]');
  const escChip      = root.querySelector('[data-act="stop-pick"]');
  const cartPillEl   = root.querySelector('.cart-pill');
  const cartListEl   = root.querySelector('.cart-list');
  const textarea     = root.querySelector('textarea.task');
  const sendBtn      = root.querySelector('[data-act="send"]');
  const composeQueuedEl = root.querySelector('.compose-queued');
  const closeBtn     = root.querySelector('[data-act="close"]');
  const histListEl   = root.querySelector('.hist-list');
  const histCntEl    = root.querySelector('.hist-cnt');
  const toastEl      = root.querySelector('.toast');
  const toastDotEl   = root.querySelector('.toast .toast-dot');
  const toastMsgEl   = root.querySelector('.toast .toast-msg');
  const offlineBanner= root.querySelector('.offline-banner');
  const obHostEl     = root.querySelector('.ob-host');
  const obRetryEl    = root.querySelector('.ob-retry');
  const hdOfflineEl  = root.querySelector('.hd-offline');

  // Toast dot colors (read from CSS custom props on :host).
  const cs = getComputedStyle(host);
  const TOAST_OK   = (cs.getPropertyValue('--pp-toast-ok')   || '#34D3B8').trim();
  const TOAST_WARN = (cs.getPropertyValue('--pp-toast-warn') || '#F5B041').trim();
  const TOAST_ERR  = (cs.getPropertyValue('--pp-toast-err')  || '#F87171').trim();

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let picking = false;   // in element-pick mode?
  let sending = false;   // a send is in flight
  let uidSeq = 0;        // local id counter for cart items
  let cart = [];         // [{ uid, selector, url, title, viewport, rect, domPath, outerHtml, sourceHint, screenshot, thumb, capturing }]
  // persisted history: [{ id, note, count, status, ts, thumb?, thumbs?, statusNote? }]
  let tasks = loadTasks();
  const expandedRows = new Set();

  // Bridge reachability. online=true until a poll/send says otherwise.
  let online = true;
  let retryCount = 0;

  // Dock state. "float" (classic floating panel) | "dock" (right sidebar).
  const DOCK_KEY = 'pinpoint.dock';
  const DOCK_WIDTH = 360; // must match .panel.docked width
  const MIN_CONTENT = 140;
  const NARROW_DOCK_MIN = DOCK_WIDTH + MIN_CONTENT; // 500px
  let dockMode = loadDock();

  function effectiveDock() {
    return dockMode === 'dock' && window.innerWidth >= NARROW_DOCK_MIN;
  }

  // Launcher edge-tab position. side + top as a 0..1 fraction of viewport height.
  const FAB_KEY = 'pinpoint.fab';
  const TAB_H = 104;      // must match .tab height
  const DRAG_THRESHOLD = 5; // px of movement below which a pointerup is a click
  let fabPos = loadFabPos();
  let dragState = null;

  // -------------------------------------------------------------------------
  // 3. Panel open/close + pick mode
  // -------------------------------------------------------------------------
  function isOpen() {
    return panel.classList.contains('open');
  }

  function openPanel() {
    panel.classList.add('open');
    renderAll();               // renders the cart → (re)builds on-page highlight boxes
    setPicking(true);
    updateLayout();            // may pin the sidebar + reflow the page; hides the tab when docked+open
  }

  function closePanel() {
    panel.classList.remove('open');
    setPicking(false);
    clearCartHighlights();     // drop every persistent box when the panel closes
    updateLayout();            // tear down any reflow so the page snaps back; re-shows the tab
  }

  function togglePanel() {
    if (isOpen()) closePanel();
    else openPanel();
  }

  function setPicking(on) {
    picking = on;
    tab.classList.toggle('active', on);
    hdEl.classList.toggle('picking', on);
    pickBtn.classList.toggle('active', on);
    pickBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.documentElement.style.cursor = on ? 'crosshair' : '';
    if (!on) hideHighlight();
    renderCart(); // refresh the empty-state helper copy (picking vs idle)
  }

  // -------------------------------------------------------------------------
  // 3b. Dock / undock + side-by-side page reflow
  // -------------------------------------------------------------------------
  function updateLayout() {
    const isDock = effectiveDock();
    panel.classList.toggle('docked', isDock);

    // Segmented control reflects the persisted PREFERENCE (dockMode), so it
    // always shows what a click will do even while docking is suppressed on a
    // narrow viewport.
    const intentDock = dockMode === 'dock';
    floatBtn.classList.toggle('active', !intentDock);
    dockBtn.classList.toggle('active', intentDock);

    const reflow = isDock && isOpen();
    if (reflow) applyReflow(DOCK_WIDTH);
    else clearReflow();

    positionTab();
    // When docked AND open the sidebar is permanently visible, so the edge
    // launcher tab is redundant — hide it. It reappears when floating OR closed.
    tab.style.display = (isDock && isOpen()) ? 'none' : '';
    positionToast();
    // Docking reflows the host page (margin/width on <html>), which shifts every
    // element left under the sidebar; opening/closing/side-toggling likewise moves
    // things. Re-measure the persistent cart boxes so they don't lag a frame
    // behind until the next scroll/resize. rAF-guarded → cheap + idempotent.
    scheduleHlUpdate();
  }

  let htmlSnap = null;

  function applyReflow(w) {
    const de = document.documentElement;
    if (htmlSnap === null) {
      htmlSnap = { marginRight: de.style.marginRight, width: de.style.width };
    }
    de.style.marginRight = w + 'px';
    de.style.width = `calc(100% - ${w}px)`;
    de.style.setProperty('--pinpoint-dock-width', w + 'px');
  }

  function clearReflow() {
    const de = document.documentElement;
    if (htmlSnap) {
      de.style.marginRight = htmlSnap.marginRight;
      de.style.width = htmlSnap.width;
      htmlSnap = null;
    } else {
      de.style.marginRight = '';
      de.style.width = '';
    }
    de.style.removeProperty('--pinpoint-dock-width');
  }

  function setDock(mode) {
    dockMode = (mode === 'dock') ? 'dock' : 'float';
    saveDock();
    updateLayout();
  }

  // -------------------------------------------------------------------------
  // 3c. Launcher edge-tab: position, drag, side-snap
  // -------------------------------------------------------------------------
  function positionTab() {
    const vh = window.innerHeight;
    let topPx = fabPos.top * vh;
    const maxTop = Math.max(0, vh - TAB_H);
    if (topPx < 0) topPx = 0;
    if (topPx > maxTop) topPx = maxTop;
    tab.style.top = `${Math.round(topPx)}px`;
    tab.style.bottom = 'auto';
    applyTabSide(fabPos.side);
  }

  function applyTabSide(side) {
    tab.classList.toggle('side-left', side === 'left');
    tab.classList.toggle('side-right', side === 'right');
    if (side === 'right') {
      const shift = (effectiveDock() && isOpen()) ? DOCK_WIDTH : 0;
      tab.style.right = `${shift}px`;
      tab.style.left = 'auto';
    } else {
      tab.style.left = '0px';
      tab.style.right = 'auto';
    }
  }

  function onTabPointerDown(e) {
    if (e.button != null && e.button !== 0) return; // primary button only
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startTopPx: parseFloat(tab.style.top) || 0,
      pointerId: e.pointerId,
      moved: false,
    };
    tab.classList.add('dragging');
    try { tab.setPointerCapture(e.pointerId); } catch { /* older engines */ }
    window.addEventListener('pointermove', onTabPointerMove, true);
    window.addEventListener('pointerup', onTabPointerUp, true);
    e.preventDefault();
  }

  function onTabPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    dragState.moved = true;

    const vh = window.innerHeight;
    const maxTop = Math.max(0, vh - TAB_H);
    let topPx = dragState.startTopPx + dy;
    topPx = Math.min(maxTop, Math.max(0, topPx));
    tab.style.top = `${Math.round(topPx)}px`;
    tab.style.bottom = 'auto';

    const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    if (side !== fabPos.side) {
      fabPos.side = side;
      applyTabSide(side);
    }
  }

  function onTabPointerUp() {
    window.removeEventListener('pointermove', onTabPointerMove, true);
    window.removeEventListener('pointerup', onTabPointerUp, true);
    tab.classList.remove('dragging');
    const st = dragState;
    dragState = null;
    if (!st) return;
    try { tab.releasePointerCapture(st.pointerId); } catch { /* noop */ }

    if (st.moved) {
      const vh = window.innerHeight;
      const topPx = parseFloat(tab.style.top) || 0;
      fabPos.top = vh > 0 ? topPx / vh : 0.6;
      saveFabPos();
    } else {
      togglePanel();
    }
  }

  function hideHighlight() {
    highlight.style.display = 'none';
  }

  function isOurs(node) {
    return node === host || (node && node.nodeType === 1 && host.contains(node));
  }

  function onMouseMove(e) {
    if (!picking) return;
    const topEl = document.elementFromPoint(e.clientX, e.clientY);
    if (isOurs(topEl)) { hideHighlight(); return; }
    const el = elementUnderCursor(e.clientX, e.clientY);
    if (!el) { hideHighlight(); return; }
    const r = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left   = `${r.left}px`;
    highlight.style.top    = `${r.top}px`;
    highlight.style.width  = `${r.width}px`;
    highlight.style.height = `${r.height}px`;
    hlChip.textContent = shortLabel(el); // cheap label (not finder — mousemove hot path)
  }

  function elementUnderCursor(x, y) {
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    host.style.pointerEvents = prev;
    if (!el || isOurs(el)) return null;
    return el;
  }

  function onClickCapture(e) {
    if (!picking) return;
    if (e.composedPath && e.composedPath().includes(host)) return;
    const el = elementUnderCursor(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    addToCart(el);
    // Pick mode STAYS ON — keep collecting.
  }

  // -------------------------------------------------------------------------
  // 4. Cart
  // -------------------------------------------------------------------------
  function addToCart(el) {
    const r = el.getBoundingClientRect();
    const selector = safeSelector(el);

    // Dedup: clicking the same element twice must not add a duplicate.
    if (cart.some((c) => c.selector === selector)) {
      toast('Already picked', 'warn');
      return;
    }

    const item = {
      uid: ++uidSeq,
      selector,
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      domPath: buildDomPath(el),
      outerHtml: (el.outerHTML || '').slice(0, 2000),
      sourceHint: el.closest('[data-v-inspector]')?.getAttribute('data-v-inspector') || undefined,
      screenshot: null,
      thumb: null,
      capturing: true,
    };
    cart.push(item);
    renderCart();

    if (cart.length > SOFT_LIMIT) {
      toast(`Many elements (${cart.length}) — consider splitting into tasks`, 'warn');
    }

    captureScreenshot(el).then(async (shot) => {
      const live = cart.find((c) => c.uid === item.uid);
      if (!live) return;
      live.screenshot = shot || null;
      live.capturing = false;
      renderCart();
      if (!shot) return;
      const thumb = await makeThumb(shot);
      const live2 = cart.find((c) => c.uid === item.uid);
      if (!live2) return;
      live2.thumb = thumb || null;
      renderCart();
    });
  }

  function removeFromCart(uid) {
    cart = cart.filter((c) => c.uid !== uid);
    renderCart();
  }

  function clearCart() {
    cart = [];
    renderCart();
  }

  function renderCart() {
    const n = cart.length;
    cartPillEl.textContent = String(n);
    sendBtn.textContent = n === 0 ? 'Send task (0) →' : `Send task (${n}) →`;
    sendBtn.disabled = sending || n === 0 || !online;

    // Empty-state helper under the primary button + queued/offline hint.
    pickHelpEl.style.display = n === 0 ? 'block' : 'none';
    composeQueuedEl.style.display = (!online && n > 0) ? 'block' : 'none';

    if (n === 0) {
      cartListEl.innerHTML = `
        <div class="cart-empty">
          <div class="ce-glyph">＋</div>
          <p class="ce-title">Nothing picked yet</p>
          <p class="ce-sub">${picking ? 'Hover + click elements on the page.' : 'Pick an element to start a task.'}</p>
        </div>`;
      renderCartHighlights();
      return;
    }

    cartListEl.innerHTML = cart
      .map((c, i) => {
        const thumbInner = c.thumb
          ? `<img class="ci-thumb" src="${escapeHtml(c.thumb)}" alt="" />`
          : `<div class="ci-thumb placeholder">${c.capturing ? '…' : '▢'}</div>`;
        return `
          <div class="cart-item" data-uid="${c.uid}">
            <span class="ci-idx">${i + 1}</span>
            <span class="ci-thumb-wrap">${thumbInner}</span>
            <span class="ci-sel" title="${escapeHtml(c.selector)}">${escapeHtml(c.selector)}</span>
            <button class="ci-rm" data-uid="${c.uid}" title="Remove" aria-label="Remove">✕</button>
          </div>`;
      })
      .join('');

    renderCartHighlights();
  }

  // -------------------------------------------------------------------------
  // 4b. Persistent on-page highlight boxes for cart items
  // -------------------------------------------------------------------------
  let hlRaf = null;

  function renderCartHighlights() {
    cartHlEl.innerHTML = cart
      .map((c, i) => `<div class="cart-hl" data-uid="${c.uid}"><span class="num">${i + 1}</span></div>`)
      .join('');
    positionCartHighlights();
  }

  function positionCartHighlights() {
    const show = isOpen();
    const boxes = cartHlEl.children;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const uid = Number(box.getAttribute('data-uid'));
      const item = cart.find((c) => c.uid === uid);
      let rect = null;
      if (show && item) {
        try {
          const el = document.querySelector(item.selector);
          if (el && !isOurs(el)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 || r.height > 0) rect = r;
          }
        } catch { /* invalid/unsupported selector — skip this box */ }
      }
      if (!rect) { box.style.display = 'none'; continue; }
      box.style.display = 'block';
      box.style.left   = `${rect.left}px`;
      box.style.top    = `${rect.top}px`;
      box.style.width  = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }
  }

  function scheduleHlUpdate() {
    if (hlRaf) return;
    hlRaf = requestAnimationFrame(() => { hlRaf = null; positionCartHighlights(); });
  }

  function clearCartHighlights() {
    cartHlEl.innerHTML = '';
  }

  function emphasizeCartBox(uid, on) {
    const box = cartHlEl.querySelector(`.cart-hl[data-uid="${uid}"]`);
    if (box) box.classList.toggle('emph', on);
  }

  // Rasterize the element to a JPEG data URL, with a timeout so a slow/broken
  // render never blocks the flow. Any failure → null.
  async function captureScreenshot(el) {
    try {
      const shot = toJpeg(el, {
        quality: 0.92,
        // Near-native but capped at 2× so a 3×/HiDPI display can't blow the
        // bridge's 24 MB body cap.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        // Don't fetch/inline @font-face web fonts (spams the host console with 404s).
        skipFonts: true,
        filter: (node) => !isOurs(node),
      });
      const guard = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
      return await Promise.race([shot, guard]);
    } catch {
      return null;
    }
  }

  // Downscale a full JPEG data URL to a crisp thumbnail (longest edge ~240px).
  function makeThumb(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl) { resolve(null); return; }
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const MAX = 240;
            const scale = Math.min(1, MAX / Math.max(img.width || 1, img.height || 1));
            const w = Math.max(1, Math.round((img.width || 1) * scale));
            const h = Math.max(1, Math.round((img.height || 1) * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      } catch { resolve(null); }
    });
  }

  // -------------------------------------------------------------------------
  // 5. Send the task (batch of cart items)
  // -------------------------------------------------------------------------
  async function send() {
    if (sending) return;
    if (cart.length === 0) return;
    if (!online) { toast(`Bridge offline (${hostLabel})`, 'err'); return; }
    const taskText = textarea.value.trim();
    if (!taskText) { textarea.focus(); toast('Enter a task first', 'warn'); return; }

    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    const items = cart.map((c) => ({
      selector: c.selector,
      url: c.url,
      title: c.title,
      viewport: c.viewport,
      rect: c.rect,
      domPath: c.domPath,
      outerHtml: c.outerHtml,
      sourceHint: c.sourceHint,
      screenshot: c.screenshot || undefined,
    }));

    try {
      const res = await fetch(`${base}/annotation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pinpoint-Token': token,
        },
        body: JSON.stringify({ task: taskText, items }),
      });

      if (res.ok) {
        setOnline(true); // a successful POST proves the bridge is reachable
        let taskId = '';
        try {
          const body = await res.json();
          taskId = body && body.task_id != null ? String(body.task_id) : '';
        } catch { /* ignore parse issues; still succeeded */ }

        // Persist up to 4 crisp per-element thumbnails so the expanded history
        // view can show each element with its selector.
        const MAX_STORED_THUMBS = 4;
        const thumbs = [];
        for (const c of cart) {
          if (thumbs.length >= MAX_STORED_THUMBS) break;
          const th = c.thumb || (c.screenshot ? await makeThumb(c.screenshot) : null);
          if (th) thumbs.push({ selector: c.selector, thumb: th });
        }

        tasks.unshift({
          id: taskId,
          note: taskText,
          count: items.length,
          status: 'queued',
          ts: Date.now(),
          thumbs: thumbs.length ? thumbs : undefined,
        });
        saveTasks();

        clearCart();
        textarea.value = '';
        setPicking(false); // exit pick mode; keep the panel open to watch status
        renderHistory();
        toast(`Task #${taskId || '?'} sent (${items.length})`);
      } else {
        toast(`Error: ${res.status}`, 'err');
      }
    } catch {
      // Network failure — the bridge is (probably) offline. Keep the cart intact
      // and re-enable send once health returns; never drop the user's task.
      setOnline(false);
      toast(`Bridge offline (${hostLabel})`, 'err');
    } finally {
      sending = false;
      renderCart(); // restores the "Send task (N) →" label / disabled state
    }
  }

  // -------------------------------------------------------------------------
  // 6. History + follow-ups
  // -------------------------------------------------------------------------
  function taskKey(t) {
    return t && t.id ? String(t.id) : `ts:${t && t.ts ? t.ts : '0'}`;
  }

  function elementThumbs(t) {
    if (Array.isArray(t.thumbs) && t.thumbs.length) {
      return t.thumbs
        .filter((x) => x && x.thumb)
        .map((x) => ({ thumb: x.thumb, selector: x.selector || '' }));
    }
    if (t.thumb) return [{ thumb: t.thumb, selector: '' }];
    return [];
  }

  function thumbImg(dataUrl, cls) {
    return dataUrl
      ? `<img class="${cls}" src="${escapeHtml(dataUrl)}" alt="" />`
      : `<div class="${cls} placeholder">▢</div>`;
  }

  function renderHistory() {
    histCntEl.textContent = tasks.length
      ? (tasks.length === 1 ? '1 task' : `${tasks.length} tasks`)
      : '';
    if (!tasks.length) {
      histListEl.innerHTML = '<div class="hist-empty">No task history</div>';
      return;
    }
    histListEl.innerHTML = tasks
      .map((t) => {
        const status = normalizeStatus(t.status);
        const key = taskKey(t);
        const isExpanded = expandedRows.has(key);
        const idLabel = t.id ? `#${escapeHtml(String(t.id))}` : '';
        const note = t.note || '';
        const els = elementThumbs(t);
        const statusHtml = t.statusNote
          ? `<div class="hist-status st-${status}">${escapeHtml(t.statusNote)}</div>`
          : '';
        const elsHtml = els.length
          ? `<div class="hist-els">${els
              .map((e) => `
                <div class="hist-el">
                  ${thumbImg(e.thumb, 'hist-el-img')}
                  ${e.selector ? `<span class="hist-el-sel" title="${escapeHtml(e.selector)}">${escapeHtml(e.selector)}</span>` : ''}
                </div>`)
              .join('')}</div>`
          : '';
        const idAttr = escapeHtml(String(t.id || ''));
        return `
          <div class="hist-row" data-key="${escapeHtml(key)}" data-expanded="${isExpanded ? '1' : '0'}">
            <div class="hist-head">
              <span class="hist-dot dot-${status}"></span>
              <span class="hist-note-1">${idLabel ? `<span class="hist-id">${idLabel}</span> ` : ''}${escapeHtml(note)}</span>
              <span class="hist-time">${escapeHtml(relTime(t.ts))}</span>
              <span class="hist-chevron">▸</span>
            </div>
            <div class="hist-detail"><div class="hist-detail-inner"><div class="hist-detail-pad">
              <p class="hist-note-full clamp">${escapeHtml(note)}</p>
              <span class="hist-note-more" data-act="note-more">Show more</span>
              ${statusHtml}
              ${elsHtml}
              <div class="hist-fu">
                <input type="text" placeholder="Follow up…" data-id="${idAttr}" />
                <button class="btn-fu" data-id="${idAttr}" title="Send follow-up" aria-label="Send follow-up">→</button>
              </div>
            </div></div></div>
          </div>`;
      })
      .join('');

    // Measure clamp overflow for any row already expanded on (re)render.
    requestAnimationFrame(() => {
      histListEl.querySelectorAll('.hist-row[data-expanded="1"]').forEach(measureNote);
    });
  }

  // Show the "Show more" toggle only when the 2-line clamp actually hides text.
  function measureNote(row) {
    const note = row.querySelector('.hist-note-full');
    const more = row.querySelector('.hist-note-more');
    if (!note || !more) return;
    if (!note.classList.contains('clamp')) { more.style.display = 'inline'; return; }
    more.style.display = (note.scrollHeight > note.clientHeight + 2) ? 'inline' : 'none';
  }

  function toggleRow(row) {
    const key = row.getAttribute('data-key');
    if (!key) return;
    const willOpen = !expandedRows.has(key);
    if (willOpen) expandedRows.add(key);
    else expandedRows.delete(key);
    row.setAttribute('data-expanded', willOpen ? '1' : '0');
    if (willOpen) requestAnimationFrame(() => measureNote(row));
  }

  // Live status update from SSE — patch just the affected row in place.
  function updateRowStatus(t) {
    const key = taskKey(t);
    const row = histListEl.querySelector(`.hist-row[data-key="${cssEscape(key)}"]`);
    if (!row) { renderHistory(); return; }
    const status = normalizeStatus(t.status);
    const dot = row.querySelector('.hist-dot');
    if (dot) dot.className = `hist-dot dot-${status}`;
    if (t.statusNote) {
      let sn = row.querySelector('.hist-status');
      if (!sn) {
        const noteMore = row.querySelector('.hist-note-more');
        if (noteMore && noteMore.parentNode) {
          sn = document.createElement('div');
          noteMore.parentNode.insertBefore(sn, noteMore.nextSibling);
        }
      }
      if (sn) {
        sn.className = `hist-status st-${status}`;
        sn.textContent = t.statusNote; // textContent → inherently escaped
      }
    }
  }

  function updateRelTimes() {
    const rows = histListEl.querySelectorAll('.hist-row');
    rows.forEach((row) => {
      const key = row.getAttribute('data-key');
      const t = tasks.find((x) => taskKey(x) === key);
      if (!t) return;
      const el = row.querySelector('.hist-time');
      if (el) el.textContent = relTime(t.ts);
    });
  }

  async function sendFollowup(taskId, text, inputEl) {
    const body = (text || '').trim();
    if (!taskId || !body) return;
    try {
      const res = await fetch(`${base}/followup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pinpoint-Token': token,
        },
        body: JSON.stringify({ task_id: String(taskId), text: body }),
      });
      if (res.ok) {
        setOnline(true);
        if (inputEl) inputEl.value = '';
        toast(`Follow-up on #${taskId} sent`);
      } else {
        toast(`Error: ${res.status}`, 'err');
      }
    } catch {
      setOnline(false);
      toast(`Bridge offline (${hostLabel})`, 'err');
    }
  }

  function renderAll() {
    renderCart();
    renderHistory();
  }

  // -------------------------------------------------------------------------
  // 7. Status stream (SSE) + bridge reachability
  // -------------------------------------------------------------------------
  function connectStatus() {
    let es;
    try {
      es = new EventSource(`${base}/events`);
    } catch {
      return; // no SSE support / blocked — history still works, just no live status
    }
    es.onopen = () => setOnline(true);
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || msg.type !== 'status' || msg.task_id == null) return;
      const t = tasks.find((x) => String(x.id) === String(msg.task_id));
      if (!t) return;
      t.status = normalizeStatus(msg.status);
      if (typeof msg.note === 'string' && msg.note) t.statusNote = msg.note;
      saveTasks();
      updateRowStatus(t);
    };
    // Native EventSource auto-reconnects on error. A dropped stream may mean the
    // bridge went away — kick an immediate health check rather than trust the
    // error alone (SSE also errors during a normal reconnect).
    es.onerror = () => { checkHealth(); };
  }

  // Poll GET /health; also called on SSE drop / send failure recovery.
  async function checkHealth() {
    try {
      const res = await fetch(`${base}/health`, { cache: 'no-store' });
      setOnline(!!res.ok);
    } catch {
      setOnline(false);
    }
  }

  function setOnline(ok) {
    if (ok) {
      const was = online;
      online = true;
      retryCount = 0;
      hdEl.classList.remove('offline');
      offlineBanner.style.display = 'none';
      if (!was) renderCart(); // recovered → re-enable send + drop the queued hint
    } else {
      online = false;
      retryCount++;
      hdEl.classList.add('offline');
      hdOfflineEl.style.display = 'inline';
      offlineBanner.style.display = 'block';
      obHostEl.textContent = `${hostLabel} — retrying… `;
      obRetryEl.textContent = `(${retryCount})`;
      renderCart(); // disable send + show the queued hint
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  function loadTasks() {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveTasks() {
    try {
      if (tasks.length > 50) tasks = tasks.slice(0, 50);
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch { /* storage full / blocked — non-fatal */ }
  }

  function normalizeStatus(s) {
    const v = String(s || '').toLowerCase();
    return (v === 'working' || v === 'done' || v === 'blocked') ? v : 'queued';
  }

  function loadDock() {
    try { return localStorage.getItem(DOCK_KEY) === 'dock' ? 'dock' : 'float'; }
    catch { return 'float'; }
  }
  function saveDock() {
    try { localStorage.setItem(DOCK_KEY, dockMode); } catch { /* non-fatal */ }
  }

  function loadFabPos() {
    try {
      const o = JSON.parse(localStorage.getItem(FAB_KEY) || 'null');
      const side = (o && (o.side === 'left' || o.side === 'right')) ? o.side : 'left';
      let top = (o && typeof o.top === 'number') ? o.top : 0.6;
      if (!(top >= 0 && top <= 1)) top = 0.6;
      return { side, top };
    } catch {
      return { side: 'left', top: 0.6 };
    }
  }
  function saveFabPos() {
    try { localStorage.setItem(FAB_KEY, JSON.stringify(fabPos)); }
    catch { /* non-fatal */ }
  }

  // Compact EN relative time for history rows: "now", "2m", "1h", "3d".
  function relTime(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 45) return 'now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${Math.max(1, m)}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  // -------------------------------------------------------------------------
  // Selector / DOM-path helpers
  // -------------------------------------------------------------------------
  function safeSelector(el) {
    try {
      return finder(el);
    } catch {
      return simplePath(el);
    }
  }

  function simplePath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
        parts.unshift(`${tag}:nth-child(${idx})`);
      } else {
        parts.unshift(tag);
      }
      node = parent;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function buildDomPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let seg = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        const cls = Array.prototype.find.call(
          node.classList,
          (c) => /^[a-zA-Z][\w-]*$/.test(c)
        );
        if (cls) seg += `.${cls}`;
      }
      parts.unshift(seg);
      if (node === document.body) break;
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // Cheap human label for the hover chip (NOT a stable selector — avoids running
  // finder() on the mousemove hot path).
  function shortLabel(el) {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) return `${s}#${el.id}`;
    if (el.classList && el.classList.length) {
      const cls = Array.prototype.find.call(el.classList, (c) => /^[a-zA-Z][\w-]*$/.test(c));
      if (cls) s += `.${cls}`;
    }
    return s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, kind) {
    toastMsgEl.textContent = msg;
    toastDotEl.style.background =
      kind === 'err' ? TOAST_ERR : kind === 'warn' ? TOAST_WARN : TOAST_OK;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  function positionToast() {
    const shifted = effectiveDock() && isOpen();
    toastEl.style.right = shifted ? `${DOCK_WIDTH + 20}px` : '';
  }

  // -------------------------------------------------------------------------
  // Wiring: events
  // -------------------------------------------------------------------------
  tab.addEventListener('pointerdown', onTabPointerDown);
  closeBtn.addEventListener('click', closePanel);
  pickBtn.addEventListener('click', () => setPicking(!picking));
  escChip.addEventListener('click', () => setPicking(false));
  floatBtn.addEventListener('click', () => setDock('float'));
  dockBtn.addEventListener('click', () => setDock('dock'));
  sendBtn.addEventListener('click', send);

  // Cart list: per-item remove (event delegation).
  cartListEl.addEventListener('click', (e) => {
    const rm = e.target.closest('.ci-rm');
    if (!rm) return;
    const uid = Number(rm.getAttribute('data-uid'));
    if (uid) removeFromCart(uid);
  });

  // Hovering a cart ROW emphasizes that element's persistent box on the page.
  cartListEl.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.cart-item');
    if (!item) return;
    const uid = Number(item.getAttribute('data-uid'));
    if (uid) emphasizeCartBox(uid, true);
  });
  cartListEl.addEventListener('mouseout', (e) => {
    const item = e.target.closest('.cart-item');
    if (!item) return;
    if (e.relatedTarget && item.contains(e.relatedTarget)) return;
    const uid = Number(item.getAttribute('data-uid'));
    if (uid) emphasizeCartBox(uid, false);
  });

  // History list: follow-up send + show-more + row expand/collapse (delegation).
  histListEl.addEventListener('click', (e) => {
    // 1) Follow-up send button (lives in the expanded detail).
    const btn = e.target.closest('.btn-fu');
    if (btn) {
      const row = btn.closest('.hist-row');
      const input = row ? row.querySelector('.hist-fu input') : null;
      sendFollowup(btn.getAttribute('data-id'), input ? input.value : '', input);
      return;
    }
    // 2) "Show more" toggle (unclamp the 2-line note).
    const more = e.target.closest('.hist-note-more');
    if (more) {
      const note = more.closest('.hist-detail-pad')?.querySelector('.hist-note-full');
      if (note) {
        const clamped = note.classList.toggle('clamp');
        more.textContent = clamped ? 'Show more' : 'Show less';
      }
      return;
    }
    // 3) Clicks inside the follow-up area must never toggle the row.
    if (e.target.closest('.hist-fu')) return;
    // 4) Clicking the summary head toggles the accordion.
    const head = e.target.closest('.hist-head');
    if (!head) return;
    const row = head.closest('.hist-row');
    if (row) toggleRow(row);
  });
  histListEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.hist-fu input');
    if (!input) return;
    e.preventDefault();
    sendFollowup(input.getAttribute('data-id'), input.value, input);
  });

  // Cmd/Ctrl+Enter OR Shift+Enter inside the task textarea sends; plain Enter still
  // inserts a newline. Escape closes the panel.
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey || e.shiftKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });

  // Global listeners (capture phase so we win before the host app).
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('click', onClickCapture, true);
  window.addEventListener('scroll', () => { hideHighlight(); scheduleHlUpdate(); }, true);

  window.addEventListener('resize', () => {
    updateLayout();
    scheduleHlUpdate();
  });

  window.addEventListener('pagehide', clearReflow);
  window.addEventListener('pageshow', () => { updateLayout(); positionTab(); });

  // Keyboard shortcut: Cmd/Ctrl+Shift+K toggles the panel + pick mode.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      togglePanel();
      return;
    }
    // While picking, a bare Escape exits pick mode (matches the header ESC chip).
    if (e.key === 'Escape' && picking) {
      e.preventDefault();
      setPicking(false);
    }
  }, true);

  function cssEscape(v) {
    const s = String(v);
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return s.replace(/["\\\]]/g, '\\$&');
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  updateLayout(); // sets seg-control active state, docked class (if any) + positions the tab
  connectStatus();
  checkHealth();  // initial reachability probe
  setInterval(checkHealth, 5000); // poll every ~5s

  // Keep relative timestamps fresh without a full re-render (preserves expand
  // state + any in-progress follow-up text).
  setInterval(() => { if (isOpen()) updateRelTimes(); }, 60000);
}

// ---------------------------------------------------------------------------
// Config reader (module scope so it stays out of init's closure noise).
// ---------------------------------------------------------------------------
function readConfig() {
  const ds = document.getElementById('pinpoint-overlay')?.dataset;
  if (ds && ds.pinpointPort) {
    return { port: Number(ds.pinpointPort) || 4849, token: ds.pinpointToken || '' };
  }
  if (window.__PINPOINT__ && window.__PINPOINT__.port) {
    return { port: Number(window.__PINPOINT__.port) || 4849, token: window.__PINPOINT__.token || '' };
  }
  return { port: 4849, token: '' };
}
