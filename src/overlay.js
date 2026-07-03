// pinpoint/overlay.js
// In-browser annotation overlay. Bundled by esbuild (platform=browser, format=iife)
// into bridge/overlay.dist.js and injected into the host page by the bridge.
//
// Responsibilities:
//   - Show a floating "pick" button (bottom-right) + Cmd/Ctrl+Shift+K shortcut.
//   - In pick mode, highlight the element under the cursor.
//   - On click, capture that element and open a note panel.
//   - On "Senden", gather a payload (selector, rect, dom path, outerHTML, optional
//     screenshot) and POST it to the bridge's /annotation endpoint.
//
// Everything lives inside a Shadow DOM so host-app CSS can't leak in and our CSS
// can't leak out. We never mutate the target element's own styles.

import { finder } from '@medv/finder';
import { toPng } from 'html-to-image';

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
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

      /* Floating toggle button */
      .fab {
        position: fixed; bottom: 20px; right: 20px;
        width: 48px; height: 48px; border-radius: 50%;
        background: #10b981; color: #fff; border: none; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; line-height: 1; z-index: 2147483647;
        transition: background .15s, transform .15s;
      }
      .fab:hover { transform: scale(1.05); }
      .fab.active { background: #ef4444; }

      /* Hover highlight box drawn over the target element */
      .highlight {
        position: fixed; pointer-events: none; z-index: 2147483646;
        border: 2px solid #10b981; background: rgba(16,185,129,.12);
        border-radius: 2px; display: none;
        box-shadow: 0 0 0 1px rgba(0,0,0,.15);
      }

      /* Note panel */
      .panel {
        position: fixed; bottom: 80px; right: 20px; width: 320px;
        background: #fff; color: #111; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.28);
        padding: 14px; z-index: 2147483647; display: none;
        border: 1px solid rgba(0,0,0,.08);
      }
      .panel h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151; }
      .panel .sel {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; color: #6b7280; background: #f3f4f6;
        padding: 4px 6px; border-radius: 4px; margin-bottom: 8px;
        word-break: break-all; max-height: 46px; overflow: auto;
      }
      .panel textarea {
        width: 100%; min-height: 90px; resize: vertical;
        border: 1px solid #d1d5db; border-radius: 6px; padding: 8px;
        font-size: 13px; color: #111; outline: none; font-family: inherit;
      }
      .panel textarea:focus { border-color: #10b981; }
      .row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
      .btn {
        border: none; border-radius: 6px; padding: 7px 14px;
        font-size: 13px; cursor: pointer; font-weight: 500;
      }
      .btn-primary { background: #10b981; color: #fff; }
      .btn-primary:disabled { opacity: .6; cursor: default; }
      .btn-ghost { background: #f3f4f6; color: #374151; }

      /* Toast */
      .toast {
        position: fixed; bottom: 80px; right: 20px;
        background: #111; color: #fff; padding: 10px 16px; border-radius: 8px;
        font-size: 13px; z-index: 2147483647; opacity: 0;
        transition: opacity .2s; pointer-events: none;
        box-shadow: 0 4px 14px rgba(0,0,0,.3);
      }
      .toast.show { opacity: 1; }
      .toast.err { background: #b91c1c; }
    </style>

    <button class="fab" title="Annotieren (Cmd/Ctrl+Shift+K)">◎</button>
    <div class="highlight"></div>

    <div class="panel">
      <h3>Notiz an Claude</h3>
      <div class="sel"></div>
      <textarea placeholder="Was stimmt hier nicht? …"></textarea>
      <div class="row">
        <button class="btn btn-ghost" data-act="cancel">Abbrechen</button>
        <button class="btn btn-primary" data-act="send">Senden</button>
      </div>
    </div>

    <div class="toast"></div>
  `;

  // Cache element refs.
  const fab       = root.querySelector('.fab');
  const highlight = root.querySelector('.highlight');
  const panel     = root.querySelector('.panel');
  const selLabel  = root.querySelector('.panel .sel');
  const textarea  = root.querySelector('.panel textarea');
  const toastEl   = root.querySelector('.toast');
  const sendBtn   = root.querySelector('[data-act="send"]');
  const cancelBtn = root.querySelector('[data-act="cancel"]');

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let picking = false;      // are we in element-pick mode?
  let captured = null;      // the element the user clicked

  // -------------------------------------------------------------------------
  // 3. Pick mode + highlighting
  // -------------------------------------------------------------------------
  function setPicking(on) {
    picking = on;
    fab.classList.toggle('active', on);
    fab.textContent = on ? '✕' : '◎';
    document.documentElement.style.cursor = on ? 'crosshair' : '';
    if (!on) hideHighlight();
  }

  function hideHighlight() {
    highlight.style.display = 'none';
  }

  // Is this node part of our own overlay (host element)? If so, ignore it.
  function isOurs(node) {
    return node === host || (node && node.nodeType === 1 && host.contains(node));
  }

  function onMouseMove(e) {
    if (!picking) return;
    // Find the top-most host-app element under the cursor, skipping our overlay.
    const el = elementUnderCursor(e.clientX, e.clientY);
    if (!el) { hideHighlight(); return; }
    const r = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left   = `${r.left}px`;
    highlight.style.top    = `${r.top}px`;
    highlight.style.width  = `${r.width}px`;
    highlight.style.height = `${r.height}px`;
  }

  // Resolve the element under a point, ignoring our own overlay nodes.
  function elementUnderCursor(x, y) {
    // Our host has zero size and fixed children with high z-index; temporarily
    // disable pointer events on the host so elementFromPoint sees through it.
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    let el = document.elementFromPoint(x, y);
    host.style.pointerEvents = prev;
    if (!el || isOurs(el)) return null;
    return el;
  }

  function onClickCapture(e) {
    if (!picking) return;
    const el = elementUnderCursor(e.clientX, e.clientY);
    if (!el) return;
    // Stop the host app from reacting to this click.
    e.preventDefault();
    e.stopPropagation();
    captured = el;
    setPicking(false);
    openPanel(el);
  }

  // -------------------------------------------------------------------------
  // Note panel
  // -------------------------------------------------------------------------
  function openPanel(el) {
    selLabel.textContent = safeSelector(el);
    textarea.value = '';
    panel.style.display = 'block';
    sendBtn.disabled = false;
    sendBtn.textContent = 'Senden';
    // Focus after paint so the browser accepts it.
    setTimeout(() => textarea.focus(), 0);
  }

  function closePanel() {
    panel.style.display = 'none';
    captured = null;
  }

  // -------------------------------------------------------------------------
  // 4. Gather payload + send
  // -------------------------------------------------------------------------
  async function send() {
    if (!captured) return;
    const note = textarea.value.trim();
    if (!note) { textarea.focus(); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sende …';

    const el = captured;
    const r = el.getBoundingClientRect();

    // Screenshot is best-effort: never let it block or fail the send.
    const screenshot = await captureScreenshot(el);

    const payload = {
      note,
      selector: safeSelector(el),
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
      screenshot: screenshot || null,
    };

    try {
      const res = await fetch(`${base}/annotation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pinpoint-Token': token,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        closePanel();
        toast('✓ an Claude gesendet');
      } else {
        toast(`Fehler: ${res.status}`, true);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Senden';
      }
    } catch (err) {
      toast('Senden fehlgeschlagen', true);
      sendBtn.disabled = false;
      sendBtn.textContent = 'Senden';
    }
  }

  // Rasterize the element to a PNG data URL, with a timeout so a slow/broken
  // render never blocks the send. Any failure → null.
  async function captureScreenshot(el) {
    try {
      const shot = toPng(el, {
        // Don't fetch/inline @font-face web fonts: on a real app that spams the
        // host console with 404s (and slows capture) for no meaningful gain in
        // an annotation screenshot. The element still renders with live fonts.
        skipFonts: true,
        // Skip our own overlay nodes if html-to-image ever walks up to them.
        filter: (node) => !isOurs(node),
      });
      const guard = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
      return await Promise.race([shot, guard]);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Selector / DOM-path helpers
  // -------------------------------------------------------------------------

  // Prefer @medv/finder for a stable unique selector; fall back to a simple
  // tag + nth-child path if it throws (e.g. detached nodes, exotic docs).
  function safeSelector(el) {
    try {
      return finder(el);
    } catch {
      return simplePath(el);
    }
  }

  // Fallback unique-ish selector: tag:nth-child chain up to <body>.
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

  // Short, human-readable ancestry: "body > main > div.card > button".
  function buildDomPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let seg = node.tagName.toLowerCase();
      // Include the first class (if any) for readability, sanitized.
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

  // -------------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // -------------------------------------------------------------------------
  // Wiring: events
  // -------------------------------------------------------------------------
  fab.addEventListener('click', () => setPicking(!picking));
  cancelBtn.addEventListener('click', closePanel);
  sendBtn.addEventListener('click', send);

  // Cmd/Ctrl+Enter inside the textarea sends quickly.
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });

  // Global listeners (capture phase so we win before the host app).
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('click', onClickCapture, true);
  window.addEventListener('scroll', hideHighlight, true);

  // Keyboard shortcut: Cmd/Ctrl+Shift+K toggles pick mode.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      setPicking(!picking);
    }
  }, true);
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
