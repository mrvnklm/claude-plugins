// pinpoint/overlay.js — v0.2
// In-browser annotation overlay. Bundled by esbuild (platform=browser, format=iife)
// into bridge/overlay.dist.js and injected into the host page by the bridge.
//
// v0.2 model — multi-select CART + task HISTORY + live STATUS via SSE + follow-ups:
//   - Floating "pick" FAB (bottom-right) + Cmd/Ctrl+Shift+K shortcut open the panel
//     and enter pick mode.
//   - In pick mode the element under the cursor is highlighted; each CLICK ADDS that
//     element to the cart (selector, dom path, rect, outerHTML, + a JPEG screenshot)
//     and pick mode STAYS ON so more elements can be collected.
//   - The panel shows the cart (with per-item remove + a live count), a shared task
//     <textarea>, and "Task senden (N)". Send POSTs { task, items[] } to /annotation.
//   - On success the task is pushed into a persisted HISTORY list; each history row
//     carries a status badge (queued/working/done/blocked) and a follow-up input that
//     POSTs { task_id, text } to /followup.
//   - Status updates stream back over an SSE EventSource(/events) and update the
//     matching history row live.
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

      /* Panel */
      .panel {
        position: fixed; bottom: 80px; right: 20px; width: 340px;
        max-height: calc(100vh - 110px);
        background: #fff; color: #111; border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,.28);
        z-index: 2147483647; display: none;
        border: 1px solid rgba(0,0,0,.08);
        overflow: hidden;
        flex-direction: column;
      }
      .panel.open { display: flex; }

      .hd {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-bottom: 1px solid #eef0f2;
      }
      .hd .ttl { font-size: 13px; font-weight: 700; color: #111; flex: 0 0 auto; }
      .hd .spacer { flex: 1 1 auto; }
      .pick-toggle {
        border: 1px solid #d1d5db; background: #fff; color: #374151;
        border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer;
        font-weight: 600;
      }
      .pick-toggle.on { background: #10b981; border-color: #10b981; color: #fff; }
      .hd .x {
        border: none; background: transparent; color: #9ca3af; cursor: pointer;
        font-size: 15px; line-height: 1; padding: 2px 4px;
      }
      .hd .x:hover { color: #374151; }

      .body { overflow-y: auto; padding: 12px; }

      /* Cart */
      .cart-count { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px; }
      .cart-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
      .cart-empty {
        font-size: 12px; color: #9ca3af; padding: 10px; text-align: center;
        border: 1px dashed #e5e7eb; border-radius: 8px;
      }
      .cart-item {
        display: flex; align-items: center; gap: 8px;
        background: #f9fafb; border: 1px solid #eef0f2; border-radius: 8px;
        padding: 6px 8px;
      }
      .cart-item .idx {
        flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%;
        background: #10b981; color: #fff; font-size: 10px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
      }
      .cart-item .meta { flex: 1 1 auto; min-width: 0; }
      .cart-item .sel {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; color: #374151; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .cart-item .sub { font-size: 10px; color: #9ca3af; }
      .cart-item .rm {
        flex: 0 0 auto; border: none; background: transparent; color: #9ca3af;
        cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px;
      }
      .cart-item .rm:hover { color: #ef4444; }

      textarea.task {
        width: 100%; min-height: 72px; resize: vertical;
        border: 1px solid #d1d5db; border-radius: 8px; padding: 8px;
        font-size: 13px; color: #111; outline: none; font-family: inherit;
      }
      textarea.task:focus { border-color: #10b981; }

      .row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
      .btn {
        border: none; border-radius: 8px; padding: 7px 14px;
        font-size: 13px; cursor: pointer; font-weight: 600;
      }
      .btn-primary { background: #10b981; color: #fff; }
      .btn-primary:disabled { opacity: .5; cursor: default; }
      .btn-ghost { background: #f3f4f6; color: #374151; }

      /* History */
      .hist-sec { border-top: 1px solid #eef0f2; margin-top: 12px; padding-top: 10px; }
      .hist-title { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
      .hist-empty { font-size: 12px; color: #9ca3af; }
      .hist-list { display: flex; flex-direction: column; gap: 8px; }
      .hist-row { border: 1px solid #eef0f2; border-radius: 8px; padding: 8px; }
      .hist-main { display: flex; align-items: center; gap: 8px; }
      .badge {
        flex: 0 0 auto; font-size: 10px; font-weight: 700; border-radius: 999px;
        padding: 2px 8px; text-transform: uppercase; letter-spacing: .03em;
      }
      .badge-queued  { background: #f3f4f6; color: #6b7280; }
      .badge-working { background: #fef3c7; color: #b45309; }
      .badge-done    { background: #d1fae5; color: #047857; }
      .badge-blocked { background: #fee2e2; color: #b91c1c; }
      .hist-note { flex: 1 1 auto; min-width: 0; font-size: 12px; color: #374151;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hist-id { color: #9ca3af; font-weight: 600; }
      .hist-fu { display: flex; gap: 6px; margin-top: 8px; }
      .hist-fu input {
        flex: 1 1 auto; min-width: 0; border: 1px solid #e5e7eb; border-radius: 6px;
        padding: 5px 8px; font-size: 12px; color: #111; outline: none; font-family: inherit;
      }
      .hist-fu input:focus { border-color: #10b981; }
      .btn-fu {
        flex: 0 0 auto; border: none; background: #f3f4f6; color: #374151;
        border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; font-weight: 700;
      }
      .btn-fu:hover { background: #e5e7eb; }

      /* Toast */
      .toast {
        position: fixed; bottom: 80px; right: 20px;
        background: #111; color: #fff; padding: 10px 16px; border-radius: 8px;
        font-size: 13px; z-index: 2147483647; opacity: 0;
        transition: opacity .2s; pointer-events: none;
        box-shadow: 0 4px 14px rgba(0,0,0,.3); max-width: 320px;
      }
      .toast.show { opacity: 1; }
      .toast.err { background: #b91c1c; }
      .toast.warn { background: #b45309; }
    </style>

    <button class="fab" title="Annotieren (Cmd/Ctrl+Shift+K)">◎</button>
    <div class="highlight"></div>

    <div class="panel">
      <div class="hd">
        <span class="ttl">Pinpoint</span>
        <span class="spacer"></span>
        <button class="pick-toggle" data-act="toggle-pick">Auswahl: AUS</button>
        <button class="x" data-act="close" title="Schließen">✕</button>
      </div>
      <div class="body">
        <div class="cart-count"></div>
        <div class="cart-list"></div>
        <textarea class="task" placeholder="Was soll an diesen Elementen passieren? …"></textarea>
        <div class="row">
          <button class="btn btn-ghost" data-act="cancel">Abbrechen</button>
          <button class="btn btn-primary" data-act="send">Task senden (0)</button>
        </div>

        <div class="hist-sec">
          <div class="hist-title">Verlauf</div>
          <div class="hist-list"></div>
        </div>
      </div>
    </div>

    <div class="toast"></div>
  `;

  // Cache element refs.
  const fab        = root.querySelector('.fab');
  const highlight  = root.querySelector('.highlight');
  const panel      = root.querySelector('.panel');
  const pickToggle = root.querySelector('[data-act="toggle-pick"]');
  const cartCountEl= root.querySelector('.cart-count');
  const cartListEl = root.querySelector('.cart-list');
  const textarea   = root.querySelector('textarea.task');
  const sendBtn    = root.querySelector('[data-act="send"]');
  const cancelBtn  = root.querySelector('[data-act="cancel"]');
  const closeBtn   = root.querySelector('[data-act="close"]');
  const histListEl = root.querySelector('.hist-list');
  const toastEl    = root.querySelector('.toast');

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let picking = false;   // in element-pick mode?
  let sending = false;   // a send is in flight
  let uidSeq = 0;        // local id counter for cart items
  let cart = [];         // [{ uid, selector, url, title, viewport, rect, domPath, outerHtml, sourceHint, screenshot, capturing }]
  let tasks = loadTasks(); // persisted history: [{ id, note, count, status, ts }]

  // -------------------------------------------------------------------------
  // 3. Panel open/close + pick mode
  // -------------------------------------------------------------------------
  function isOpen() {
    return panel.classList.contains('open');
  }

  function openPanel() {
    panel.classList.add('open');
    renderAll();
    setPicking(true);
  }

  function closePanel() {
    panel.classList.remove('open');
    setPicking(false);
  }

  function togglePanel() {
    if (isOpen()) closePanel();
    else openPanel();
  }

  function setPicking(on) {
    picking = on;
    fab.classList.toggle('active', on);
    fab.textContent = on ? '✕' : '◎';
    pickToggle.classList.toggle('on', on);
    pickToggle.textContent = on ? 'Auswahl: AN' : 'Auswahl: AUS';
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
    // Our host has fixed children with high z-index; temporarily disable pointer
    // events on the host so elementFromPoint sees through it.
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    host.style.pointerEvents = prev;
    if (!el || isOurs(el)) return null;
    return el;
  }

  function onClickCapture(e) {
    if (!picking) return;
    // A click on our own overlay (FAB, buttons, textarea, cart rows …) must reach
    // its own handler, not be captured as a target pick.
    if (e.composedPath && e.composedPath().includes(host)) return;
    const el = elementUnderCursor(e.clientX, e.clientY);
    if (!el) return;
    // Stop the host app from reacting to this click.
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
    const item = {
      uid: ++uidSeq,
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
      screenshot: null,
      capturing: true,
    };
    cart.push(item);
    renderCart();

    if (cart.length > SOFT_LIMIT) {
      toast(`Viele Elemente (${cart.length}) — ggf. in mehrere Tasks aufteilen`, 'warn');
    }

    // Screenshot is best-effort and async; fill it in when ready.
    captureScreenshot(el).then((shot) => {
      // The item may have been removed while we were rasterizing.
      const live = cart.find((c) => c.uid === item.uid);
      if (!live) return;
      live.screenshot = shot || null;
      live.capturing = false;
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
    cartCountEl.textContent = n === 1 ? '1 Element' : `${n} Elemente`;
    sendBtn.textContent = `Task senden (${n})`;
    sendBtn.disabled = sending || n === 0;

    if (n === 0) {
      cartListEl.innerHTML =
        '<div class="cart-empty">Auswahl-Modus aktiv — klicke Elemente auf der Seite an.</div>';
      return;
    }

    cartListEl.innerHTML = cart
      .map((c, i) => {
        const sub = c.capturing ? 'Screenshot …' : (c.screenshot ? 'Screenshot ✓' : 'kein Screenshot');
        return `
          <div class="cart-item" data-uid="${c.uid}">
            <span class="idx">${i + 1}</span>
            <span class="meta">
              <span class="sel">${escapeHtml(c.selector)}</span>
              <span class="sub">${sub}</span>
            </span>
            <button class="rm" data-uid="${c.uid}" title="Entfernen">✕</button>
          </div>`;
      })
      .join('');
  }

  // Rasterize the element to a JPEG data URL, with a timeout so a slow/broken
  // render never blocks the flow. Any failure → null.
  async function captureScreenshot(el) {
    try {
      const shot = toJpeg(el, {
        quality: 0.85,
        // Don't fetch/inline @font-face web fonts: on a real app that spams the
        // host console with 404s for no meaningful gain in an annotation shot.
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
  // 5. Send the task (batch of cart items)
  // -------------------------------------------------------------------------
  async function send() {
    if (sending) return;
    if (cart.length === 0) return;
    const taskText = textarea.value.trim();
    if (!taskText) { textarea.focus(); toast('Bitte eine Aufgabe eingeben', 'warn'); return; }

    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sende …';

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
        let taskId = '';
        try {
          const body = await res.json();
          taskId = body && body.task_id != null ? String(body.task_id) : '';
        } catch { /* ignore parse issues; still succeeded */ }

        tasks.unshift({
          id: taskId,
          note: taskText,
          count: items.length,
          status: 'queued',
          ts: Date.now(),
        });
        saveTasks();

        clearCart();
        textarea.value = '';
        setPicking(false); // exit pick mode; keep the panel open to watch status
        renderHistory();
        toast(`✓ Task #${taskId || '?'} gesendet (${items.length})`);
      } else {
        toast(`Fehler: ${res.status}`, 'err');
      }
    } catch {
      toast('Senden fehlgeschlagen', 'err');
    } finally {
      sending = false;
      renderCart(); // restores the "Task senden (N)" label / disabled state
    }
  }

  // -------------------------------------------------------------------------
  // 6. History + follow-ups
  // -------------------------------------------------------------------------
  function renderHistory() {
    if (!tasks.length) {
      histListEl.innerHTML = '<div class="hist-empty">Noch keine Tasks gesendet.</div>';
      return;
    }
    histListEl.innerHTML = tasks
      .map((t) => {
        const status = normalizeStatus(t.status);
        const idLabel = t.id ? `#${escapeHtml(String(t.id))} ` : '';
        return `
          <div class="hist-row" data-id="${escapeHtml(String(t.id))}">
            <div class="hist-main">
              <span class="badge badge-${status}">${status}</span>
              <span class="hist-note"><span class="hist-id">${idLabel}</span>${escapeHtml(t.note || '')}</span>
            </div>
            <div class="hist-fu">
              <input type="text" placeholder="Follow-up …" data-id="${escapeHtml(String(t.id))}" />
              <button class="btn-fu" data-id="${escapeHtml(String(t.id))}" title="Follow-up senden">→</button>
            </div>
          </div>`;
      })
      .join('');
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
        if (inputEl) inputEl.value = '';
        toast(`✓ Follow-up zu #${taskId} gesendet`);
      } else {
        toast(`Fehler: ${res.status}`, 'err');
      }
    } catch {
      toast('Follow-up fehlgeschlagen', 'err');
    }
  }

  function renderAll() {
    renderCart();
    renderHistory();
  }

  // -------------------------------------------------------------------------
  // 7. Status stream (SSE)
  // -------------------------------------------------------------------------
  function connectStatus() {
    let es;
    try {
      es = new EventSource(`${base}/events`);
    } catch {
      return; // no SSE support / blocked — history still works, just no live status
    }
    es.onmessage = (ev) => {
      // Comment lines (": connected", ":ka") are never delivered here by the
      // browser; only "data:" frames arrive. Guard the parse anyway.
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || msg.type !== 'status' || msg.task_id == null) return;
      const t = tasks.find((x) => String(x.id) === String(msg.task_id));
      if (!t) return;
      t.status = normalizeStatus(msg.status);
      if (typeof msg.note === 'string' && msg.note) t.statusNote = msg.note;
      saveTasks();
      renderHistory();
    };
    // Native EventSource auto-reconnects on error; nothing to do but swallow it.
    es.onerror = () => { /* auto-reconnect */ };
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
      // Keep the list bounded so localStorage never grows without limit.
      if (tasks.length > 50) tasks = tasks.slice(0, 50);
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch { /* storage full / blocked — non-fatal */ }
  }

  function normalizeStatus(s) {
    const v = String(s || '').toLowerCase();
    return (v === 'working' || v === 'done' || v === 'blocked') ? v : 'queued';
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

  // Minimal HTML escaping for text we inject into innerHTML.
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
    toastEl.textContent = msg;
    toastEl.classList.remove('err', 'warn');
    if (kind === 'err') toastEl.classList.add('err');
    else if (kind === 'warn') toastEl.classList.add('warn');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // -------------------------------------------------------------------------
  // Wiring: events
  // -------------------------------------------------------------------------
  fab.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', closePanel);
  pickToggle.addEventListener('click', () => setPicking(!picking));
  cancelBtn.addEventListener('click', clearCart);
  sendBtn.addEventListener('click', send);

  // Cart list: per-item remove (event delegation).
  cartListEl.addEventListener('click', (e) => {
    const rm = e.target.closest('.rm');
    if (!rm) return;
    const uid = Number(rm.getAttribute('data-uid'));
    if (uid) removeFromCart(uid);
  });

  // History list: follow-up send (event delegation).
  histListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-fu');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const input = histListEl.querySelector(`.hist-fu input[data-id="${cssEscape(id)}"]`);
    sendFollowup(id, input ? input.value : '', input);
  });
  histListEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.hist-fu input');
    if (!input) return;
    e.preventDefault();
    sendFollowup(input.getAttribute('data-id'), input.value, input);
  });

  // Cmd/Ctrl+Enter inside the task textarea sends; Escape closes the panel.
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

  // Keyboard shortcut: Cmd/Ctrl+Shift+K toggles the panel + pick mode.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      togglePanel();
    }
  }, true);

  // Escape a value for use inside an attribute selector (older engines lack CSS.escape).
  function cssEscape(v) {
    const s = String(v);
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return s.replace(/["\\\]]/g, '\\$&');
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  connectStatus();
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
