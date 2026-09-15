// Bundled by scripts/build-web.js
(() => {
'use strict';

// --- File: web/src/state.js ---
// web/src/state.js
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const request = async (method, path, params) => {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const r = await fetch(u, { method });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};
const api = (path, params) => request('GET', path, params);
// For requests that change the machine; the server only accepts these as POST from this page.
const apiPost = (path, params) => request('POST', path, params);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
// navigator.platform is deprecated but is still the only signal some browsers give.
const isMac = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const MOD = isMac ? 'metaKey' : 'ctrlKey';

/* Shortcuts are written once, as "Mod+Shift+F", and shown the way the reader's
   keyboard labels them: ⌘⇧F on a Mac, Ctrl+Shift+F elsewhere. Mod is the key MOD
   tests: Cmd on a Mac, Ctrl elsewhere. "A|B" shows A off the Mac and B on it,
   for shortcuts that differ; an empty side means none on that system. */
const MAC_KEYS = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↩', Left: '←', Right: '→', Up: '↑', Down: '↓' };
const PC_KEYS = { Mod: 'Ctrl', Left: '←', Right: '→', Up: '↑', Down: '↓' };

const keyParts = combo => {
  const c = combo.includes('|') ? combo.split('|')[isMac ? 1 : 0] : combo;
  return c ? c.split('+').map(k => (isMac ? MAC_KEYS : PC_KEYS)[k] || k) : [];
};
const keyLabel = combo => {
  const parts = keyParts(combo);
  if (!isMac) return parts.join('+');
  const key = parts.pop() || '';
  // Mac symbols run together (⌘⇧F); a spelled-out key gets a space (⌘ Click).
  return parts.join('') + (parts.length && /^[a-z]{2,}$/i.test(key) ? ' ' : '') + key;
};
const keyCaps = combo => keyParts(combo).map(k => '<kbd>' + esc(k) + '</kbd>').join('');

// "Go to File ({Mod+P})" -> "Go to File (⌘P)"
const withKeys = text => text.replace(/\{([^}]+)\}/g, (_, combo) => keyLabel(combo));

/* Static markup names shortcuts the same way: data-keys fills a label, data-caps
   fills key caps, and {combo} in a title is replaced. */
function applyKeyLabels(root = document) {
  for (const el of $$('[data-keys]', root)) el.textContent = keyLabel(el.dataset.keys);
  for (const el of $$('[data-caps]', root)) el.innerHTML = keyCaps(el.dataset.caps);
  for (const el of $$('[title*="{"]', root)) el.title = withKeys(el.title);
}
const LH = 20, CHUNK = 1000, OVERSCAN = 24;
const S = {
  meta: null,
  tabs: [],
  active: -1,
  hist: [], histIdx: -1,
  find: null,         // {q, ci, hits:[{line,n}], active}
  occ: null,          // word to highlight everywhere
  selAll: null,       // doc whose whole text is selected (Ctrl+A)
  lastWord: '',
  at: null,           // {word, line, col} of the last click in the code area
  link: null,         // identifier currently underlined under a held modifier
  hover: null,        // identifier the hover card is describing
  hoverAnchor: null,  // where the card was opened, to cheaply detect leaving
  lsp: { servers: [], state: 'off', server: '' },
  gen: 0,
  chW: 7.8,
  wrap: true,        // word wrap (default ON)
  lineNumbers: true, // line numbers gutter (default ON)
  mdPreview: true,   // Markdown tabs open rendered (default ON)
  htmlPreview: true, // HTML tabs open rendered (default ON)
};
const doc_ = () => (S.active >= 0 ? S.tabs[S.active] : null);

// --- File: web/src/ui.js ---
// web/src/ui.js
const vp = $('#viewport');
const sizer = $('#sizer');
const rowsEl = $('#rows');
const editor = $('#editor');
const toastEl = $('#toast');

let toastTimer = 0;
function showToast(accentText, text) {
  if (!toastEl) return;
  toastEl.innerHTML = (accentText ? '<span class="toast-accent">' + esc(accentText) + '</span> ' : '') + esc(text);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

async function copyToClipboard(text, notify = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓', notify);
  } catch {
    // Fallback for non-https/restricted contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('✓', notify);
    } catch (err) {
      showToast('!', 'Failed to copy to clipboard');
    }
    document.body.removeChild(ta);
  }
}

// --- File: web/src/renderer.js ---
// web/src/renderer.js


function measure() {
  const m = $('#measure');
  m.textContent = 'x'.repeat(100);
  S.chW = m.getBoundingClientRect().width / 100 || 7.8;
}

function layout() {
  const d = doc_();
  if (!d) return;
  const digits = String(d.total).length;
  editor.style.setProperty('--gw', digits);
  const gutter = S.lineNumbers ? (digits * S.chW + 30) : 16;
  const w = S.wrap ? vp.clientWidth : Math.max(vp.clientWidth, gutter + (d.maxCols + 4) * S.chW);
  sizer.style.height = (d.total * LH + Math.max(120, vp.clientHeight * 0.5)) + 'px';
  sizer.style.width = w + 'px';
  rowsEl.style.width = w + 'px';
}

function toggleWordWrap(forced) {
  S.wrap = typeof forced === 'boolean' ? forced : !S.wrap;
  document.body.classList.toggle('word-wrap', S.wrap);
  try { localStorage.setItem('px0.wrap', S.wrap ? 'true' : 'false'); } catch {}
  updateEditorOptionControls();
  layout();
  render();
}

function toggleLineNumbers(forced) {
  S.lineNumbers = typeof forced === 'boolean' ? forced : !S.lineNumbers;
  document.body.classList.toggle('hide-lines', !S.lineNumbers);
  try { localStorage.setItem('px0.lineNumbers', S.lineNumbers ? 'true' : 'false'); } catch {}
  updateEditorOptionControls();
  layout();
  render();
}

function updateEditorOptionControls() {
  const wrapBtn = $('[data-action="wrap"]');
  if (wrapBtn) wrapBtn.classList.toggle('active', !!S.wrap);
  const linesBtn = $('[data-action="line-numbers"]');
  if (linesBtn) linesBtn.classList.toggle('active', !!S.lineNumbers);
}

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

function paint() {
  const d = doc_();
  if (!d) { const c = $('#caret'); if (c) c.hidden = true; return; }
  const top = vp.scrollTop;
  const first = Math.max(0, Math.floor(top / LH) - OVERSCAN);
  const count = Math.ceil(vp.clientHeight / LH) + OVERSCAN * 2;
  const last = Math.min(d.total, first + count);
  ensureChunks(d, first, last);

  let html = '';
  const gut = d.gutter || null;
  for (let i = first; i < last; i++) {
    const n = i + 1;
    const body = d.lines[i];
    let rc = 'row', gc = 'g';
    if (n === d.cur) rc += ' cur';
    if (gut) {
      const m = gut.marks.get(n);
      if (m) gc += m === 'add' ? ' gut-add' : ' gut-mod';
      if (gut.dels.has(n)) rc += ' gut-del';
    }
    html += '<div class="' + rc + '" data-l="' + n + '">' +
      '<div class="' + gc + '">' + n + '</div><div class="c">' + (body === undefined ? '' : body) + '</div></div>';
  }
  const sel = saveSelection();
  rowsEl.style.transform = 'translateY(' + (first * LH) + 'px)';
  rowsEl.innerHTML = html;
  rowsEl.classList.toggle('all', S.selAll === d);
  decorate(first, last);
  if (sel) restoreSelection(sel);
  placeCaret();
}

let caretKey = '';

/* Position the caret at d.cur / d.col (UTF-16 units into the line's text,
   clamped to its length). It lives in #sizer rather than inside a row: rows are
   rewritten on every paint, and their text nodes are what selection restore and
   word lookup measure. Returns the caret's x within #sizer, or null if hidden. */
function placeCaret() {
  const el = $('#caret');
  if (!el) return null;
  const d = doc_();
  const row = d && rowFor(d.cur);
  if (!row) { el.hidden = true; return null; }
  const code = $('.c', row);
  const col = Math.max(0, Math.min(d.col || 0, code.textContent.length));
  const [node, off] = toPoint({ line: d.cur, col });
  const base = sizer.getBoundingClientRect();
  let x, y;
  if (node.nodeType === 3) {
    const r = document.createRange();
    r.setStart(node, off);
    r.collapse(true);
    const rect = r.getClientRects()[0] || r.getBoundingClientRect();
    x = rect.left;
    // Wrapped rows are taller than one line; otherwise pin to the row's top.
    y = S.wrap ? rect.top - (LH - rect.height) / 2 : row.getBoundingClientRect().top;
  } else {
    const cr = code.getBoundingClientRect();
    x = cr.left + parseFloat(getComputedStyle(code).paddingLeft || '0');
    y = cr.top;
  }
  // Scrolled horizontally under the sticky gutter: hide rather than draw over it.
  const g = $('.g', row);
  if (g && S.lineNumbers && x < g.getBoundingClientRect().right - 1) { el.hidden = true; return null; }
  el.style.transform = 'translate(' + (x - base.left) + 'px,' + (y - base.top) + 'px)';
  el.hidden = false;
  const key = d.path + ':' + d.cur + ':' + col;
  if (key !== caretKey) {
    caretKey = key;
    el.classList.remove('blink');
    void el.offsetWidth; // restart the blink so a moving caret stays solid
    el.classList.add('blink');
  }
  return x - base.left;
}

/* Rewriting the rows destroys any live DOM selection, and paint runs on far
   more than scrolls: pressing Ctrl to underline a link, a double-click, a
   background highlight refresh. Carry the selection across as line/column
   positions so Ctrl+C still has something to copy. */
function saveSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  if (!rowsEl.contains(sel.getRangeAt(0).commonAncestorContainer)) return null;
  const a = toPos(sel.anchorNode, sel.anchorOffset);
  const f = toPos(sel.focusNode, sel.focusOffset);
  return a && f ? { a, f } : null;
}

function restoreSelection({ a, f }) {
  const pa = toPoint(a), pf = toPoint(f);
  if (pa && pf) window.getSelection().setBaseAndExtent(pa[0], pa[1], pf[0], pf[1]);
}

/* DOM boundary point -> { line, col } with col counted in the line's text. */
function toPos(node, off) {
  if (node === rowsEl) {
    const row = rowsEl.children[off] || rowsEl.lastElementChild;
    if (!row) return null;
    const atEnd = !rowsEl.children[off];
    return { line: +row.dataset.l, col: atEnd ? $('.c', row).textContent.length : 0 };
  }
  const el = node.nodeType === 1 ? node : node.parentElement;
  const row = el && el.closest('.row');
  if (!row || !rowsEl.contains(row)) return null;
  const code = $('.c', row);
  const r = document.createRange();
  r.selectNodeContents(code);
  const cmp = r.comparePoint(node, off);
  if (cmp < 0) return { line: +row.dataset.l, col: 0 };
  if (cmp > 0) return { line: +row.dataset.l, col: code.textContent.length };
  r.setEnd(node, off);
  return { line: +row.dataset.l, col: r.toString().length };
}

/* { line, col } -> DOM boundary point in the freshly painted rows, or null when
   that line has scrolled out of the rendered window. */
function toPoint({ line, col }) {
  const row = rowFor(line);
  if (!row) return null;
  const code = $('.c', row);
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let at = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue.length;
    if (col <= at + len) return [n, col - at];
    at += len;
  }
  return [code, code.childNodes.length];
}

/* Decorations are applied to the ~60 live rows only, never to the whole file. */
function decorate(first, last) {
  const d = doc_();
  if (S.occ) {
    for (const row of rowsEl.children) markNodes($('.c', row), S.occ, true, 'occ');
  }
  if (S.link) {
    const row = rowFor(S.link.line);
    const start = S.link.startCol !== undefined ? S.link.startCol : S.link.col;
    const end = S.link.endCol !== undefined ? S.link.endCol : S.link.col + S.link.word.length;
    if (row) wrapRange($('.c', row), start, end, 'link');
  }
  if (S.find && S.find.hits.length) {
    const byLine = S.find.byLine;
    const act = S.find.hits[S.find.active];
    for (const row of rowsEl.children) {
      const n = +row.dataset.l;
      if (!byLine.has(n)) continue;
      const marks = markNodes($('.c', row), S.find.q, S.find.ci, 'mark');
      if (act && act.line === n && marks[act.n]) marks[act.n].classList.add('on');
    }
  }
  void first; void last;
}

/* Wrap every occurrence of needle inside el, walking text nodes so the
   pre-highlighted token markup is never disturbed. */
function markNodes(el, needle, caseSensitive, cls) {
  if (!el || !needle) return [];
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  for (const node of texts) {
    const raw = node.nodeValue;
    const hay = caseSensitive ? raw : raw.toLowerCase();
    const nd = caseSensitive ? needle : needle.toLowerCase();
    let i = hay.indexOf(nd), at = 0;
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    while (i >= 0) {
      if (i > at) frag.appendChild(document.createTextNode(raw.slice(at, i)));
      const mk = document.createElement(cls === 'mark' ? 'mark' : 'span');
      if (cls !== 'mark') mk.className = cls;
      mk.textContent = raw.slice(i, i + nd.length);
      frag.appendChild(mk);
      out.push(mk);
      at = i + nd.length;
      i = hay.indexOf(nd, at);
    }
    if (at < raw.length) frag.appendChild(document.createTextNode(raw.slice(at)));
    node.parentNode.replaceChild(frag, node);
  }
  return out;
}

/* Wrap the half-open character range [from, to) of el in a span. Unlike the
   needle search used for find, this targets one exact occurrence, which is what
   a position-based decoration needs. */
function wrapRange(el, from, to, cls) {
  if (!el || to <= from) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  let at = 0, out = null;
  for (const node of nodes) {
    const len = node.nodeValue.length;
    const s = Math.max(from, at), e = Math.min(to, at + len);
    if (s < e) {
      const a = s - at, b = e - at;
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = node.nodeValue.slice(a, b);
      const frag = document.createDocumentFragment();
      if (a > 0) frag.appendChild(document.createTextNode(node.nodeValue.slice(0, a)));
      frag.appendChild(span);
      if (b < len) frag.appendChild(document.createTextNode(node.nodeValue.slice(b)));
      node.parentNode.replaceChild(frag, node);
      out = out || span;
    }
    at += len;
    if (at >= to) break;
  }
  return out;
}

function rowFor(line) {
  for (const r of rowsEl.children) if (+r.dataset.l === line) return r;
  return null;
}

function ensureChunks(d, first, last) {
  const c0 = Math.floor(first / CHUNK), c1 = Math.floor(Math.max(first, last - 1) / CHUNK);
  for (let c = c0; c <= c1; c++) {
    if (d.chunks.has(c) || d.pending.has(c)) continue;
    d.pending.add(c);
    const gen = d.gen;
    api('/api/file', { path: d.path, start: c * CHUNK, count: CHUNK })
      .then(j => {
        if (gen !== d.gen) return; // superseded by a background highlight swap
        for (let i = 0; i < j.lines.length; i++) d.lines[j.start + i] = j.lines[i];
        d.chunks.add(c); d.pending.delete(c);
        if (doc_() === d) render();
        if (j.refine) refineChunk(d, c);
      })
      .catch(() => d.pending.delete(c));
  }
}

/* A window whose surrounding context was too short to close a very long string
   or comment is served as "inexact". The server's full-file pass settles it a
   moment later, so come back for that chunk and swap in the corrected lines. */
function refineChunk(d, c, delay = 800, tries = 0) {
  if (tries === 0) {
    if (d.refining.has(c)) return;
    d.refining.add(c);
  }
  setTimeout(async () => {
    if (!S.tabs.includes(d) || tries > 6) { d.refining.delete(c); return; }
    let j;
    try { j = await api('/api/file', { path: d.path, start: c * CHUNK, count: CHUNK }); }
    catch { d.refining.delete(c); return; }
    if (!S.tabs.includes(d)) { d.refining.delete(c); return; }
    if (!j.exact) { refineChunk(d, c, Math.min(delay * 1.6, 5000), tries + 1); return; }
    d.refining.delete(c);
    let changed = false;
    for (let i = 0; i < j.lines.length; i++) {
      if (d.lines[j.start + i] !== j.lines[i]) { d.lines[j.start + i] = j.lines[i]; changed = true; }
    }
    if (changed && doc_() === d) render();
  }, delay);
}

function initRenderer() {
  vp.addEventListener('scroll', render, { passive: true });
  new ResizeObserver(() => { layout(); render(); }).observe(editor);
}

// --- File: web/src/history.js ---
// web/src/history.js


function pushHistory(path, line) {
  const top = S.hist[S.histIdx];
  if (top && top.path === path && Math.abs(top.line - line) < 2) return;
  S.hist = S.hist.slice(0, S.histIdx + 1);
  S.hist.push({ path, line });
  if (S.hist.length > 120) S.hist.shift();
  S.histIdx = S.hist.length - 1;
}

function go(delta) {
  const i = S.histIdx + delta;
  if (i < 0 || i >= S.hist.length) return;
  S.histIdx = i;
  const h = S.hist[i];
  openFile(h.path, { line: h.line, push: false });
}

// --- File: web/src/outline.js ---
// web/src/outline.js





async function loadOutline() {
  const d = doc_();
  const el = $('#outline');
  if (!d) { if (el) el.innerHTML = '<div class="hint">No file open.</div>'; return; }
  if (!d.outline) {
    try { d.outline = (await api('/api/outline', { path: d.path })).symbols || []; }
    catch { d.outline = []; }
  }
  drawOutline();
  upgradeOutline(d);
}

/* A language server's document symbols beat regex on every axis, so swap them
   in whenever one answers. Panel only: this never moves the viewport. */
async function upgradeOutline(d) {
  if (d.outlineLSP || S.lsp.state === 'off' || S.lsp.state === 'failed') return;
  d.outlineLSP = true;
  let j;
  try { j = await api('/api/lsp/symbols', { path: d.path, wait: 20000 }); }
  catch { d.outlineLSP = false; return; }
  setLspState(j);
  if (!j.symbols || !j.symbols.length) { d.outlineLSP = false; return; }
  d.outline = j.symbols;
  d.outlineSource = j.server;
  if (doc_() === d && $('#panel-outline')?.classList.contains('active')) drawOutline();
}

function drawOutline() {
  const d = doc_();
  const el = $('#outline');
  const rel = $('#right-symbols-list');
  if (!d || !d.outline) {
    if (el) el.innerHTML = '<div class="hint">No symbols found.</div>';
    if (rel) rel.innerHTML = '<div class="hint">No symbols found.</div>';
    return;
  }
  const f = ($('#outline-filter')?.value || '').toLowerCase();
  const rf = ($('#right-symbols-filter')?.value || '').toLowerCase();

  const syms = f ? d.outline.filter(s => s.name.toLowerCase().includes(f)) : d.outline;
  const rsyms = rf ? d.outline.filter(s => s.name.toLowerCase().includes(rf)) : d.outline;

  const renderSymHtml = (items) => {
    if (!items.length) return '<div class="hint">No symbols found.</div>';
    const base = Math.min(...items.map(s => s.indent));
    return (d.outlineSource ? '<div class="hint"><span class="src">' + esc(d.outlineSource) + '</span> · ' + items.length + ' symbols</div>' : '') +
      items.map(s =>
      '<div class="sym" data-n="' + s.line + '" style="padding-left:' + (10 + Math.min(s.indent - base, 16) * 5) + 'px" title="Jump to ' + esc(s.name) + ' at line ' + s.line + '">' +
      '<span class="kd" data-k="' + esc(s.kind) + '">' + esc(kindLabel(s.kind)) + '</span>' +
      '<span class="sn">' + esc(s.name) + '</span><span class="sl">' + s.line + '</span></div>').join('');
  };

  if (el) el.innerHTML = renderSymHtml(syms);
  if (rel) rel.innerHTML = renderSymHtml(rsyms);
}
const KIND_LABEL = {
  func: 'fn', method: 'fn', fn: 'fn', def: 'fn', defp: 'fn', defmacro: 'mac',
  class: 'cls', struct: 'str', interface: 'int', trait: 'trt', impl: 'impl',
  type: 'typ', typealias: 'typ', enum: 'enm', record: 'rec', object: 'obj',
  const: 'cst', var: 'var', let: 'var', val: 'var',
  module: 'mod', mod: 'mod', namespace: 'ns', defmodule: 'mod', package: 'pkg',
  macro: 'mac', extension: 'ext', protocol: 'int', union: 'uni',
  heading: 'h', sym: '·',
};

function kindLabel(k) { return KIND_LABEL[k] || k.slice(0, 3); }

function initOutline() {
  $('#outline')?.addEventListener('click', e => {
    const s = e.target.closest('.sym');
    if (!s) return;
    $$('.sym.sel').forEach(x => x.classList.remove('sel'));
    s.classList.add('sel');
    const d = doc_(); if (!d) return;
    d.cur = +s.dataset.n; centerLine(d.cur); render(); updateStatus();
    pushHistory(d.path, d.cur);
  });
  $('#outline-filter')?.addEventListener('input', drawOutline);
}

// --- File: web/src/tree.js ---
// web/src/tree.js
const treeEl = $('#tree');
const openDirs = new Set();

/* git status letter -> CSS class + label. Empty/absent = clean, no badge. */
const GIT_STATUS = {
  M: ['git-M', 'modified'], A: ['git-A', 'added'], D: ['git-D', 'deleted'],
  U: ['git-untracked', 'untracked'], R: ['git-R', 'renamed'],
  C: ['git-A', 'copied'], '!': ['git-M', 'unmerged'],
};

async function drawTree(dir, container, depth) {
  let j;
  try { j = await api('/api/tree', { dir }); } catch { return; }
  container.innerHTML = j.children.map(c => {
    const pad = 8 + depth * 12;
    // Ignored by .gitignore: still browsable, dimmed, and absent from search.
    const ig = c.ignored ? ' ignored' : '';
    const note = c.ignored ? ' (ignored by .gitignore, not searched)' : '';
    if (c.dir) {
      const dc = c.dirty ? ' dirty' : ''; // backend marks any ancestor of a change
      return '<div class="tw"><div class="tr dir' + ig + dc + '" data-dir="' + esc(c.path) + '" style="padding-left:' + pad + 'px" title="Folder: ' + esc(c.path) + note + '">' +
        '<span class="ar"></span><span class="nm">' + esc(c.name) + '</span></div>' +
        '<div class="kids" data-kids="' + esc(c.path) + '"></div></div>';
    }
    const g = GIT_STATUS[c.status];
    const gc = g ? ' dirty ' + g[0] : '';
    const badge = g ? '<span class="gs" title="git: ' + g[1] + '">' + esc(c.status) + '</span>' : '';
    return '<div class="tr file' + ig + gc + '" data-file="' + esc(c.path) + '" style="padding-left:' + (pad + 12) + 'px" title="Open ' + esc(c.path) + note + '">' +
      '<span class="ic" data-t="' + fileKind(c.name) + '"></span><span class="nm">' + esc(c.name) + '</span>' + badge + '</div>';
  }).join('');
}

/* A colour family per file kind, drawn in CSS. Emoji or icon fonts would be at
   the mercy of whatever the viewer has installed. */
const FILE_KIND = {
  go: 'code', js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  py: 'code', rb: 'code', rs: 'code', java: 'code', kt: 'code', c: 'code', h: 'code',
  cc: 'code', cpp: 'code', hpp: 'code', cs: 'code', php: 'code', swift: 'code',
  lua: 'code', ex: 'code', exs: 'code', scala: 'code', dart: 'code', sh: 'code',
  bash: 'code', zsh: 'code', sql: 'code',
  json: 'data', yaml: 'data', yml: 'data', toml: 'data', ini: 'data', xml: 'data',
  csv: 'data', env: 'data', lock: 'data', mod: 'data', sum: 'data',
  md: 'doc', markdown: 'doc', txt: 'doc', rst: 'doc', adoc: 'doc',
  html: 'web', htm: 'web', css: 'web', scss: 'web', less: 'web', svg: 'web', vue: 'web',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', ico: 'img', avif: 'img',
};

function fileKind(name) {
  const i = name.lastIndexOf('.');
  return (i > 0 && FILE_KIND[name.slice(i + 1).toLowerCase()]) || 'other';
}

/* Expand the tree down to dir and scroll it into view. */
async function revealDir(dir) {
  if (!dir) return;
  const parts = dir.split('/');
  for (let i = 0; i < parts.length; i++) {
    const p = parts.slice(0, i + 1).join('/');
    const row = treeEl.querySelector('[data-dir="' + CSS.escape(p) + '"]');
    if (!row) break;
    const kids = treeEl.querySelector('[data-kids="' + CSS.escape(p) + '"]');
    if (!row.classList.contains('open')) {
      row.classList.add('open');
      if (kids) kids.classList.add('open');
      openDirs.add(p);
      if (kids && !kids.dataset.loaded) {
        kids.dataset.loaded = '1';
        await drawTree(p, kids, p.split('/').length);
      }
    }
  }
  const last = treeEl.querySelector('[data-dir="' + CSS.escape(dir) + '"]');
  if (last) last.scrollIntoView({ block: 'nearest' });
}

async function revealFile(path) {
  if (!path) return;
  const idx = path.lastIndexOf('/');
  if (idx > 0) await revealDir(path.slice(0, idx));
  const row = treeEl.querySelector('[data-file="' + CSS.escape(path) + '"]');
  if (row) {
    $$('.tr.sel', treeEl).forEach(x => x.classList.remove('sel'));
    row.classList.add('sel');
    row.scrollIntoView({ block: 'nearest' });
  }
}

function initTree() {
  // "Changed only" filter: hide clean files and known-clean folders (CSS-driven).
  $('#btn-changed')?.addEventListener('click', e => {
    const on = treeEl.classList.toggle('changed-only');
    e.currentTarget.classList.toggle('active', on);
  });

  treeEl.addEventListener('click', async e => {
    const dirRow = e.target.closest('[data-dir]');
    if (dirRow) {
      const path = dirRow.dataset.dir;
      const kids = treeEl.querySelector('[data-kids="' + CSS.escape(path) + '"]');
      const open = dirRow.classList.toggle('open');
      kids.classList.toggle('open', open);
      if (open) {
        openDirs.add(path);
        if (!kids.dataset.loaded) {
          kids.dataset.loaded = '1';
          await drawTree(path, kids, path.split('/').length);
        }
      } else openDirs.delete(path);
      return;
    }
    const f = e.target.closest('[data-file]');
    if (f) {
      $$('.tr.sel', treeEl).forEach(x => x.classList.remove('sel'));
      f.classList.add('sel');
      openFile(f.dataset.file);
    }
  });
}

// --- File: web/src/panels.js ---
// web/src/panels.js






function showPanel(name) {
  document.body.classList.remove('side-hidden');
  const filesPanel = $('#panel-files');
  const searchPanel = $('#panel-search');
  if (name === 'search') {
    filesPanel?.classList.remove('active');
    searchPanel?.classList.add('active');
    const q = $('#q');
    if (q) {
      q.focus();
      q.select();
    }
  } else {
    searchPanel?.classList.remove('active');
    filesPanel?.classList.add('active');
  }
  layout();
  render();
}

function initPanels() {
  $('#btn-show-search')?.addEventListener('click', () => showPanel('search'));
  $('#btn-show-files')?.addEventListener('click', () => showPanel('files'));

  $('#btn-reindex').addEventListener('click', async () => {
    $('#st-index').textContent = 'reindexing…';
    const j = await api('/api/reindex');
    S.meta.files = j.files; S.meta.indexMs = j.indexMs;
    treeEl.innerHTML = ''; openDirs.clear();
    await drawTree('', treeEl, 0);
    // Reindex is a refresh: re-fetch open tabs quietly in place without tab switching.
    await reloadOpenTabs();
    updateStatus();
  });

  /* sidebar resize */
  (() => {
    const rz = $('#resizer'); let dragging = false;
    rz.addEventListener('mousedown', e => { dragging = true; rz.classList.add('drag'); e.preventDefault(); });
    addEventListener('mousemove', e => {
      if (!dragging) return;
      $('#side').style.width = Math.max(170, Math.min(620, e.clientX)) + 'px';
    });
    addEventListener('mouseup', () => { if (dragging) { dragging = false; rz.classList.remove('drag'); layout(); render(); } });
  })();
}

// --- File: web/src/find.js ---
// web/src/find.js
const findbar = $('#findbar');
const findInput = $('#find-input');

/* Text currently selected inside the editor viewport, reduced to its first
   non-empty line since find matches within a single line. */
function editorSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
  const at = sel.getRangeAt(0).commonAncestorContainer;
  if (!vp.contains(at) && !mdview.contains(at)) return '';
  const line = sel.toString().split(/\r?\n/).find(l => l.trim());
  return line ? line.trim() : '';
}

/* Seed priority: live editor selection, then the query already in an open
   findbar, then the caller's fallback (the last double-clicked word). */
function openFind(seed) {
  if (!doc_()) return;
  const sel = editorSelection();
  if (sel) findInput.value = sel;
  else if (findbar.hidden && seed) findInput.value = seed;
  findbar.hidden = false;
  findInput.focus(); findInput.select();
  if (findInput.value) runFind();
}

function clearFind() {
  findbar.hidden = true;
  S.find = null;
  $('#find-count').textContent = '0';
  $('#minimap-hits').innerHTML = '';
  clearPreviewMarks();
  paint();
}
const runFind = debounce(async () => {
  const d = doc_(); if (!d) return;
  const q = findInput.value;
  // The Markdown preview is searched as rendered text, in the page itself.
  if (d.markdown && previewing(d)) {
    const n = findInPreview(q);
    S.find = q ? { q, ci: false, hits: new Array(n).fill(null), byLine: new Set(), active: n ? 0 : -1, preview: true } : null;
    $('#find-count').textContent = !q ? '0' : n ? '1 / ' + n : 'no results';
    $('#minimap-hits').innerHTML = previewHitOffsets().map(p => '<i style="top:' + p + '%"></i>').join('');
    if (n) jumpToHit(0);
    return;
  }
  if (!q) { S.find = null; $('#find-count').textContent = '0'; $('#minimap-hits').innerHTML = ''; paint(); return; }
  let j;
  try { j = await api('/api/search', { q, glob: d.path }); } catch { return; }
  const f = (j.results || []).find(r => r.path === d.path);
  const hits = [];
  if (f) {
    let prevLine = -1, n = 0;
    for (const m of f.matches) {
      n = m.line === prevLine ? n + 1 : 0;
      prevLine = m.line;
      hits.push({ line: m.line, n });
    }
  }
  S.find = { q, ci: false, hits, byLine: new Set(hits.map(h => h.line)), active: hits.length ? 0 : -1 };
  $('#find-count').textContent = hits.length ? '1 / ' + hits.length : 'no results';
  drawMinimap(hits, d.total);
  if (hits.length) jumpToHit(0); else paint();
}, 140);

function drawMinimap(hits, total) {
  const mm = $('#minimap-hits');
  if (!hits.length) { mm.innerHTML = ''; return; }
  const seen = new Set();
  mm.innerHTML = hits.filter(h => !seen.has(h.line) && seen.add(h.line))
    .map(h => '<i style="top:' + ((h.line - 1) / total * 100).toFixed(3) + '%"></i>').join('');
}

function jumpToHit(i) {
  const d = doc_(); if (!d || !S.find || !S.find.hits.length) return;
  const n = S.find.hits.length;
  S.find.active = ((i % n) + n) % n;
  if (S.find.preview) {
    $('#find-count').textContent = (S.find.active + 1) + ' / ' + n;
    showPreviewHit(S.find.active);
    return;
  }
  const h = S.find.hits[S.find.active];
  d.cur = h.line;
  const y = (h.line - 1) * LH;
  if (y < vp.scrollTop + LH * 2 || y > vp.scrollTop + vp.clientHeight - LH * 3) centerLine(h.line);
  $('#find-count').textContent = (S.find.active + 1) + ' / ' + n;
  render(); updateStatus();
}

function initFind() {
  findInput.addEventListener('input', runFind);
  findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); jumpToHit(S.find ? S.find.active + (e.shiftKey ? -1 : 1) : 0); }
    if (e.key === 'Escape') { clearFind(); vp.focus(); }
  });
  $('#find-next').addEventListener('click', () => jumpToHit(S.find ? S.find.active + 1 : 0));
  $('#find-prev').addEventListener('click', () => jumpToHit(S.find ? S.find.active - 1 : 0));
  $('#find-close').addEventListener('click', clearFind);
  $('#minimap-hits').addEventListener('click', e => {
    const r = $('#minimap-hits').getBoundingClientRect();
    const d = doc_(); if (!d) return;
    if (previewing(d)) { scrollPreviewTo((e.clientY - r.top) / r.height); return; }
    centerLine(Math.round((e.clientY - r.top) / r.height * d.total));
    render();
  });
}

// --- File: web/src/search.js ---
// web/src/search.js
const resultsEl = $('#results');
let lastResults = null;

// The search panel is optional markup; without it every entry point is a no-op.
const runSearch = debounce(async () => {
  const qEl = $('#q');
  const resEl = $('#results');
  if (!qEl || !resEl) return;
  const q = qEl.value;
  if (!q.trim()) { resEl.innerHTML = ''; return; }
  resEl.innerHTML = '<div class="hint">searching…</div>';
  const params = {
    q, glob: $('#glob')?.value || '',
    case: $('#o-case')?.classList.contains('on') ? 1 : '',
    word: $('#o-word')?.classList.contains('on') ? 1 : '',
    re: $('#o-re')?.classList.contains('on') ? 1 : '',
  };
  try {
    const j = await api('/api/search', params);
    renderResults(j);
  } catch (e) {
    resEl.innerHTML = '<div class="hint">' + esc(e.message) + '</div>';
  }
}, 160);

function renderResults(j) {
  lastResults = j;
  const resEl = $('#results');
  if (!resEl) return;
  if (!j.results || !j.results.length) {
    resEl.innerHTML = '<div class="hint">No results.</div>';
    return;
  }
  const head = j.header || (j.total.toLocaleString() + ' result' + (j.total === 1 ? '' : 's') +
    ' in ' + j.files.toLocaleString() + ' file' + (j.files === 1 ? '' : 's') + (j.truncated ? ' (truncated)' : ''));
  let html = '<div class="hint">' + esc(head) + '</div>';
  for (const f of j.results) {
    html += '<div class="rfile" data-toggle="' + esc(f.path) + '" title="' + esc(f.path) + '">' +
      '<span class="ar">&#9660;</span>' +
      (f.ext ? '<span class="ext">ext</span>' : '') +
      '<span class="fp">' + esc(displayPath(f.path)) + '</span>' +
      '<span class="cnt">' + f.matches.length + '</span></div>' +
      '<div data-group="' + esc(f.path) + '">';
    for (const m of f.matches) {
      html += '<div class="rline" data-p="' + esc(f.path) + '" data-n="' + m.line + '" title="Jump to ' + esc(f.path) + ':' + m.line + '">' +
        '<span class="rn">' + m.line + '</span><span class="rt">' +
        esc(m.pre) + '<mark>' + esc(m.mid) + '</mark>' + esc(m.post) + '</span></div>';
    }
    html += '</div>';
  }
  resEl.innerHTML = html;
}

/* External results carry an absolute path, which is far too long for the
   panel. Show enough of the tail to identify the file. */
function displayPath(p) {
  if (p.length <= 48) return p;
  const parts = p.split('/');
  return '…/' + parts.slice(-3).join('/');
}

function initSearch() {
  const resEl = $('#results');
  const qEl = $('#q');
  if (!resEl || !qEl) return;
  resEl.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const g = resEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
      if (g) {
        const hidden = g.style.display === 'none';
        g.style.display = hidden ? '' : 'none';
        $('.ar', t).innerHTML = hidden ? '&#9660;' : '&#9654;';
      }
      return;
    }
    const r = e.target.closest('.rline');
    if (r) {
      $$('.rline.sel', resEl).forEach(x => x.classList.remove('sel'));
      r.classList.add('sel');
      openFile(r.dataset.p, { line: +r.dataset.n });
      const q = qEl.value;
      if (q) flashFind(q);
    }
  });

  qEl.addEventListener('input', runSearch);
  $('#glob')?.addEventListener('input', runSearch);
  $$('.opt', $('#panel-search')).forEach(b => b.addEventListener('click', () => { b.classList.toggle('on'); runSearch(); }));
  qEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const f = $('.rline', resEl); if (f) f.click(); }
  });
}

// --- File: web/src/inspector.js ---
// web/src/inspector.js








function showRightInspector(tab = 'refs') {
  document.body.classList.remove('right-hidden');
  setRightInspectorTab(tab);
  layout();
  render();
}

function hideRightInspector() {
  document.body.classList.add('right-hidden');
  layout();
  render();
}

function setRightInspectorTab(tab) {
  $$('.inspector-tab').forEach(b => b.classList.toggle('active', b.dataset.itab === tab));
  $('#pane-right-refs')?.classList.toggle('active', tab === 'refs');
  $('#pane-right-symbols')?.classList.toggle('active', tab === 'symbols');
  $('#pane-right-calls')?.classList.toggle('active', tab === 'calls');
  $('#pane-right-search')?.classList.toggle('active', tab === 'search');
  if (tab === 'symbols') {
    loadOutline();
    $('#right-symbols-filter')?.focus();
  }
  if (tab === 'search') $('#q')?.focus();
}

function renderRightResults(word, hits, server, isExact) {
  const targetEl = $('#right-ref-target');
  const badgeEl = $('#right-ref-badge');
  const listEl = $('#right-refs-list');
  if (!targetEl || !badgeEl || !listEl) return;

  targetEl.textContent = word;
  badgeEl.textContent = hits.length;

  if (!hits.length) {
    listEl.innerHTML = '<div class="hint">No references found for "<b>' + esc(word) + '</b>".</div>';
    return;
  }

  const grouped = groupHits(hits);
  const head = hits.length + ' reference' + (hits.length === 1 ? '' : 's') +
    (server ? ' · ' + esc(server) : ' · text search');
  let html = '<div class="hint">' + head + '</div>';

  for (const f of grouped) {
    html += '<div class="rfile" data-toggle="r-' + esc(f.path) + '" title="' + esc(f.path) + '">' +
      '<span class="ar">&#9660;</span>' +
      '<span class="fp">' + esc(displayPath(f.path)) + '</span>' +
      '<span class="cnt">' + f.matches.length + '</span></div>' +
      '<div data-group="r-' + esc(f.path) + '">';
    for (const m of f.matches) {
      html += '<div class="rline" data-p="' + esc(f.path) + '" data-n="' + m.line + '" title="Jump to ' + esc(f.path) + ':' + m.line + '">' +
        '<span class="rn">' + m.line + '</span><span class="rt">' +
        esc(m.pre) + '<mark>' + esc(m.mid || word) + '</mark>' + esc(m.post) + '</span></div>';
    }
    html += '</div>';
  }
  listEl.innerHTML = html;
}

async function inspectReferences(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  if (!d || !at || !at.word) return;

  showRightInspector('refs');
  const targetEl = $('#right-ref-target');
  const badgeEl = $('#right-ref-badge');
  const listEl = $('#right-refs-list');
  if (targetEl) targetEl.textContent = at.word;
  if (badgeEl) badgeEl.textContent = '…';
  if (listEl) listEl.innerHTML = '<div class="hint">Finding references for "' + esc(at.word) + '"…</div>';

  if (canAskServer(at)) {
    setStatusNote('references to ' + at.word + '…');
    try {
      const j = await lspCall('refs', at, 30000);
      updateStatus();
      if (j && j.hits && j.hits.length) {
        renderRightResults(at.word, j.hits, j.server, true);
        return;
      }
    } catch {
      updateStatus();
    }
  }

  // Fallback: search workspace text for whole word
  setStatusNote('searching references to ' + at.word + '…');
  try {
    const j = await api('/api/search', { q: at.word, word: true, case: true });
    updateStatus();
    const hits = [];
    if (j.results) {
      for (const f of j.results) {
        for (const m of f.matches) {
          hits.push({ path: f.path, line: m.line, pre: m.pre, mid: m.mid, post: m.post });
        }
      }
    }
    renderRightResults(at.word, hits, '', false);
  } catch (err) {
    updateStatus();
    if (listEl) listEl.innerHTML = '<div class="hint">Search error: ' + esc(err.message) + '</div>';
  }
}

function initInspector() {
  $$('.inspector-tab').forEach(btn => btn.addEventListener('click', () => {
    setRightInspectorTab(btn.dataset.itab);
  }));

  $('#btn-close-right')?.addEventListener('click', hideRightInspector);

  /* Right inspector resizer */
  (() => {
    const rrz = $('#right-resizer');
    if (!rrz) return;
    let dragging = false;
    rrz.addEventListener('mousedown', e => { dragging = true; rrz.classList.add('drag'); e.preventDefault(); });
    addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = Math.max(200, Math.min(700, window.innerWidth - e.clientX));
      $('#right-side').style.width = w + 'px';
    });
    addEventListener('mouseup', () => { if (dragging) { dragging = false; rrz.classList.remove('drag'); layout(); render(); } });
  })();

  /* Right-side symbols list navigation */
  $('#right-symbols-list')?.addEventListener('click', e => {
    const s = e.target.closest('.sym');
    if (!s) return;
    $$('#right-symbols-list .sym.sel, #outline .sym.sel').forEach(x => x.classList.remove('sel'));
    s.classList.add('sel');
    const d = doc_(); if (!d) return;
    d.cur = +s.dataset.n;
    centerLine(d.cur);
    render();
    updateStatus();
    pushHistory(d.path, d.cur);
  });
  $('#right-symbols-filter')?.addEventListener('input', drawOutline);

  $('#right-refs-list')?.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const listEl = $('#right-refs-list');
      const g = listEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
      if (!g) return;
      const hidden = g.style.display === 'none';
      g.style.display = hidden ? '' : 'none';
      $('.ar', t).innerHTML = hidden ? '&#9660;' : '&#9654;';
      return;
    }
    const r = e.target.closest('.rline');
    if (r) {
      $$('#right-refs-list .rline.sel').forEach(x => x.classList.remove('sel'));
      r.classList.add('sel');
      openFile(r.dataset.p, { line: +r.dataset.n });
      const targetEl = $('#right-ref-target');
      if (targetEl && targetEl.textContent) flashFind(targetEl.textContent);
    }
  });
}

// --- File: web/src/lsp.js ---
// web/src/lsp.js






/* Language servers answer precisely but can take a long time to wake up, while
   the regex index answers in milliseconds and is always there. So: use the
   server when it is actually ready, fall back to text matching when it is not,
   and never let a slow server block the jump. */

/* A language server answers about a position, not a name. Only a position we
   actually measured in the current file may be sent to it; a bare word (from
   the palette, say) has no column and would make the server confidently answer
   about whatever happens to sit at column 0. Those go to the text index. */
function positionNow(word) {
  const d = doc_();
  if (!d) return null;
  if (S.at && S.at.word && S.at.path === d.path) return S.at;
  if (word) return { word, line: d.cur, col: 0, imprecise: true };
  return null;
}

function canAskServer(at) {
  return !at.imprecise && (S.lsp.state === 'ready' || S.lsp.state === 'indexing');
}

/* Opening a file starts its language server, if there is one, and follows it
   until it is up. Without this the first hover would find the server still
   "starting" and quietly do nothing, with no way for the state to advance. */
async function warmLSP(d, tries = 0) {
  if (!d.lsp || d.lsp.state === 'off' || d.lsp.state === 'ready' || d.lsp.state === 'failed') return;
  if (tries > 20) return;
  let j;
  try { j = await api('/api/lsp/warm', { path: d.path, wait: tries === 0 ? 1 : 1200 }); }
  catch { return; }
  if (!S.tabs.includes(d)) return;
  d.lsp = { state: j.state, server: j.server, missing: j.missing || '' };
  if (doc_() === d) setLspState(j);
  if (j.state === 'starting' || j.state === 'indexing') {
    setTimeout(() => warmLSP(d, tries + 1), 900);
  }
}

async function lspCall(kind, at, waitMs) {
  const d = doc_();
  if (!d) return null;
  try {
    const j = await api('/api/lsp/' + kind, { path: d.path, line: at.line, col: at.col, wait: waitMs });
    setLspState(j);
    return j;
  } catch { return null; }
}

async function gotoDefinition(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  if (!d || !at) return;

  if (canAskServer(at)) {
    setStatusNote('definition of ' + at.word + '…');
    const j = await lspCall('def', at, S.lsp.state === 'ready' ? 5000 : 20000);
    updateStatus();
    if (j && j.hits && j.hits.length) {
      const repoHits = j.hits.filter(h => !h.ext);
      if (repoHits.length > 0) {
        acceptHits(at.word, repoHits, j.server, 'definition');
        return;
      }
      setStatusNote('External / standard library symbol: "' + at.word + '"' + (j.server ? ' (' + j.server + ')' : ''));
      return;
    }
  } else if (!at.imprecise && S.lsp.state === 'starting') {
    // Kick the server awake for next time, but do not wait on it.
    lspCall('def', at, 60000).then(j => {
      if (j && j.hits && j.hits.length) {
        const repoHits = j.hits.filter(h => !h.ext);
        if (repoHits.length > 0) showHits(at.word, repoHits, j.server, 'definition');
      }
    });
  }

  setStatusNote('searching for ' + at.word + '…');
  let rx;
  try { rx = await api('/api/def', { sym: at.word, path: d.path }); }
  catch (e) { setStatusNote(e.message); return; }
  updateStatus();
  if (rx.lsp) setLspState(rx.lsp);

  if (!rx.defs || !rx.defs.length) {
    setStatusNote('No definition found for "' + at.word + '" in repository');
    return;
  }
  acceptHits(at.word, rx.defs, null, 'definition', rx.refCount);
}

async function findReferences(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  if (!d || !at) return;
  inspectReferences(at);
}

function acceptHits(word, hits, server, noun, refCount) {
  const repoHits = hits.filter(h => !h.ext);
  if (!repoHits.length) {
    setStatusNote('External / standard library symbol: "' + word + '"' + (server ? ' (' + server + ')' : ''));
    return;
  }
  if (repoHits.length === 1) {
    const h = repoHits[0];
    openFile(h.path, { line: h.line });
    flashFind(h.mid || word);
    setStatusNote(server ? server + ' · ' + h.path + ':' + h.line : h.path + ':' + h.line);
    return;
  }
  showHits(word, repoHits, server, noun, refCount);
}

function showHits(word, hits, server, noun, refCount) {
  const n = hits.length;
  let head = n + ' ' + noun + (n === 1 ? '' : 's') + ' of "' + word + '"';
  head += server ? '  ·  ' + server : '  ·  text match, no language server';
  if (refCount) head += '  ·  ' + refCount + ' other references';
  renderResults({ results: groupHits(hits), files: 0, total: n, header: head, exact: !!server });
  showRightInspector('search');
}

function groupHits(hits) {
  const byPath = new Map();
  for (const h of hits) {
    if (!byPath.has(h.path)) byPath.set(h.path, { path: h.path, ext: h.ext, matches: [] });
    byPath.get(h.path).matches.push(h);
  }
  return [...byPath.values()];
}

function flashFind(q) {
  const d = doc_();
  if (!d || !q) return;
  S.find = { q, ci: true, hits: [{ line: d.cur, n: 0 }], byLine: new Set([d.cur]), active: 0 };
  setTimeout(paint, 0);
}

// --- File: web/src/cursor.js ---
// web/src/cursor.js
const WORD = /[A-Za-z0-9_$]/;

/* Returns {word, line, col} where col counts UTF-16 units from the start of the
   line, which is both what JS string indexes give us and what the server needs
   to place an LSP request. Walking text nodes keeps this correct even after
   find or occurrence marks have wrapped parts of the line. */
function wordAtPoint(x, y) {
  let node, off;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode; off = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer; off = r.startOffset;
  } else return null;
  if (!node || node.nodeType !== 3) return null;

  const code = node.parentElement && node.parentElement.closest('.c');
  const row = code && code.closest('.row');
  if (!code || !row) return null;

  let col = 0;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) { col += off; break; }
    col += n.nodeValue.length;
  }

  const full = code.textContent;
  let a = Math.min(col, full.length), b = a;
  while (a > 0 && WORD.test(full[a - 1])) a--;
  while (b < full.length && WORD.test(full[b])) b++;
  if (a === b) return null;
  const d = doc_();
  return { word: full.slice(a, b), line: +row.dataset.l, col: a, path: d && d.path };
}

/* Returns { target, line, col, startCol, endCol, path } when the point lies
   inside a quoted import/file path string (e.g. './state.js', "pkg/foo", `docs/guide.md`),
   angle-bracketed include, or markdown link target. */
function pathAtPoint(x, y) {
  let node, off;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode; off = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer; off = r.startOffset;
  } else return null;
  if (!node || node.nodeType !== 3) return null;

  const code = node.parentElement && node.parentElement.closest('.c');
  const row = code && code.closest('.row');
  if (!code || !row) return null;

  let col = 0;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) { col += off; break; }
    col += n.nodeValue.length;
  }

  const full = code.textContent;
  if (!full || col < 0 || col > full.length) return null;

  // 1. Check if inside quotes: '...', "...", `...`
  let quoteStart = -1, quoteChar = '';
  for (let i = col - 1; i >= 0; i--) {
    const ch = full[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && full[j] === '\\'; j--) backslashes++;
      if (backslashes % 2 === 0) { quoteStart = i; quoteChar = ch; break; }
    }
  }

  if (quoteStart >= 0) {
    let quoteEnd = -1;
    for (let i = col; i < full.length; i++) {
      if (full[i] === quoteChar) {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && full[j] === '\\'; j--) backslashes++;
        if (backslashes % 2 === 0) { quoteEnd = i; break; }
      }
    }
    if (quoteEnd > quoteStart) {
      const raw = full.slice(quoteStart + 1, quoteEnd).trim();
      if (looksLikePath(raw)) {
        const d = doc_();
        return {
          kind: 'path',
          target: raw,
          line: +row.dataset.l,
          col: quoteStart + 1,
          startCol: quoteStart + 1,
          endCol: quoteEnd,
          word: raw,
          path: d && d.path,
        };
      }
    }
  }

  // 2. Check if inside markdown link target: [text](path)
  const parenStart = full.lastIndexOf('(', col);
  if (parenStart >= 0) {
    const parenEnd = full.indexOf(')', col);
    if (parenEnd > parenStart) {
      const raw = full.slice(parenStart + 1, parenEnd).trim();
      if (looksLikePath(raw)) {
        const d = doc_();
        return {
          kind: 'path',
          target: raw,
          line: +row.dataset.l,
          col: parenStart + 1,
          startCol: parenStart + 1,
          endCol: parenEnd,
          word: raw,
          path: d && d.path,
        };
      }
    }
  }

  // 3. Check if inside angle brackets: #include <foo.h>
  const angleStart = full.lastIndexOf('<', col);
  if (angleStart >= 0) {
    const angleEnd = full.indexOf('>', col);
    if (angleEnd > angleStart) {
      const raw = full.slice(angleStart + 1, angleEnd).trim();
      if (looksLikePath(raw)) {
        const d = doc_();
        return {
          kind: 'path',
          target: raw,
          line: +row.dataset.l,
          col: angleStart + 1,
          startCol: angleStart + 1,
          endCol: angleEnd,
          word: raw,
          path: d && d.path,
        };
      }
    }
  }

  return null;
}

function looksLikePath(s) {
  if (!s || s.length < 2 || s.length > 260) return false;
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('mailto:') || s.startsWith('data:')) return false;
  if (s.includes('/') || s.includes('\\') || s.startsWith('./') || s.startsWith('../')) return true;
  return /\.(js|ts|tsx|jsx|mjs|cjs|go|py|rs|java|c|h|cpp|hpp|cc|json|css|html|md|markdown|yaml|yml|toml|sql|sh|txt)$/i.test(s);
}

/* Column (UTF-16 units into the line's text) under a point. Clicking the gutter
   gives 0; clicking the empty space right of the text gives the line's end. */
function colAtPoint(x, y) {
  let node, off;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode; off = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer; off = r.startOffset;
  } else return null;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const row = el && el.closest('.row');
  if (!row) return null;
  const code = $('.c', row);
  const line = +row.dataset.l;
  if (!code.contains(node)) return { line, col: el.closest('.g') ? 0 : code.textContent.length };
  const r = document.createRange();
  r.setStart(code, 0);
  r.setEnd(node, off);
  return { line, col: r.toString().length };
}

/* Keep the caret inside the horizontally scrolled area when it moves. */
function revealCaretX(x) {
  const d = doc_();
  if (x == null || S.wrap || !d) return;
  const g = rowFor(d.cur)?.querySelector('.g');
  const gw = S.lineNumbers && g ? g.offsetWidth : 0;
  if (x < vp.scrollLeft + gw + 8) vp.scrollLeft = Math.max(0, x - gw - 40);
  else if (x > vp.scrollLeft + vp.clientWidth - 24) vp.scrollLeft = x - vp.clientWidth + 60;
}

/* Left/Right along the line, wrapping onto the neighbouring line at either end. */
function moveCol(delta) {
  const d = doc_(); if (!d) return;
  const row = rowFor(d.cur);
  const len = row ? $('.c', row).textContent.length : 0;
  const col = Math.min(d.col || 0, len) + delta;
  if (col < 0) {
    if (d.cur > 1) { d.col = Infinity; moveCursor(-1); } // clamped to the line end when placed
    return;
  }
  if (col > len) {
    if (d.cur < d.total) { d.col = 0; moveCursor(1); }
    return;
  }
  d.col = col;
  revealCaretX(placeCaret());
}

function caretToEdge(end) {
  const d = doc_(); if (!d) return;
  d.col = end ? Infinity : 0;
  revealCaretX(placeCaret());
}

function moveCursor(delta) {
  const d = doc_(); if (!d) return;
  d.cur = Math.max(1, Math.min(d.total, d.cur + delta));
  const y = (d.cur - 1) * LH;
  if (y < vp.scrollTop) vp.scrollTop = y - LH;
  else if (y > vp.scrollTop + vp.clientHeight - LH * 2) vp.scrollTop = y - vp.clientHeight + LH * 3;
  render(); updateStatus();
}

function initCursor() {
  vp.addEventListener('mousedown', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    const d = doc_(); if (!d) return;
    d.cur = +row.dataset.l;
    const p = colAtPoint(e.clientX, e.clientY);
    d.col = p && p.line === d.cur ? p.col : 0;
    placeCaret(); // no repaint here: rewriting rows would break the drag that starts a selection
    updateStatus();
    const w = wordAtPoint(e.clientX, e.clientY);
    // The clicked identifier is what F12, Shift+F12 and Alt+Shift+H act on.
    S.at = w;
    if (w) S.lastWord = w.word;
    if (e[MOD]) {
      const pHit = pathAtPoint(e.clientX, e.clientY);
      if (pHit) {
        e.preventDefault();
        api('/api/resolve', { from: d.path, target: pHit.target }).then(res => {
          if (res && res.found && res.path) {
            pushHistory(d.path, d.cur);
            openFile(res.path, { line: res.line || 1 });
          } else if (w) {
            S.at = w; S.lastWord = w.word;
            pushHistory(d.path, d.cur);
            gotoDefinition(w);
          }
        }).catch(() => {
          if (w) {
            S.at = w; S.lastWord = w.word;
            pushHistory(d.path, d.cur);
            gotoDefinition(w);
          }
        });
        return;
      }
      if (w) {
        e.preventDefault();
        S.at = w; S.lastWord = w.word;
        pushHistory(d.path, d.cur); // so Alt+Left returns to the call site
        gotoDefinition(w);
        return;
      }
    }
    for (const r of rowsEl.children) r.classList.toggle('cur', +r.dataset.l === d.cur);
  });

  vp.addEventListener('dblclick', e => {
    const w = wordAtPoint(e.clientX, e.clientY);
    if (w) { S.at = w; S.lastWord = w.word; }
    S.occ = (w && w.word.length > 1) ? w.word : null;
    paint();
  });
}

// --- File: web/src/lspsetup.js ---
// web/src/lspsetup.js




/* With no language server running for the open file, call trails are a dead
   end. This panel says why and offers the fix in place: run a known installer,
   or pick up a server installed by hand, then start it and carry on. */

let setupSeq = 0;
let pollTimer = 0;

const hintHtml = html => '<div class="hint">' + html + '</div>';

// Stops a pending refresh, so it cannot draw over whatever replaced the panel.
function cancelLspSetup() {
  setupSeq++;
  clearTimeout(pollTimer);
}

async function renderLspSetup(el, onReady) {
  const d = doc_();
  if (!el || !d) return;
  cancelLspSetup();
  const my = setupSeq;
  let s;
  try { s = await api('/api/lsp/setup', { path: d.path }); }
  catch (e) { if (my === setupSeq) el.innerHTML = hintHtml('Could not check language servers: ' + esc(e.message)); return; }
  if (my !== setupSeq || doc_() !== d) return;

  const again = ms => { pollTimer = setTimeout(() => { if (my === setupSeq) renderLspSetup(el, onReady); }, ms); };
  if (s.state === 'starting' && !s.server) {
    el.innerHTML = hintHtml('Looking for language servers…');
    again(700);
    return;
  }
  // Installed (just now, or all along) but this page has not caught up: start it.
  if (s.state !== 'off' && s.state !== 'failed') { start(el, d, onReady); return; }

  el.innerHTML = drawSetup(s, d);
  wire(el, d, onReady);
  if (s.servers.some(v => v.job && v.job.running)) again(1000);
}

async function start(el, d, onReady) {
  cancelLspSetup();
  el.innerHTML = hintHtml('Starting the language server…');
  let j;
  try { j = await apiPost('/api/lsp/start', { path: d.path }); }
  catch (e) { el.innerHTML = hintHtml('Could not start the language server: ' + esc(e.message)); return; }
  if (doc_() !== d) return;
  // Other open files may have been waiting on the same server: let them ask again.
  for (const t of S.tabs) {
    if (t !== d && t.lsp && (t.lsp.state === 'off' || t.lsp.state === 'failed')) t.lsp = { state: 'starting', server: '' };
  }
  d.lsp = { state: j.state, server: j.server, missing: j.missing || '' };
  setLspState(j);
  updateStatus();
  warmLSP(d);
  if (j.state === 'off' || j.state === 'failed') { renderLspSetup(el, onReady); return; }
  if (onReady) onReady();
}

function drawSetup(s, d) {
  const ext = (d.path.match(/\.[^./]+$/) || [d.name])[0];
  if (!s.enabled) {
    return hintHtml('Language servers are turned off: px0 was started with <b>-no-lsp</b>. ' +
      'Restart it without that flag for call trails, hover and precise references.');
  }
  if (!s.servers.length) {
    return hintHtml('px0 knows no language server for <b>' + esc(ext) + '</b> files, so call trails are not available here.');
  }

  const offer = s.servers.filter(v => v.options.length || v.job);
  const running = s.servers.some(v => v.job && v.job.running);
  let html = '<div class="lsp-setup">';
  if (s.state === 'failed') {
    html += '<p><b>' + esc(s.server) + '</b> did not start: <span class="lsp-reason">' + esc(s.reason || 'unknown error') + '</span></p>' +
      '<div class="lsp-row"><button class="lsp-btn" data-start>Retry</button></div>';
    if (offer.length) html += '<p>If it is broken or incomplete, install it again:</p>';
  } else {
    html += '<p>Call trails, hover and precise references for ' + esc(s.lang) + ' need a language server, and none is installed.</p>';
  }

  for (const v of offer) {
    html += '<div class="lsp-server"><div class="lsp-name">' + esc(v.name) + '</div>';
    v.options.forEach((o, i) => {
      html += '<div class="lsp-opt"><code>' + esc(o.cmd) + '</code><span class="lsp-acts">';
      if (!o.auto) html += '<span class="lsp-need">run in a terminal</span>';
      else if (!o.hasTool) html += '<span class="lsp-need">needs ' + esc(o.tool) + '</span>';
      else html += '<button class="lsp-btn primary" data-install="' + esc(v.name) + '" data-option="' + i + '"' + (running ? ' disabled' : '') + '>Install</button>';
      html += '<button class="lsp-btn" data-copy="' + esc(o.cmd) + '">Copy</button></span></div>';
    });
    if (v.job) html += job(v.job);
    html += '</div>';
  }
  if (!offer.length) {
    html += '<p>px0 has no installer for this one. Install ' + s.servers.map(v => '<b>' + esc(v.name) + '</b>').join(' or ') +
      ' and make sure it is on PATH.</p>';
  }
  html += '<div class="lsp-row"><span>Installed one yourself?</span><button class="lsp-btn" data-start>Detect and start</button></div></div>';
  return html;
}

function job(j) {
  const tail = (j.log || '').trimEnd().split('\n').slice(-12).join('\n');
  const log = tail ? '<pre>' + esc(tail) + '</pre>' : '';
  if (j.running) return '<div class="lsp-job">Installing with <code>' + esc(j.cmd) + '</code>…' + log + '</div>';
  if (j.error) return '<div class="lsp-job err">Install failed: ' + esc(j.error) + log + '</div>';
  return '';
}

function wire(el, d, onReady) {
  el.querySelectorAll('[data-install]').forEach(b => b.addEventListener('click', async () => {
    el.querySelectorAll('[data-install]').forEach(x => { x.disabled = true; });
    try { await apiPost('/api/lsp/install', { server: b.dataset.install, option: b.dataset.option }); }
    catch (e) { showToast('!', e.message); }
    renderLspSetup(el, onReady);
  }));
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    copyToClipboard(b.dataset.copy, 'Copied ' + b.dataset.copy);
  }));
  el.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => start(el, d, onReady)));
}

// --- File: web/src/calls.js ---
// web/src/calls.js






/* Call trail: the language server's call hierarchy, grown one level at a time
   as the reader expands it. Callers walk up toward entry points, callees walk
   down toward leaves. Each node keeps the server's opaque item so the next
   level can be asked for without the server remembering anything. */

let T = null;       // { path, word, dir, roots: [node] }
let dirPref = 'in'; // 'in' = callers, 'out' = callees
let seq = 0;
const flat = [];    // node by row index, rebuilt on every draw

const listEl = () => $('#right-calls-list');
const hint = html => { const el = listEl(); if (el) el.innerHTML = '<div class="hint">' + html + '</div>'; };
const base = p => p.split('/').pop();
// Some servers crash on particular call hierarchy requests; say so plainly.
const explain = msg => /connection lost|exited|EOF/i.test(msg)
  ? msg + ' (the language server crashed answering this; px0 restarts it on the next request)'
  : msg;

function wrap(n, parent) {
  let cycle = false;
  for (let p = parent; p; p = p.parent) {
    if (p.n.path === n.path && p.n.line === n.line && p.n.name === n.name) { cycle = true; break; }
  }
  return { n, parent, kids: null, open: false, loading: false, err: '', cycle };
}

/* Callers jump to the line that makes the call; callees to their declaration. */
function target(node) {
  const n = node.n;
  if (T.dir === 'in' && n.sites && n.sites.length) return { path: n.sitePath, line: n.sites[0] };
  return { path: n.path, line: n.line };
}

async function showCalls(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  showRightInspector('calls');
  cancelLspSetup();
  if (!d) return;
  // Without a server there is nothing to trace: offer to install or start one, then come back here.
  if (S.lsp.state === 'off' || S.lsp.state === 'failed') {
    T = null;
    $('#right-calls-target').textContent = at ? at.word : '-';
    renderLspSetup(listEl(), () => showCalls(arg));
    return;
  }
  if (!at || at.imprecise) { hint('Click a function name in the editor, then press <b>' + esc(keyLabel('Alt+Shift+H')) + '</b>.'); return; }

  const my = ++seq;
  T = null;
  $('#right-calls-target').textContent = at.word;
  hint('Tracing calls for "' + esc(at.word) + '"…');
  setStatusNote('call trail for ' + at.word + '…');
  let j;
  try {
    j = await api('/api/lsp/calls', { path: d.path, line: at.line, col: at.col, wait: S.lsp.state === 'ready' ? 10000 : 30000 });
  } catch (e) {
    if (my === seq) { updateStatus(); hint('Could not trace "' + esc(at.word) + '": ' + esc(explain(e.message))); }
    return;
  }
  if (my !== seq) return;
  setLspState(j);
  updateStatus();
  if (!j.nodes || !j.nodes.length) {
    hint('"' + esc(at.word) + '" is not a function ' + esc(j.server || 'the language server') + ' can trace.');
    return;
  }
  T = { path: d.path, word: at.word, dir: dirPref, roots: j.nodes.map(n => wrap(n, null)) };
  for (const r of T.roots) expand(r);
}

async function expand(node) {
  if (node.cycle) return;
  node.open = true;
  if (node.kids) { draw(); return; }
  node.loading = true;
  draw();
  const t = T, dir = t.dir;
  try {
    const j = await api('/api/lsp/calls', { path: t.path, item: node.n.item, dir, wait: 30000 });
    if (t !== T || dir !== T.dir) return;
    node.kids = (j.nodes || []).map(n => wrap(n, node));
  } catch (e) {
    if (t !== T || dir !== T.dir) return;
    node.err = explain(e.message);
    node.kids = [];
  }
  node.loading = false;
  draw();
}

function setDir(dir) {
  dirPref = dir;
  $$('#calls-dir [data-dir]').forEach(b => b.classList.toggle('on', b.dataset.dir === dir));
  if (!T || T.dir === dir) return;
  T.dir = dir;
  for (const r of T.roots) Object.assign(r, { kids: null, open: false, loading: false, err: '' });
  for (const r of T.roots) expand(r);
}

function draw() {
  const el = listEl();
  if (!el || !T) return;
  flat.length = 0;
  const none = T.dir === 'in' ? 'no callers found' : 'calls nothing traceable';
  let html = '';
  const walk = (node, depth) => {
    const i = flat.push(node) - 1;
    const n = node.n, t = target(node);
    const arrow = node.cycle ? '&#8635;' : node.loading ? '&#8230;' : node.open ? '&#9660;' : '&#9654;';
    const calls = n.sites && n.sites.length > 1 ? ' &times;' + n.sites.length : '';
    const tip = t.path + ':' + t.line + (node.cycle ? '\n(recursive, already in this trail)' : '') + (n.detail ? '\n' + n.detail : '');
    html += '<div class="sym cnode" data-i="' + i + '" style="padding-left:' + (6 + depth * 14) + 'px" title="' + esc(tip) + '">' +
      '<span class="car' + (node.cycle ? ' cyc' : '') + '">' + arrow + '</span>' +
      '<span class="kd" data-k="' + esc(n.kind) + '">' + esc(n.kind) + '</span>' +
      '<span class="sn">' + esc(n.name) + '</span>' +
      '<span class="sl">' + esc(base(t.path)) + ':' + t.line + calls + '</span></div>';
    const pad = 'style="padding-left:' + (26 + (depth + 1) * 14) + 'px"';
    if (node.err) html += '<div class="cnone" ' + pad + '>' + esc(node.err) + '</div>';
    else if (node.open && node.kids && !node.kids.length) html += '<div class="cnone" ' + pad + '>' + none + '</div>';
    if (node.open && node.kids) for (const k of node.kids) walk(k, depth + 1);
  };
  for (const r of T.roots) walk(r, 0);
  el.innerHTML = html;
}

// Opens the setup panel whatever the server's state, for the palette command.
function openLspSetup() {
  showRightInspector('calls');
  T = null;
  renderLspSetup(listEl(), () => showCalls(S.at));
}

function initCalls() {
  $('#calls-dir')?.addEventListener('click', e => {
    const b = e.target.closest('[data-dir]');
    if (b) setDir(b.dataset.dir);
  });

  $('.inspector-tab[data-itab="calls"]')?.addEventListener('click', () => {
    if (!T && (S.at || S.lsp.state === 'off' || S.lsp.state === 'failed')) showCalls(S.at);
  });

  // The status bar names a missing or failed server; clicking it goes to the fix.
  $('#st-lsp')?.addEventListener('click', () => {
    if (S.lsp.missing || S.lsp.state === 'failed') openLspSetup();
  });

  listEl()?.addEventListener('click', async e => {
    const row = e.target.closest('.cnode');
    if (!row) return;
    const node = flat[+row.dataset.i];
    if (!node) return;
    if (e.target.closest('.car')) {
      if (node.open) { node.open = false; draw(); } else expand(node);
      return;
    }
    $$('#right-calls-list .cnode.sel').forEach(x => x.classList.remove('sel'));
    row.classList.add('sel');
    const t = target(node);
    await openFile(t.path, { line: t.line });
    // At a call site the name worth marking is the function being called.
    const called = T && T.dir === 'in' && node.parent ? node.parent.n.name : node.n.name;
    flashFind(called);
  });
}

// --- File: web/src/hover.js ---
// web/src/hover.js
const hovercard = $('#hovercard');
const HOVER_DELAY = 380;   // rest time before the card opens
const HOVER_KEEP = 26;     // px the pointer may drift before the card closes

let hoverTimer = 0, hoverSeq = 0, moveRAF = 0, pendingMove = null, pointerAt = null;

const sameWord = (a, b) => !!a && !!b && a.line === b.line && a.col === b.col && a.word === b.word;

/* Hit-testing a point costs a few milliseconds: it forces layout and walks the
   line's nodes. Far too much to spend on every animation frame, so it runs only
   when the modifier is actually held, or once the pointer has come to rest and
   the card is about to open. Everything on the hot path below is arithmetic. */
function onMove({ x, y, mod }) {
  if (mod) {
    const at = doc_() ? (pathAtPoint(x, y) || wordAtPoint(x, y)) : null;
    if (!sameWord(at, S.link)) {
      S.link = at;
      vp.classList.toggle('linking', !!at);
      paint();
    }
    clearTimeout(hoverTimer);
    hideHover();
    return;
  }

  if (S.link) { S.link = null; vp.classList.remove('linking'); paint(); }

  // Dismiss an open card once the pointer has clearly left what it described.
  if (S.hoverAnchor) {
    if (!hovercard.hidden) {
      const rect = hovercard.getBoundingClientRect();
      if (x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4) return;
    }
    const dx = x - S.hoverAnchor.x, dy = y - S.hoverAnchor.y;
    if (dx * dx + dy * dy > HOVER_KEEP * HOVER_KEEP) hideHover();
    else return; // still on the same word: nothing to do
  }

  if (S.lsp.state !== 'ready' && S.lsp.state !== 'indexing') return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => hoverAt(x, y), HOVER_DELAY);
}

function hoverAt(x, y) {
  const at = doc_() ? wordAtPoint(x, y) : null;
  if (at && at.word) showHover(at, x, y);
}

async function showHover(at, x, y) {
  const d = doc_();
  if (!d || at.path !== d.path) return;
  const seq = ++hoverSeq;
  let j;
  try { j = await api('/api/lsp/hover', { path: d.path, line: at.line, col: at.col, wait: 4000 }); }
  catch { return; }
  if (seq !== hoverSeq || doc_() !== d) return;   // the pointer moved on
  setLspState(j);
  if (!j || j.empty || (!j.signature && !j.doc)) return;

  S.hover = at;
  S.hoverAnchor = { x, y };
  const refPath = d.path + ':' + at.line;
  hovercard.innerHTML =
    (j.signature ? '<div class="sig">' + j.signature + '</div>' : '') +
    (j.doc ? '<div class="doc">' + esc(j.doc) + '</div>' : '') +
    '<div class="actions">' +
      '<button id="hc-copy-ref" title="Copy file and line reference">Copy Ref</button>' +
      '<button id="hc-copy-ai" title="Copy snippet with file path for AI Agent / LLMs">Copy for Agent</button>' +
      '<button id="hc-find-refs" title="Find all usages across codebase">Usages</button>' +
      '<button id="hc-calls" title="' + withKeys('Trace callers and callees ({Alt+Shift+H})') + '">Calls</button>' +
    '</div>' +
    '<div class="foot"><b>' + esc(j.server || 'lsp') + '</b>' +
    '<span>' + withKeys('{Mod+Click} definition') + '</span>' +
    '<span>' + withKeys('{Shift+F12} references') + '</span></div>';

  const btnRef = hovercard.querySelector('#hc-copy-ref');
  const btnAi = hovercard.querySelector('#hc-copy-ai');
  const btnRefs = hovercard.querySelector('#hc-find-refs');

  if (btnRef) btnRef.onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(refPath, 'Copied ' + refPath);
  };
  if (btnAi) btnAi.onclick = (e) => {
    e.stopPropagation();
    const lineText = d.lines[at.line - 1] || at.word || '';
    const ext = d.path.split('.').pop() || '';
    const text = '### Reference: ' + refPath + '\n```' + ext + '\n' + lineText + '\n```';
    copyToClipboard(text, 'Copied snippet for Agent (' + refPath + ')');
  };
  if (btnRefs) btnRefs.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    findReferences(at.word);
  };
  const btnCalls = hovercard.querySelector('#hc-calls');
  if (btnCalls) btnCalls.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    S.at = at;
    showCalls(at);
  };

  hovercard.hidden = false;
  placeHover(x, y);
}

/* Anchor below the pointer, flipping above or inward when that would overflow
   the editor. */
function placeHover(x, y) {
  const host = editor.getBoundingClientRect();
  const card = hovercard.getBoundingClientRect();
  let left = x - host.left + 6;
  let top = y - host.top + 20;
  if (left + card.width > host.width - 12) left = Math.max(8, host.width - card.width - 12);
  if (top + card.height > host.height - 8) {
    const above = y - host.top - card.height - 12;
    top = above > 8 ? above : Math.max(8, host.height - card.height - 8);
  }
  hovercard.style.left = left + 'px';
  hovercard.style.top = top + 'px';
}

function hideHover() {
  hoverSeq++;
  S.hover = null;
  S.hoverAnchor = null;
  if (!hovercard.hidden) { hovercard.hidden = true; hovercard.innerHTML = ''; }
}

function clearLink() {
  clearTimeout(hoverTimer);
  hideHover();
  if (S.link) { S.link = null; vp.classList.remove('linking'); paint(); }
}

function initHover() {
  /* One mousemove handler drives both behaviours: with a modifier held the word
     becomes a link, without one it gets an info card after a short rest. */
  vp.addEventListener('mousemove', e => {
    pointerAt = { x: e.clientX, y: e.clientY };
    pendingMove = { x: e.clientX, y: e.clientY, mod: e[MOD] };
    if (moveRAF) return;
    moveRAF = requestAnimationFrame(() => {
      moveRAF = 0;
      const m = pendingMove;
      pendingMove = null;
      if (m) onMove(m);
    });
  });

  vp.addEventListener('mouseleave', () => { pointerAt = null; clearLink(); });
  vp.addEventListener('scroll', () => { clearTimeout(hoverTimer); hideHover(); }, { passive: true });
  vp.addEventListener('mousedown', (e) => {
    if (e.target.closest('#hovercard')) return;
    hideHover();
  });

  /* The modifier can be pressed or released without the pointer moving, and the
     underline has to follow. */
  const modKey = isMac ? 'Meta' : 'Control';   // the key MOD tests; Ctrl+click on a Mac is a right click
  addEventListener('keydown', e => {
    if (e.key === modKey && pointerAt) onMove({ ...pointerAt, mod: true });
  });
  addEventListener('keyup', e => {
    if (e.key === modKey) clearLink();
  });
}

// --- File: web/src/markdown.js ---
// web/src/markdown.js










/* Markdown tabs open rendered. The server converts the file with goldmark and
   passes raw HTML through, so nothing it returns is trusted: mdSanitize rebuilds
   it against an allowlist in an inert document before any of it reaches the page.
   Every block carries the source line it starts on (data-line), which keeps the
   preview in step with line-based navigation and with the source view. */
const mdview = $('#mdview');
const mdArticle = $('#md');
const htmlview = $('#htmlview');

let mdShown = null;  // doc the preview is showing, null while it is hidden
let mdDrawn = null;  // doc whose HTML is in the article; drawing can wait on a fetch
let mdGen = 0;

function previewing(d = doc_()) {
  if (!d || d.mdError || d.diffMode) return false;
  if (d.markdown) return !!S.mdPreview;
  if (d.html) return !!S.htmlPreview;
  return false;
}

/* Show or hide the preview to match the active tab. Call whenever that changes. */
function syncPreview() {
  const d = doc_();
  const isPrev = previewing(d);
  if (!isPrev) {
    mdview.hidden = true;
    if (htmlview) htmlview.hidden = true;
    mdShown = null;
    mdDrawn = null;
    return;
  }
  if (d.markdown) {
    if (htmlview) htmlview.hidden = true;
    if (d === mdShown) return;
    if (mdShown && mdDrawn === mdShown) mdShown.mdScroll = mdview.scrollTop;
    mdShown = d;
    mdDrawn = null;
    mdview.hidden = false;
    mdArticle.replaceChildren();
    drawPreview(d);
  } else if (d.html) {
    mdview.hidden = true;
    mdShown = null;
    mdDrawn = null;
    if (htmlview) {
      htmlview.hidden = false;
      const targetSrc = '/api/raw/' + encodeURI(d.path);
      if (htmlview.dataset.path !== d.path) {
        htmlview.dataset.path = d.path;
        htmlview.src = targetSrc;
      }
    }
  }
}

async function drawPreview(d) {
  const gen = ++mdGen;
  if (d.mdHtml === undefined) {
    try {
      d.mdReq = d.mdReq || api('/api/markdown', { path: d.path });
      d.mdHtml = (await d.mdReq).html;
    } catch (e) {
      d.mdError = e.message; // this tab falls back to its source
      if (gen === mdGen && mdShown === d) {
        showToast('!', 'No preview for ' + d.name + ': ' + e.message);
        syncPreview();
        updateStatus();
      }
      return;
    } finally {
      d.mdReq = null;
    }
    if (gen !== mdGen || mdShown !== d) return;
  }
  mdArticle.replaceChildren(mdSanitize(d.mdHtml, d.path));
  mdEnhance();
  mdDrawn = d;
  const target = d.mdAnchor && mdFindAnchor(d.mdAnchor);
  if (target) mdScrollTo(target);
  else if (d.mdLine) previewLine(d.mdLine);
  else mdview.scrollTop = d.mdScroll || 0;
  d.mdAnchor = '';
  d.mdLine = 0;
  if (!findbar.hidden) runFind();
}

function togglePreview() {
  const d = doc_();
  if (!d || (!d.markdown && !d.html)) { showToast('!', 'Preview works on Markdown and HTML files'); return; }
  hideHover();
  if (previewing(d)) {
    if (d.markdown) {
      const line = mdDrawn === d ? previewTopLine() : 1;
      mdSetPref(false);
      syncPreview();
      sourceToLine(line);
    } else {
      htmlSetPref(false);
      syncPreview();
    }
  } else {
    d.mdError = '';
    if (d.markdown) {
      d.mdLine = sourceTopLine();
      mdSetPref(true);
      syncPreview();
    } else {
      htmlSetPref(true);
      syncPreview();
    }
  }
  if (!findbar.hidden) runFind(); else S.find = null;
  render();
  updateStatus();
}

function mdSetPref(on) {
  S.mdPreview = on;
  try { localStorage.setItem('px0.mdPreview', on ? 'true' : 'false'); } catch {}
}

function htmlSetPref(on) {
  S.htmlPreview = on;
  try { localStorage.setItem('px0.htmlPreview', on ? 'true' : 'false'); } catch {}
}

/* ---------- sanitising ---------- */

const HTML_NS = 'http://www.w3.org/1999/xhtml';
// Removed along with everything inside them.
const MD_DROP = new Set(('script style iframe frame frameset object embed applet template noscript noembed ' +
  'svg math form textarea select option button link meta base title audio video source track canvas dialog').split(' '));
// Kept. Any other element is unwrapped: its children stay, the element goes.
const MD_KEEP = new Set(('a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt ' +
  'em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q rp rt ruby s samp section small span ' +
  'strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr').split(' '));
// Attributes that can neither run script nor reach the network.
const MD_ATTRS = new Set(('align valign alt title lang dir width height colspan rowspan start reversed open checked ' +
  'disabled type data-line data-lang').split(' '));
// Token classes from the server's highlighter, allowed on <i>.
const MD_TOKENS = new Set('k kt nf nc nb nv no na nt nd np s m o p c cp gi gd gh ge gs err g'.split(' '));
const MD_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// Relative references resolve against this stand-in origin; landing anywhere else means they were not relative.
const MD_ORIGIN = 'http://px0.invalid';

/* The URL parser drops tabs and newlines anywhere and control characters at
   either end, so "java&#9;script:" still has a scheme. Test what it will see. */
const mdURL = ref => ref.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');

/* Parsing into a DOMParser document runs no script and loads nothing, so the
   markup can be cleaned there and only the survivors adopted into the page. */
function mdSanitize(html, docPath) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const dir = docPath.slice(0, docPath.lastIndexOf('/') + 1);
  const base = MD_ORIGIN + '/' + dir.split('/').map(encodeURIComponent).join('/');
  for (const el of [...body.querySelectorAll('*')]) {
    if (!body.contains(el)) continue; // inside something already removed
    const tag = el.localName;
    if (el.namespaceURI !== HTML_NS || MD_DROP.has(tag)) { el.remove(); continue; }
    if (!MD_KEEP.has(tag) || (tag === 'input' && el.getAttribute('type') !== 'checkbox')) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const attrs = {};
    for (const a of [...el.attributes]) { attrs[a.name] = a.value; el.removeAttribute(a.name); }
    for (const name in attrs) if (MD_ATTRS.has(name)) el.setAttribute(name, attrs[name]);
    // Prefixed so a heading called "status" cannot shadow the status bar's id.
    const id = attrs.id || (tag === 'a' && attrs.name);
    if (id) el.id = 'md-' + id;
    if (attrs.class) {
      const keep = attrs.class.split(/\s+/).filter(c =>
        c === 'md-code' || c.startsWith('footnote') || (tag === 'i' && MD_TOKENS.has(c)));
      if (keep.length) el.className = keep.join(' ');
    }
    if (tag === 'input') el.disabled = true;
    if (tag === 'img') mdSetImage(el, mdURL(attrs.src || ''), base);
    if (tag === 'a' && attrs.href) mdSetLink(el, mdURL(attrs.href), base);
  }
  const frag = document.createDocumentFragment();
  while (body.firstChild) frag.appendChild(document.adoptNode(body.firstChild));
  return frag;
}

/* A reference without a scheme names a file in the workspace, relative to the
   Markdown file's directory, or to the root when it starts with /, as on GitHub.
   Returns null for anything that does not resolve that way. */
function mdLocal(ref, base) {
  let u;
  try { u = new URL(ref, base); } catch { return null; }
  if (u.origin !== MD_ORIGIN) return null;
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch {}
  return { path: path.slice(1), hash: u.hash.slice(1) };
}

function mdSetImage(img, src, base) {
  const m = MD_SCHEME.exec(src);
  if (m) {
    if (/^https?$/i.test(m[1]) || /^data:image\//i.test(src)) img.setAttribute('src', src);
  } else if (src.startsWith('//')) {
    img.setAttribute('src', src);
  } else if (src) {
    const t = mdLocal(src, base);
    if (t) img.setAttribute('src', '/api/raw?path=' + encodeURIComponent(t.path));
  }
}

/* Links within the file scroll the preview, links to workspace files open them
   in px0, web links open a new browser tab, and any other scheme loses its href. */
function mdSetLink(a, href, base) {
  if (href.startsWith('#')) {
    a.setAttribute('href', href);
    a.dataset.anchor = href.slice(1);
    return;
  }
  const m = MD_SCHEME.exec(href);
  if (m || href.startsWith('//')) {
    if (m && !/^(https?|mailto)$/i.test(m[1])) return;
    a.setAttribute('href', href);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return;
  }
  const t = mdLocal(href, base);
  if (!t) return;
  a.setAttribute('href', '/api/raw?path=' + encodeURIComponent(t.path));
  a.dataset.path = t.path;
  if (t.hash) a.dataset.anchor = t.hash;
}

/* ---------- presentation ---------- */

const MD_ALERTS = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

function mdEnhance() {
  for (const q of $$('blockquote', mdArticle)) mdAlert(q);
  for (const pre of $$('pre', mdArticle)) {
    const wrap = document.createElement('div');
    wrap.className = 'md-pre';
    if (pre.dataset.lang) wrap.dataset.lang = pre.dataset.lang;
    pre.replaceWith(wrap);
    const copy = document.createElement('button');
    copy.className = 'md-copy';
    copy.title = 'Copy code';
    copy.setAttribute('aria-label', 'Copy code');
    // An icon, not a label: find in the preview walks text nodes.
    copy.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
    wrap.append(pre, copy);
  }
}

/* GitHub alerts: a blockquote opening with [!NOTE], [!TIP], [!IMPORTANT],
   [!WARNING] or [!CAUTION]. */
function mdAlert(q) {
  const p = q.firstElementChild;
  const t = p && p.localName === 'p' && p.firstChild;
  if (!t || t.nodeType !== 3) return;
  const m = /^\s*\[!(\w+)\][ \t]*\n?/.exec(t.nodeValue);
  const kind = m && m[1].toLowerCase();
  if (!kind || !MD_ALERTS[kind]) return;
  t.nodeValue = t.nodeValue.slice(m[0].length);
  if (!t.nodeValue) t.remove();
  if (p.firstChild && p.firstChild.localName === 'br') p.firstChild.remove();
  if (!p.textContent.trim() && !p.children.length) p.remove();
  const title = document.createElement('p');
  title.className = 'md-alert-title';
  title.textContent = MD_ALERTS[kind];
  q.prepend(title);
  q.classList.add('md-alert', 'md-alert-' + kind);
}

/* ---------- position ---------- */

const MD_GAP = 16; // space left above a block scrolled into place

function mdScrollTo(el) {
  mdview.scrollTop += el.getBoundingClientRect().top - mdview.getBoundingClientRect().top - MD_GAP;
}

function mdFindAnchor(anchor) {
  let id = anchor;
  try { id = decodeURIComponent(anchor); } catch {}
  for (const k of [id, id.toLowerCase()]) {
    const el = document.getElementById('md-' + k);
    if (el && mdArticle.contains(el)) return el;
  }
  return null;
}

/* Line-based navigation lands on the block holding that line. Before the HTML
   has arrived, the line waits for drawPreview. */
function previewLine(n) {
  const d = doc_();
  if (!d || mdDrawn !== d) { if (d) d.mdLine = n; return; }
  let best = null, at = 0;
  for (const el of mdArticle.querySelectorAll('[data-line]')) {
    const l = +el.dataset.line;
    if (l <= n && l > at) { best = el; at = l; }
  }
  if (best) mdScrollTo(best); else mdview.scrollTop = 0;
}

/* Source line of the last block starting at or above the top of the preview,
   counting one that mdScrollTo has just placed there. */
function previewTopLine() {
  const top = mdview.getBoundingClientRect().top + MD_GAP + 8;
  let line = 1;
  for (const el of mdArticle.querySelectorAll('[data-line]')) {
    if (el.getBoundingClientRect().top > top) break;
    line = +el.dataset.line;
  }
  return line;
}

function sourceTopLine() {
  const top = vp.getBoundingClientRect().top;
  for (const r of rowsEl.children) if (r.getBoundingClientRect().bottom > top + 1) return +r.dataset.l;
  return 1;
}

/* Put a source line at the top of the code view. Rows are placed by LH, which
   wrapped rows outgrow, so correct against where the row was actually painted. */
function sourceToLine(line) {
  vp.scrollTop = (line - 1) * LH;
  for (let i = 0; i < 3; i++) {
    paint();
    const r = rowFor(line);
    const off = r ? r.getBoundingClientRect().top - vp.getBoundingClientRect().top : 0;
    if (Math.abs(off) < 1) break;
    vp.scrollTop += off;
  }
}

async function mdFollow(path, anchor) {
  const d = doc_();
  path = path.replace(/\/+$/, '');
  if (d && path === d.path) { mdJump(anchor); return; }
  if (d) pushHistory(d.path, previewing(d) && mdDrawn === d ? previewTopLine() : d.cur);
  // A link to a folder reveals it in the explorer.
  try {
    await api('/api/tree', { dir: path });
    showPanel('files');
    revealDir(path);
    return;
  } catch {}
  const line = /^L(\d+)/.exec(anchor);
  await openFile(path, line ? { line: +line[1] } : {});
  const nd = doc_();
  if (!nd || nd.path !== path) { showToast('!', 'Cannot open ' + path); return; }
  if (anchor && !line) {
    const el = mdDrawn === nd && mdFindAnchor(anchor);
    if (el) mdScrollTo(el); else nd.mdAnchor = anchor;
  }
}

function mdJump(anchor) {
  const d = doc_();
  const el = anchor && mdFindAnchor(anchor);
  if (!d || !el) return;
  pushHistory(d.path, previewTopLine());
  mdScrollTo(el);
  const block = el.closest('[data-line]');
  if (block) pushHistory(d.path, +block.dataset.line);
}

/* ---------- keys, select all, find ---------- */

function previewKey(e) {
  const mod = e[MOD];
  if (e.key === 'Home' || (isMac && mod && e.key === 'ArrowUp')) { mdview.scrollTop = 0; return true; }
  if (e.key === 'End' || (isMac && mod && e.key === 'ArrowDown')) { mdview.scrollTop = mdview.scrollHeight; return true; }
  let by = 0;
  if (e.key === 'ArrowDown' || e.key === 'j') by = 48;
  else if (e.key === 'ArrowUp' || e.key === 'k') by = -48;
  else if (e.key === 'PageDown') by = mdview.clientHeight * 0.9;
  else if (e.key === 'PageUp') by = -mdview.clientHeight * 0.9;
  if (!by) return false;
  mdview.scrollBy({ top: by });
  return true;
}

function selectPreview() {
  const r = document.createRange();
  r.selectNodeContents(mdArticle);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function clearPreviewMarks() {
  const marks = $$('mark.md-hit', mdArticle);
  for (const m of marks) m.replaceWith(...m.childNodes);
  if (marks.length) mdArticle.normalize();
}

/* Marks every case-insensitive match of q in the rendered text; returns the count. */
function findInPreview(q) {
  clearPreviewMarks();
  if (!q) return 0;
  const marks = markNodes(mdArticle, q, false, 'mark');
  for (const m of marks) m.classList.add('md-hit');
  return marks.length;
}

function showPreviewHit(i) {
  const marks = $$('mark.md-hit', mdArticle);
  marks.forEach((m, k) => m.classList.toggle('on', k === i));
  const m = marks[i];
  if (!m) return;
  const box = mdview.getBoundingClientRect(), r = m.getBoundingClientRect();
  if (r.top < box.top + 40 || r.bottom > box.bottom - 40) {
    mdview.scrollTop += r.top - box.top - mdview.clientHeight / 2;
  }
}

/* Match positions as percentages of the preview's height, for the minimap. */
function previewHitOffsets() {
  const h = mdview.scrollHeight || 1, top = mdview.getBoundingClientRect().top - mdview.scrollTop;
  const seen = new Set();
  return $$('mark.md-hit', mdArticle)
    .map(m => ((m.getBoundingClientRect().top - top) / h * 100).toFixed(2))
    .filter(p => !seen.has(p) && seen.add(p));
}

function scrollPreviewTo(fraction) {
  mdview.scrollTop = fraction * mdview.scrollHeight - mdview.clientHeight / 2;
}

function initMarkdown() {
  const sw = $('#md-switch');
  // Keep focus where it was, so arrow keys go on scrolling the view afterwards.
  sw.addEventListener('mousedown', e => e.preventDefault());
  sw.addEventListener('click', e => {
    const b = e.target.closest('[data-md]');
    if (b && (b.dataset.md === 'preview') !== previewing()) togglePreview();
  });

  mdArticle.addEventListener('click', e => {
    const copy = e.target.closest('.md-copy');
    if (copy) { copyToClipboard($('pre', copy.parentElement).textContent, 'Copied code block'); return; }
    const a = e.target.closest('a');
    // Modified clicks keep the browser's behaviour: the href opens the raw file.
    if (!a || e.button !== 0 || e[MOD] || e.shiftKey) return;
    if ('path' in a.dataset) { e.preventDefault(); mdFollow(a.dataset.path, a.dataset.anchor || ''); }
    else if ('anchor' in a.dataset) { e.preventDefault(); mdJump(a.dataset.anchor); }
  });

  htmlview?.addEventListener('load', () => {
    try {
      htmlview.contentWindow.addEventListener('keydown', e => {
        const mod = e[MOD];
        if (e.key === 'Escape' || (e.altKey && !mod && !e.shiftKey && e.code === 'KeyM')) {
          window.dispatchEvent(new KeyboardEvent('keydown', e));
        }
      });
    } catch {}
  });
}

// --- File: web/src/diff.js ---
// web/src/diff.js
// Git diff view for the active tab: renders the file's unified diff against
// HEAD in a dedicated overlay (like the Markdown preview), in either a
// side-by-side split layout (default) or a single-column unified layout.
// Unlike the code viewport this is not virtualized -- a file's own diff is
// bounded in size, so a plain DOM render is simple and fast enough.
const diffview = $('#diffview');
const diffContent = $('#diffcontent');

let shown = null; // doc the diff view is currently showing, null while hidden

// d.diffMode is 'split' | 'unified' | null (off), per tab. The layout last
// picked (split vs unified) is remembered globally as the default for the
// next file entering diff view.
function setLayoutPref(mode) {
  try { localStorage.setItem('px0.diffLayout', mode); } catch {}
}

function layoutPref() {
  try { return localStorage.getItem('px0.diffLayout') || 'split'; } catch { return 'split'; }
}

function diffMode(d = doc_()) {
  return (d && d.diffMode) || null;
}

/* Show or hide the diff overlay to match the active tab, and re-render when
   the layout (split/unified) changes while already showing the same doc --
   switching layout doesn't change which doc is "shown", so that alone can't
   be the signal to redraw. Call whenever either might have changed. */
function syncDiffView() {
  const d = doc_();
  const want = (d && d.diffMode) ? d : null;
  if (want !== shown) {
    shown = want;
    diffview.hidden = !want;
    if (want) drawDiff(want);
    else diffContent.replaceChildren();
  } else if (want && want.diffHunks !== undefined) {
    renderDiff(want);
  }
}

async function toggleDiff() {
  if (!S.meta?.git) return;
  const d = doc_();
  if (!d) return;
  if (!d.diffMode && !d.diffAvailable) { setStatusNote('No diff — clean file or not a git repo'); return; }
  setDiffMode(d.diffMode ? 'source' : (layoutPref() || 'split'));
}

async function setDiffMode(mode) {
  const d = doc_();
  if (!d) return;
  if (mode !== 'source' && !d.diffAvailable) { setStatusNote('No diff — clean file or not a git repo'); return; }
  if (mode === 'source') {
    d.diffMode = null;
    d.diffDismissed = true;
  } else {
    d.diffMode = mode;
    d.diffDismissed = false;
    setLayoutPref(mode);
  }
  syncPreview(); // markdown preview and diff view are mutually exclusive
  syncDiffView();
  updateStatus();
}

async function drawDiff(d) {
  if (d.diffText === undefined) {
    diffContent.replaceChildren();
    try {
      d.diffReq = d.diffReq || api('/api/diff', { path: d.path });
      const j = await d.diffReq;
      d.diffText = j.diff || '';
      d.diffHunks = parseDiff(d.diffText);
    } catch (e) {
      d.diffText = '';
      d.diffHunks = [];
      setStatusNote('No diff: ' + e.message);
    } finally {
      d.diffReq = null;
    }
    if (shown !== d) return;
  }
  renderDiff(d);
}

function renderDiff(d) {
  diffContent.replaceChildren();
  if (!d.diffHunks || !d.diffHunks.length) {
    const p = document.createElement('div');
    p.className = 'diff-empty';
    p.textContent = 'No changes against HEAD.';
    diffContent.append(p);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const hunk of d.diffHunks) {
    frag.append(hunkHeader(hunk));
    frag.append(d.diffMode === 'unified' ? unifiedTable(hunk) : splitTable(hunk));
  }
  diffContent.append(frag);
}

function hunkHeader(hunk) {
  const el = document.createElement('div');
  el.className = 'diff-hunk-head';
  el.textContent = '@@ -' + hunk.oldStart + ' +' + hunk.newStart + ' @@' + (hunk.section ? ' ' + hunk.section : '');
  return el;
}

/* ---------- unified diff parsing ---------- */

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[ \t]?(.*)$/;

// Parses a unified diff (as returned by `git diff`) into hunks, each a flat
// list of rows tagged ctx/add/del carrying old- and/or new-file line numbers.
// File headers (diff --git, index, ---, +++) are skipped: nothing before the
// first @@ is kept.
function parseDiff(text) {
  if (!text) return [];
  const hunks = [];
  let cur = null, oldLine = 0, newLine = 0;
  for (const line of text.split('\n')) {
    const m = HUNK_RE.exec(line);
    if (m) {
      oldLine = +m[1];
      newLine = +m[3];
      cur = { oldStart: oldLine, newStart: newLine, section: m[5] || '', rows: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || line === '' || line.startsWith('\\')) continue; // trailing split artifact, pre-hunk header, or "\ No newline..."
    const c = line[0], body = line.slice(1);
    if (c === '+') cur.rows.push({ type: 'add', newLine: newLine++, text: body });
    else if (c === '-') cur.rows.push({ type: 'del', oldLine: oldLine++, text: body });
    else cur.rows.push({ type: 'ctx', oldLine: oldLine++, newLine: newLine++, text: body });
  }
  return hunks;
}

/* ---------- unified layout: one row per diff line ---------- */

function unifiedTable(hunk) {
  const table = document.createElement('div');
  table.className = 'diff-table diff-unified';
  for (const row of hunk.rows) {
    const r = document.createElement('div');
    r.className = 'diff-row diff-' + row.type;
    r.append(
      lineCell(row.type === 'add' ? '' : row.oldLine),
      lineCell(row.type === 'del' ? '' : row.newLine),
      markerCell(row.type),
      codeCell(row.text),
    );
    table.append(r);
  }
  return table;
}

/* ---------- split layout: deletions and additions paired side by side ---------- */

function splitTable(hunk) {
  const table = document.createElement('div');
  table.className = 'diff-table diff-split';
  for (const pair of pairRows(hunk.rows)) {
    const r = document.createElement('div');
    r.className = 'diff-row-pair';
    r.append(splitSide(pair.left, 'left'), splitSide(pair.right, 'right'));
    table.append(r);
  }
  return table;
}

// Walks a hunk's flat row list, pairing each run of deletions with the run of
// additions that immediately follows it (a "changed" block) index-by-index,
// padding the shorter side with blanks. Context rows go straight across.
function pairRows(rows) {
  const pairs = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === 'ctx') { pairs.push({ left: row, right: row }); i++; continue; }
    let dels = [], adds = [];
    while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) pairs.push({ left: dels[k] || null, right: adds[k] || null });
  }
  return pairs;
}

function splitSide(row, side) {
  const el = document.createElement('div');
  el.className = 'diff-side diff-side-' + side + (row ? ' diff-' + row.type : ' diff-blank');
  if (!row) { el.append(lineCell(''), markerCell(''), codeCell('')); return el; }
  const ln = side === 'left' ? row.oldLine : row.newLine;
  el.append(lineCell(ln), markerCell(row.type), codeCell(row.text));
  return el;
}

function lineCell(n) {
  const el = document.createElement('div');
  el.className = 'diff-ln';
  el.textContent = n === '' || n === undefined ? '' : String(n);
  return el;
}

const MARKS = { add: '+', del: '-', ctx: '' };

function markerCell(type) {
  const el = document.createElement('div');
  el.className = 'diff-mk';
  el.textContent = MARKS[type] || '';
  return el;
}

function codeCell(text) {
  const el = document.createElement('div');
  el.className = 'diff-code';
  el.innerHTML = esc(text || '') || '&nbsp;';
  return el;
}

function initDiff() {
  const sw = $('#diff-switch');
  if (!sw) return;
  sw.addEventListener('mousedown', e => {
    if (!e.target.closest('button')) e.preventDefault();
  });
  const btn = $('#diff-btn');
  if (btn) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleDiff();
    });
  }
  const menu = $('#diff-menu');
  if (menu) {
    menu.addEventListener('click', e => {
      const item = e.target.closest('[data-diff-opt]');
      if (!item) return;
      e.stopPropagation();
      setDiffMode(item.dataset.diffOpt);
      item.blur();
    });
  }
}

// --- File: web/src/status.js ---
function updateStatus() {
  const d = doc_();
  const pathEl = $('#st-path');
  if (pathEl) {
    pathEl.textContent = d ? d.path : '';
    pathEl.title = d ? `${d.path} (Click to copy path)` : '';
  }

  const sizeEl = $('#st-size');
  if (sizeEl) sizeEl.textContent = d ? fmtBytes(d.size) : '';

  const isPreviewable = !!(d && (d.markdown || d.html)), shown = previewing(d);
  const mdBtn = $('[data-action="md-preview"]');
  if (mdBtn) {
    mdBtn.hidden = !isPreviewable;
    mdBtn.classList.toggle('active', shown);
  }
  const sw = $('#md-switch');
  if (sw) {
    sw.hidden = !isPreviewable;
    document.body.classList.toggle('md-tab', isPreviewable);
    for (const b of sw.children) b.classList.toggle('on', isPreviewable && (b.dataset.md === 'preview') === shown);
  }

  const hasDiff = !!(d && d.diffAvailable);
  const isDiffOn = !!(d && d.diffMode);
  const currentLayout = (d && d.diffMode) || layoutPref();
  const dsw = $('#diff-switch');
  if (dsw) {
    dsw.hidden = !hasDiff;
    document.body.classList.toggle('diff-tab', hasDiff);
    const btn = $('#diff-btn');
    if (btn) {
      btn.classList.toggle('on', hasDiff && isDiffOn);
      btn.title = withKeys(isDiffOn
        ? `Diff: active (${d.diffMode === 'unified' ? 'Unified' : 'Split'}) — click to show source ({Mod+D})`
        : `Diff: off — click to show diff ({Mod+D})`);
    }
    const menuItems = dsw.querySelectorAll('.diff-menu-item');
    for (const item of menuItems) {
      item.classList.toggle('active', item.dataset.diffOpt === currentLayout);
    }
  }

  const idxEl = $('#st-index');
  if (idxEl && S.meta) {
    idxEl.textContent = S.meta.indexMs + 'ms';
    idxEl.title = `Workspace Indexing: took ${S.meta.indexMs}ms to index ${S.meta.files.toLocaleString()} files (${S.meta.ready ? 'ready' : 'in progress'})`;
  }

  const verEl = $('#st-ver');
  if (verEl && S.meta?.version) {
    verEl.textContent = 'v' + S.meta.version;
    verEl.title = `px0 v${S.meta.version} (Click for shortcuts & help)`;
  }
  drawLspStatus();
}

function setStatusNote(msg) {
  const el = $('#st-pos');
  if (el) el.textContent = msg;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function setLspState(j) {
  if (!j || !j.state) return;
  S.lsp.state = j.state;
  S.lsp.server = j.server || S.lsp.server;
  // Only file, warm and start replies say what is missing; any running server means nothing is.
  if ('missing' in j || j.state !== 'off') S.lsp.missing = j.missing || '';
  drawLspStatus();
}

function drawLspStatus() {
  const el = $('#st-lsp');
  const { state, server, missing } = S.lsp;
  el.title = '';
  if (state === 'off' && missing) {
    el.dataset.state = 'missing';
    el.textContent = 'LSP: set up';
    el.title = 'No language server for ' + missing + '. Click to install or start one.';
    return;
  }
  if (!server || state === 'off') { el.textContent = ''; el.removeAttribute('data-state'); return; }
  el.dataset.state = state;
  el.textContent = state === 'ready' ? server : server + ' ' + state;
  if (state === 'failed') el.title = 'The language server did not start. Click for details.';
}

function updateMetricsDisplay(m) {
  if (!m) return;
  const cpuEl = $('#st-cpu');
  const ramEl = $('#st-ram');
  const contEl = $('#st-metrics');
  if (cpuEl) cpuEl.textContent = `${m.cpuUsage.toFixed(1)}%`;
  if (ramEl) ramEl.textContent = fmtBytes(m.rssBytes);
  if (contEl) {
    contEl.title = `Editor OS Process Usage:\n• Resident RAM (RSS): ${fmtBytes(m.rssBytes)}\n• CPU Usage: ${m.cpuUsage.toFixed(1)}%\n• Active Goroutines: ${m.goroutines || 0}`;
  }
}

async function refreshMetrics() {
  try {
    const m = await api('/api/metrics');
    updateMetricsDisplay(m);
  } catch {}
}

function initMetrics() {
  refreshMetrics();
  setInterval(refreshMetrics, 2500);
}

/* The status bar stays on one line. When its contents outgrow the width, it
   sheds detail in steps (see the fit-N rules in style.css), least useful first,
   stopping at the first step that fits. */
const FIT_STEPS = 6;
const statusEl = $('#status');

function fitStatus() {
  for (let i = 1; i <= FIT_STEPS; i++) statusEl.classList.remove('fit-' + i);
  for (let i = 1; i <= FIT_STEPS && statusEl.scrollWidth > statusEl.clientWidth; i++) {
    statusEl.classList.add('fit-' + i);
  }
}

function initStatus() {
  $('#st-path')?.addEventListener('click', () => {
    const d = doc_();
    if (d && d.path) {
      copyToClipboard(d.path, 'Copied path: ' + d.path);
    }
  });
}

function initStatusFit() {
  // Width changes come from the window and the sidebar resizers; content changes
  // from metrics, LSP state and the selection bar. Class changes are not observed,
  // so fitStatus() toggling them cannot re-trigger itself.
  new ResizeObserver(fitStatus).observe(statusEl);
  new MutationObserver(fitStatus).observe(statusEl, { childList: true, subtree: true, characterData: true });
  document.fonts?.ready.then(fitStatus);
}

// --- File: web/src/selbar.js ---
// web/src/selbar.js





/* While code is selected, the left of the status bar trades its navigation
   buttons for actions on the selection, and hands them back once the selection
   is gone. Unlike a floating menu it never covers code, and its buttons stay put. */

const status = $('#status');
const statsEl = $('#sel-stats');

// e.code, not e.key: Option+letter types a symbol on macOS.
const SEL_KEYS = { KeyC: 'copy-ref', KeyA: 'copy-agent', KeyU: 'usages' };

let current = null;   // the selection the bar is showing, or null when it is not
let allText = null;   // Ctrl+A: promise of the S.selAll file's full text
let allInfo = null;   // the bar's view of that selection, once the text arrives

function getSelectedRangeInfo() {
  if (S.selAll) return allInfo;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const d = doc_();
  if (!d) return null;

  const range = sel.getRangeAt(0);
  if (!vp.contains(range.commonAncestorContainer)) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  let startEl = range.startContainer;
  if (startEl.nodeType !== 1) startEl = startEl.parentElement;
  let endEl = range.endContainer;
  if (endEl.nodeType !== 1) endEl = endEl.parentElement;

  const startRow = startEl ? startEl.closest('.row') : null;
  const endRow = endEl ? endEl.closest('.row') : null;

  let l1 = d.cur || 1, l2 = d.cur || 1;
  if (startRow && startRow.dataset.l) l1 = +startRow.dataset.l;
  if (endRow && endRow.dataset.l) l2 = +endRow.dataset.l;

  if (l1 > l2) { const tmp = l1; l1 = l2; l2 = tmp; }

  return { text, l1, l2, path: d.path };
}

const refOf = ({ path, l1, l2 }) => path + ':' + (l1 === l2 ? l1 : l1 + '-' + l2);

function showSelectionBar(info) {
  current = info;
  const ref = refOf(info);
  const lines = info.l2 - info.l1 + 1;
  statsEl.title = ref;
  statsEl.textContent = (lines === 1 ? '1 line' : lines + ' lines') + ' · ' +
    info.text.length.toLocaleString() + ' chars';
  status.classList.add('selecting');
  fitStatus();
}

function hideSelectionBar() {
  if (!current) return;
  current = null;
  status.classList.remove('selecting');
  fitStatus();
}

function updateSelectionBar() {
  const info = getSelectedRangeInfo();
  if (info) showSelectionBar(info); else hideSelectionBar();
}

/* Ctrl+A selects the open file, not the page around it. Only the rows in view
   exist in the DOM, so a native selection could never span the file: S.selAll
   marks the doc, paint() shades its rows, and the text comes whole from /api/raw. */
function selectAll() {
  const d = doc_();
  if (!d) return;
  window.getSelection()?.removeAllRanges();
  S.selAll = d;
  allInfo = null;
  render();
  const text = allText = fetch('/api/raw?path=' + encodeURIComponent(d.path))
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); });
  text.then(t => {
    if (allText !== text) return; // cleared or selected again meanwhile
    allInfo = { text: t, l1: 1, l2: d.total, path: d.path };
    showSelectionBar(allInfo);
  }, () => {
    if (allText !== text) return;
    clearSelectAll();
    showToast('!', 'Could not read ' + d.path);
  });
}

function clearSelectAll() {
  if (!S.selAll) return;
  S.selAll = null; allText = null; allInfo = null;
  render();
  hideSelectionBar();
}

/* Ctrl+C on a whole-file selection. Returns false when there is none, so the
   browser copies a native selection as usual. */
function copySelectAll() {
  const d = S.selAll;
  if (!d || !allText) return false;
  allText.then(t => copyToClipboard(t, 'Copied ' + d.path + ' (' + d.total.toLocaleString() + ' lines)'), () => {});
  return true;
}

/* Runs one of the bar's actions on the current selection. Returns false when the
   bar is not showing, so a shortcut can fall through to the browser. */
function runSelectionAction(act) {
  if (!current) return false;
  const { text, path } = current;
  const ref = refOf(current);
  if (act === 'copy-ref') {
    copyToClipboard(ref, 'Copied ' + ref);
  } else if (act === 'copy-agent') {
    const ext = path.split('.').pop() || '';
    copyToClipboard('### Reference: ' + ref + '\n```' + ext + '\n' + text + '\n```', 'Copied snippet for Agent (' + ref + ')');
  } else if (act === 'usages') {
    findReferences(text.split(/\s+/)[0] || text);
  } else {
    return false;
  }
  return true;
}

function initSelectionBar() {
  /* Enter only once the gesture is over: swapping the footer mid-drag flickers.
     Once showing, follow the selection as it changes, and leave when it collapses
     or moves out of the editor. Listening on the document catches a drag that
     is released outside the viewport. */
  document.addEventListener('mouseup', () => setTimeout(updateSelectionBar, 20));
  vp.addEventListener('keyup', e => { if (e.shiftKey) setTimeout(updateSelectionBar, 20); });
  document.addEventListener('selectionchange', () => { if (current) updateSelectionBar(); });
  // Any click ends a whole-file selection, except on the bar's buttons or a viewport scrollbar.
  document.addEventListener('mousedown', e => {
    if (!S.selAll || e.target.closest?.('#footer-sel')) return;
    if (e.target === vp && (e.offsetX >= vp.clientWidth || e.offsetY >= vp.clientHeight)) return;
    clearSelectAll();
  }, true);

  const bar = $('#footer-sel');
  // Pressing a button must not clear the selection it is about to act on.
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const btn = e.target.closest('[data-sel]');
    if (btn) runSelectionAction(btn.dataset.sel);
  });
}

// --- File: web/src/tabs.js ---
// web/src/tabs.js














// Recently closed files, newest last, for Alt+Shift+T.
const closedTabs = [];
const MAX_CLOSED = 20;

async function openFile(path, opts = {}) {
  const { line, push = true, col } = opts;
  let idx = S.tabs.findIndex(t => t.path === path);
  if (idx < 0) {
    let j;
    const start = line ? Math.max(0, Math.floor((line - 1) / CHUNK) * CHUNK) : 0;
    try {
      j = await api('/api/file', { path, start, count: CHUNK });
    } catch (e) {
      setStatusNote(path + ': ' + e.message);
      return;
    }
    if (j.image) {
      showImage(path);
      return;
    }
    const hasDiff = !!j.diffAvailable;
    const d = {
      path, name: path.split('/').pop(), lang: j.lang, total: j.total, maxCols: j.maxCols,
      size: j.size, lines: new Array(j.total), chunks: new Set([start / CHUNK]),
      pending: new Set(), refining: new Set(), scrollTop: 0, cur: line || 1,
      outline: null, gen: 0, markdown: !!j.markdown, html: !!j.html || /\.(html|htm)$/i.test(path), gutter: null,
      diffMode: hasDiff ? (layoutPref() || 'split') : null,
      diffAvailable: hasDiff,
      diffDismissed: false,
    };
    for (let i = 0; i < j.lines.length; i++) d.lines[j.start + i] = j.lines[i];
    d.lsp = j.lsp || { state: 'off', server: '' };
    S.tabs.push(d);
    idx = S.tabs.length - 1;
    if (j.refine) refineChunk(d, start / CHUNK);
    loadGutter(d);
  }
  const prev = doc_();
  if (prev && prev !== S.tabs[idx]) prev.scrollTop = vp.scrollTop;
  if (prev !== S.tabs[idx]) { clearSelectAll(); clearFind(); }
  S.active = idx;
  const d = S.tabs[idx];

  $('#empty').hidden = true;
  hideImage();
  syncPreview();
  syncDiffView();
  if (!S.at || S.at.path !== d.path) S.at = null;
  S.lsp.state = (d.lsp && d.lsp.state) || 'off';
  S.lsp.server = (d.lsp && d.lsp.server) || '';
  S.lsp.missing = (d.lsp && d.lsp.missing) || '';
  warmLSP(d);
  drawTabs(); drawCrumbs(); layout();

  if (line) { d.cur = line; centerLine(line); }
  else vp.scrollTop = d.scrollTop;
  render();
  updateStatus();
  if ($('#panel-outline')?.classList.contains('active')) loadOutline();
  if (push) pushHistory(path, line || d.cur, col);
  revealFile(d.path);
}

// VS Code-style diff gutter for the normal file view. Fetches once per opened
// doc and caches on it (each tab keeps its own; switching tabs needs no clear).
// Fetches on any open in a git repo rather than threading per-file status
// through every open path — the backend returns available:false for
// clean/untracked files, so the extra request is cheap and self-limiting.
function loadGutter(d) {
  if (!S.meta?.git) return;
  api('/api/gutter', { path: d.path }).then(j => {
    d.diffAvailable = !!j.available;
    if (j.available && d.diffMode === null && !d.diffDismissed) {
      d.diffMode = layoutPref() || 'split';
      if (doc_() === d) {
        syncDiffView();
        syncPreview();
      }
    }
    if (doc_() === d) updateStatus();
    if (!j.available) return;
    const marks = new Map();
    for (const n of j.modified) marks.set(n, 'mod');
    for (const n of j.added) marks.set(n, 'add');
    d.gutter = { marks, dels: new Set(j.deleted) };
    if (doc_() === d) render();
  }).catch(() => {});
}

// Quietly re-fetches all open tabs on workspace reindex without tab-switching thrash.
// Preserves live scroll position, cursor column/line (clamped), diff settings, and markdown scroll.
async function reloadOpenTabs() {
  if (S.tabs.length === 0) return;

  const activeDoc = doc_();
  if (activeDoc) {
    activeDoc.scrollTop = vp.scrollTop;
    if (previewing(activeDoc)) {
      const mv = $('#mdview');
      if (mv) activeDoc.mdScroll = mv.scrollTop;
    }
  }

  const targets = S.tabs.map(t => ({
    oldDoc: t,
    path: t.path,
    anchor: t.cur || 1,
    start: t.cur ? Math.max(0, Math.floor((t.cur - 1) / CHUNK) * CHUNK) : 0,
  }));

  const results = await Promise.allSettled(
    targets.map(tgt => api('/api/file', { path: tgt.path, start: tgt.start, count: CHUNK }))
  );

  for (let i = 0; i < targets.length; i++) {
    const res = results[i];
    const tgt = targets[i];
    const idx = S.tabs.indexOf(tgt.oldDoc);
    if (idx < 0) continue; // tab closed while reloading

    if (res.status !== 'fulfilled') {
      if (idx === S.active) {
        setStatusNote(tgt.path + ': ' + (res.reason?.message || 'failed to load'));
      }
      continue;
    }

    const j = res.value;
    if (j.image) continue;

    const keep = tgt.oldDoc;
    const hasDiff = !!j.diffAvailable;
    const newCur = Math.max(1, Math.min(keep.cur || 1, j.total));

    let diffMode = null;
    if (hasDiff) {
      if (keep.diffDismissed) {
        diffMode = null;
      } else if (keep.diffMode) {
        diffMode = keep.diffMode;
      } else {
        diffMode = layoutPref() || 'split';
      }
    }

    const d = {
      path: tgt.path,
      name: tgt.path.split('/').pop(),
      lang: j.lang,
      total: j.total,
      maxCols: j.maxCols,
      size: j.size,
      lines: new Array(j.total),
      chunks: new Set([tgt.start / CHUNK]),
      pending: new Set(),
      refining: new Set(),
      scrollTop: keep.scrollTop || 0,
      cur: newCur,
      col: keep.col || 0,
      outline: null,
      gen: 0,
      markdown: !!j.markdown,
      mdScroll: keep.mdScroll || 0,
      gutter: null,
      diffMode,
      diffAvailable: hasDiff,
      diffDismissed: !!keep.diffDismissed,
    };

    for (let k = 0; k < j.lines.length; k++) {
      d.lines[j.start + k] = j.lines[k];
    }
    d.lsp = j.lsp || { state: 'off', server: '' };

    S.tabs[idx] = d;
    if (j.refine) refineChunk(d, tgt.start / CHUNK);
    loadGutter(d);
  }

  const d = doc_();
  if (d) {
    S.lsp.state = (d.lsp && d.lsp.state) || 'off';
    S.lsp.server = (d.lsp && d.lsp.server) || '';
    S.lsp.missing = (d.lsp && d.lsp.missing) || '';
    warmLSP(d);
    syncPreview();
    syncDiffView();
    layout();
    vp.scrollTop = d.scrollTop;
    render();
    if ($('#panel-outline')?.classList.contains('active')) loadOutline();
  }

  drawTabs();
  drawCrumbs();
  updateStatus();
}

function centerLine(n) {
  if (previewing()) { previewLine(n); return; }
  const y = (n - 1) * LH - Math.max(0, vp.clientHeight / 2 - LH * 2);
  vp.scrollTop = Math.max(0, y);
}

function closeTab(i) {
  clearSelectAll();
  const [closed] = S.tabs.splice(i, 1);
  if (closed) {
    if (closed.path) {
      // The active tab's scrollTop is only saved on switch, so read the live one.
      const scrollTop = i === S.active ? vp.scrollTop : closed.scrollTop;
      closedTabs.push({ path: closed.path, cur: closed.cur, scrollTop });
      if (closedTabs.length > MAX_CLOSED) closedTabs.shift();
      api('/api/close', { path: closed.path })
        .then(() => refreshMetrics())
        .catch(() => {});
    }
    // Release large arrays to assist garbage collection
    closed.lines = null;
    closed.chunks?.clear?.();
    closed.pending?.clear?.();
    closed.refining?.clear?.();
    closed.outline = null;
  }
  if (S.tabs.length === 0) {
    S.active = -1;
    syncPreview();
    syncDiffView();
    rowsEl.innerHTML = ''; sizer.style.height = '0px';
    $('#empty').hidden = false; drawCrumbs();
    drawTabs(); updateStatus();
    return;
  }
  S.active = Math.min(i, S.tabs.length - 1);
  const d = doc_();
  syncPreview();
  syncDiffView();
  drawTabs(); drawCrumbs(); layout();
  vp.scrollTop = d.scrollTop; render(); updateStatus();
}

// Reopens the most recently closed file that is not open already, where it was left.
async function reopenClosedTab() {
  while (closedTabs.length) {
    const t = closedTabs.pop();
    if (S.tabs.some(d => d.path === t.path)) continue;
    await openFile(t.path, { line: t.cur });
    if (doc_()?.path !== t.path) return;
    vp.scrollTop = t.scrollTop;
    render(); updateStatus();
    return;
  }
}

function drawTabs() {
  $('#tabs').innerHTML = S.tabs.map((t, i) =>
    '<div class="tab' + (i === S.active ? ' active' : '') + '" data-i="' + i + '" title="' + esc(t.path) + '">' +
    '<span class="tn">' + esc(t.name) + '</span><span class="x" data-close="' + i + '" title="' + withKeys('Close tab ({Alt+W})') + '"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6"/></svg></span></div>').join('');
  const act = $('#tabs .tab.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function switchTab(i) {
  if (i === S.active || !S.tabs[i]) return;
  clearLink();
  const prev = doc_();
  if (prev) prev.scrollTop = vp.scrollTop;
  S.active = i;
  syncPreview();
  syncDiffView();
  clearFind();
  clearSelectAll();
  S.at = null;
  S.lsp.state = (S.tabs[i].lsp && S.tabs[i].lsp.state) || 'off';
  S.lsp.server = (S.tabs[i].lsp && S.tabs[i].lsp.server) || '';
  S.lsp.missing = (S.tabs[i].lsp && S.tabs[i].lsp.missing) || '';
  warmLSP(S.tabs[i]);
  drawTabs(); drawCrumbs(); layout();
  vp.scrollTop = S.tabs[i].scrollTop;
  render(); updateStatus();
  if ($('#panel-outline')?.classList.contains('active')) loadOutline();
  pushHistory(S.tabs[i].path, S.tabs[i].cur);
  revealFile(S.tabs[i].path);
}

function drawCrumbs() {
  const el = $('#crumbs');
  if (el) el.innerHTML = '';
}

function showImage(path) {
  hideImage();
  const box = document.createElement('div');
  box.id = 'imgview';
  box.innerHTML = '<img src="/api/raw?path=' + encodeURIComponent(path) + '" alt="">';
  editor.appendChild(box);
  $('#empty').hidden = true;
}

function hideImage() {
  const b = $('#imgview');
  if (b) b.remove();
}

function initTabs() {
  $('#tabs').addEventListener('click', e => {
    const x = e.target.closest('[data-close]');
    if (x) { closeTab(+x.dataset.close); return; }
    const t = e.target.closest('.tab');
    if (t) switchTab(+t.dataset.i);
  });
  $('#tabs').addEventListener('auxclick', e => {
    const t = e.target.closest('.tab');
    if (t && e.button === 1) { e.preventDefault(); closeTab(+t.dataset.i); }
  });
  const crumbsEl = $('#crumbs');
  if (crumbsEl) {
    crumbsEl.addEventListener('click', e => {
      const c = e.target.closest('[data-dir]');
      if (c) { showPanel('files'); revealDir(c.dataset.dir); }
    });
  }
}

// --- File: web/src/theme.js ---
// web/src/theme.js
// A theme is any CSS rule whose whole selector is [data-theme="<id>"], optionally
// prefixed with :root or html. The server joins web/themes/*.css into
// /static/themes.css, so themes are discovered from the loaded stylesheets and
// adding one needs no JavaScript change. See docs/internals/styling-and-themes.md.

const KEY = 'px0.theme';
const THEME_SELECTOR = /^(?::root|html)?\[data-theme=["']?([\w-]+)["']?\]$/;

let themes = null;

function listThemes() {
  if (themes) return themes;
  const found = new Map();
  const walk = rules => {
    for (const r of rules) {
      if (r.styleSheet) { try { walk(r.styleSheet.cssRules); } catch {} continue; } // @import
      if (!r.selectorText) { if (r.cssRules) walk(r.cssRules); continue; }       // @media, @layer
      for (const part of r.selectorText.split(',')) {
        const m = part.trim().match(THEME_SELECTOR);
        if (!m) continue;
        const t = found.get(m[1]) || { id: m[1], name: m[1], scheme: '' };
        const name = r.style.getPropertyValue('--theme-name').trim().replace(/^["']|["']$/g, '');
        const scheme = r.style.getPropertyValue('color-scheme').trim();
        if (name) t.name = name;
        if (scheme) t.scheme = scheme;
        found.set(m[1], t);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch {} // cross-origin sheets (web fonts) are unreadable
  }
  themes = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  return themes;
}
const currentTheme = () => document.documentElement.dataset.theme;

function setTheme(id, persist = true) {
  if (!listThemes().some(t => t.id === id)) return false;
  document.documentElement.dataset.theme = id;
  if (persist) { try { localStorage.setItem(KEY, id); } catch {} }
  return true;
}

function cycleTheme() {
  const all = listThemes();
  if (!all.length) return;
  const next = all[(all.findIndex(t => t.id === currentTheme()) + 1) % all.length];
  setTheme(next.id);
  showToast('Theme', next.name);
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (saved && setTheme(saved, false)) return;
  // The attribute in index.html may name a theme that was since removed.
  const all = listThemes();
  if (all.length && !all.some(t => t.id === currentTheme())) setTheme(all[0].id, false);
}

// --- File: web/src/shortcuts.js ---
// web/src/shortcuts.js
















/* Each entry lists alternative combos, written as for keyLabel in state.js so
   they show as ⌘/⌥/⇧ on a Mac and Ctrl/Alt/Shift elsewhere. Browsers keep
   Ctrl+W and Cmd+W for themselves, so Alt+W is the close shortcut shown. */
const SHORTCUTS = [
  [['Mod+K'], 'Quick search / palette'], [['Mod+P'], 'Go to file'],
  [['Mod+Shift+P'], 'Command palette'], [['Mod+Shift+O'], 'Go to symbol'],
  [['Mod+Shift+F'], 'Search in files'], [['Mod+F'], 'Find in file'],
  [['Mod+G'], 'Go to line'], [['Mod+D'], 'Toggle diff view (git)'], [['Alt+Z'], 'Toggle word wrap'],
  [['Alt+L'], 'Toggle line numbers'], [['Alt+M'], 'Toggle Preview (Markdown/HTML)'],
  [['Enter', 'Shift+Enter'], 'Next / previous match'],
  [['F12', 'Mod+Click'], 'Go to definition'], [['Shift+F12'], 'Find all references'],
  [['Alt+Shift+H'], 'Call trail (callers / callees)'],
  [['Mod+J'], 'Toggle right inspector (Symbols/Refs)'],
  [['Ctrl+-|Alt+Left', 'Ctrl+Shift+-|Alt+Right'], 'Navigate back / forward'], [['Mod+B'], 'Toggle sidebar'],
  [['Alt+W'], 'Close tab'], [['Alt+Shift+T'], 'Reopen closed tab'], [['Ctrl+Tab'], 'Next tab'],
  [['Alt+1…9'], 'Select tab'], [['Double click'], 'Highlight all occurrences'],
  [['Mod+A'], 'Select whole file'],
  [['Alt+C', 'Alt+A'], 'Copy selection ref / for agent'], [['Alt+U'], 'Find usages of selection'],
  [['Mod+Home|Mod+Up', 'Mod+End|Mod+Down'], 'Top / bottom of file'],
  [['Home|Mod+Left', 'End|Mod+Right'], 'Start / end of line'],
  [['Left', 'Right'], 'Move caret along the line'],
  [['Esc'], 'Dismiss'],
];

function showHelp() {
  const h = $('#helpsheet');
  const ver = S.meta?.version ? ` <span class="help-version">v${esc(S.meta.version)}</span>` : '';
  h.innerHTML = '<div class="help-card"><div class="help-header"><h2>Keyboard Shortcuts</h2>' + ver + '</div><dl class="help-grid">' +
    SHORTCUTS.map(([combos, v]) =>
      '<dt>' + combos.map(keyCaps).filter(Boolean).join('<span class="key-or">/</span>') + '</dt>' +
      '<dd>' + esc(v) + '</dd>').join('') + '</dl></div>';
  h.hidden = false;
}
const inField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

function initShortcuts() {
  $('#btn-theme')?.addEventListener('click', cycleTheme);
  $('#btn-help')?.addEventListener('click', showHelp);
  $('#st-ver')?.addEventListener('click', showHelp);
  $('#helpsheet').addEventListener('click', () => { $('#helpsheet').hidden = true; });

  // Footer quick action buttons
  $('#footer-actions')?.addEventListener('click', e => {
    const btn = e.target.closest('.footer-btn');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'quick-open') openPalette('file');
    else if (act === 'search') { showRightInspector('search'); $('#q')?.select(); }
    else if (act === 'symbols') openPalette('symbol');
    else if (act === 'find') openFind(S.lastWord);
    else if (act === 'goto') openPalette('line');
    else if (act === 'wrap') toggleWordWrap();
    else if (act === 'line-numbers') toggleLineNumbers();
    else if (act === 'md-preview') togglePreview();
    else if (act === 'palette') openPalette('command');
    else if (act === 'help') showHelp();
  });

  addEventListener('keydown', e => {
    const mod = e[MOD];

    if (e.key === 'Escape') {
      if (!overlay.hidden) { closePalette(); return; }
      if (!$('#helpsheet').hidden) { $('#helpsheet').hidden = true; return; }
      if (!hovercard.hidden) { clearLink(); return; }
      if (!findbar.hidden) { clearFind(); return; }
      if (S.selAll) { clearSelectAll(); return; }
      if (!document.body.classList.contains('right-hidden')) { hideRightInspector(); return; }
      if (S.occ) { S.occ = null; paint(); return; }
      if (inField(document.activeElement)) document.activeElement.blur();
      return;
    }

    // Universal Quick Open / Command Palette: Cmd+K / Ctrl+K
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette(e.shiftKey ? 'command' : 'file');
      return;
    }

    if (mod && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      if (document.body.classList.contains('right-hidden')) showRightInspector('refs');
      else hideRightInspector();
      return;
    }

    if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); openPalette('command'); return; }
    if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); showRightInspector('symbols'); return; }
    if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); showRightInspector('search'); $('#q')?.select(); return; }
    if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette('file'); return; }
    if (mod && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openPalette('line'); return; }
    if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(S.lastWord); return; }
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); document.body.classList.toggle('side-hidden'); layout(); render(); return; }
    // Diff view of the open file (git only; fails quiet when git is off).
    if (mod && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { if (S.meta?.git) { e.preventDefault(); toggleDiff(); } return; }
    // Alt shortcuts match e.code: on a Mac, Option+letter types a symbol, so e.key is not the letter.
    if ((mod && (e.key === 'w' || e.key === 'W')) || (e.altKey && e.code === 'KeyW')) {
      e.preventDefault();
      e.stopPropagation();
      if (S.active >= 0) closeTab(S.active);
      return;
    }
    if (e.altKey && e.shiftKey && !mod && e.code === 'KeyT') { e.preventDefault(); reopenClosedTab(); return; }
    if (e.key === 'F12') {
      e.preventDefault();
      if (e.shiftKey) findReferences(); else gotoDefinition();
      return;
    }
    // Navigate back / forward in history:
    // 1. VS Code / Cursor macOS style: Ctrl+- (back), Ctrl+Shift+- (forward)
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'Minus' || e.key === '-' || e.key === '_')) {
      e.preventDefault();
      go(e.shiftKey ? 1 : -1);
      return;
    }
    // 2. Alt+Left / Alt+Right (VS Code PC style & standard px0)
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }
    // 3. Cmd+[ / Cmd+] (macOS browser / Xcode style)
    if (mod && !e.shiftKey && !e.altKey && !inField(document.activeElement) && (e.code === 'BracketLeft' || e.key === '[')) { e.preventDefault(); go(-1); return; }
    if (mod && !e.shiftKey && !e.altKey && !inField(document.activeElement) && (e.code === 'BracketRight' || e.key === ']')) { e.preventDefault(); go(1); return; }
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (S.tabs.length > 1) switchTab((S.active + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length);
      return;
    }
    if (e.altKey && e.shiftKey && e.code === 'KeyH') { e.preventDefault(); showCalls(); return; }
    if (e.altKey && !mod && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); switchTab(+e.code.slice(5) - 1); return; }
    // Selection actions, live only while the status bar is showing them.
    if (e.altKey && !mod && !e.shiftKey && SEL_KEYS[e.code] && runSelectionAction(SEL_KEYS[e.code])) { e.preventDefault(); return; }
    if (e.altKey && e.code === 'KeyZ') {
      e.preventDefault();
      toggleWordWrap();
      return;
    }

    if (e.altKey && e.code === 'KeyL') {
      e.preventDefault();
      toggleLineNumbers();
      return;
    }

    if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyM') {
      e.preventDefault();
      togglePreview();
      return;
    }

    if (inField(document.activeElement)) return;

    // Select all takes the open file only, never the sidebar or status bar around it.
    const plainMod = mod && !e.shiftKey && !e.altKey;
    if (plainMod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); if (previewing()) selectPreview(); else selectAll(); return; }
    if (plainMod && (e.key === 'c' || e.key === 'C') && copySelectAll()) { e.preventDefault(); return; }

    if (e.key === '?') { e.preventDefault(); showHelp(); return; }
    const d = doc_();
    if (!d) return;
    if (previewing(d)) { if (previewKey(e)) e.preventDefault(); return; }
    const toTop = () => { vp.scrollTop = 0; d.cur = 1; render(); updateStatus(); };
    const toBottom = () => { vp.scrollTop = sizer.offsetHeight; d.cur = d.total; render(); updateStatus(); };
    if (mod && e.key === 'Home') { e.preventDefault(); toTop(); return; }
    if (mod && e.key === 'End') { e.preventDefault(); toBottom(); return; }
    // A Mac keyboard has no Home or End: Cmd with the arrows does their job there.
    if (isMac && mod && e.key === 'ArrowUp') { e.preventDefault(); toTop(); return; }
    if (isMac && mod && e.key === 'ArrowDown') { e.preventDefault(); toBottom(); return; }
    if (isMac && mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); caretToEdge(e.key === 'ArrowRight'); return; }
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveCursor(1); return; }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveCursor(-1); return; }
    if (!mod && !e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); moveCol(-1); return; }
    if (!mod && !e.altKey && e.key === 'ArrowRight') { e.preventDefault(); moveCol(1); return; }
    if (!mod && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); caretToEdge(e.key === 'End'); return; }
    if (e.key === 'PageDown') { e.preventDefault(); moveCursor(Math.floor(vp.clientHeight / LH) - 2); return; }
    if (e.key === 'PageUp') { e.preventDefault(); moveCursor(-(Math.floor(vp.clientHeight / LH) - 2)); return; }
  }, { capture: true });


}

// --- File: web/src/palette.js ---
// web/src/palette.js
const overlay = $('#overlay');
const palInput = $('#pal');
const palList = $('#pal-list');
let pal = null;
const COMMANDS = [
  { name: 'Go to File…', run: () => openPalette('file') },
  { name: 'Go to Symbol in File…', run: () => openPalette('symbol') },
  { name: 'Go to Line…', run: () => openPalette('line') },
  { name: 'Search in Files', run: () => showRightInspector('search') },
  { name: 'Find in Current File', run: () => openFind(S.lastWord) },
  { name: 'Go to Definition', run: () => gotoDefinition() },
  { name: 'Find All References (Right Panel)', run: () => findReferences() },
  { name: withKeys('Show Call Trail: Callers / Callees ({Alt+Shift+H})'), run: () => showCalls() },
  { name: 'Set Up Language Server…', run: () => openLspSetup() },
  { name: 'Toggle Right Inspector (Symbols & References)', run: () => {
    if (document.body.classList.contains('right-hidden')) showRightInspector('refs');
    else hideRightInspector();
  } },
  { name: 'Show File Symbols (Right Panel)', run: () => showRightInspector('symbols') },
  { name: 'Reveal Active File in Explorer', run: () => { const d = doc_(); if (d) { showPanel('files'); revealFile(d.path); } } },
  { name: withKeys('Toggle Word Wrap ({Alt+Z})'), run: () => toggleWordWrap() },
  { name: withKeys('Toggle Line Numbers ({Alt+L})'), run: () => toggleLineNumbers() },
  { name: withKeys('Toggle Preview ({Alt+M})'), run: () => togglePreview() },
  { name: withKeys('Toggle Sidebar ({Mod+B})'), run: () => document.body.classList.toggle('side-hidden') },
  { name: 'Select Theme…', run: () => openPalette('theme') },
  { name: 'Next Theme', run: cycleTheme },
  { name: 'Re-index Workspace', run: () => $('#btn-reindex').click() },
  { name: 'Close Tab', run: () => { if (S.active >= 0) closeTab(S.active); } },
  { name: 'Close All Tabs', run: () => { while (S.tabs.length) closeTab(0); } },
  { name: withKeys('Reopen Closed Tab ({Alt+Shift+T})'), run: () => reopenClosedTab() },
  { name: 'Keyboard Shortcuts', run: showHelp },
];
const PAL_MODES = {
  file: { tag: 'File', hint: 'Type to fuzzy-match any file. Prefix : for a line, @ for a symbol, > for a command.' },
  symbol: { tag: 'Symbol', hint: 'Symbols in the active file.' },
  line: { tag: 'Line', hint: 'Enter a line number.' },
  command: { tag: 'Command', hint: '' },
  theme: { tag: 'Theme', hint: 'Arrows preview a theme. Enter keeps it, Esc restores the previous one.' },
};

function openPalette(mode, seed) {
  pal = { mode, items: [], sel: 0, restoreTheme: mode === 'theme' ? currentTheme() : null };
  overlay.hidden = false;
  palInput.value = seed !== undefined ? seed : ({ symbol: '@', line: ':', command: '>' }[mode] || '');
  $('#pal-mode').textContent = PAL_MODES[mode].tag;
  $('#pal-hint').textContent = PAL_MODES[mode].hint;
  palInput.focus();
  palInput.setSelectionRange(palInput.value.length, palInput.value.length);
  refreshPalette();
}

function closePalette() {
  overlay.hidden = true;
  if (pal && pal.restoreTheme) setTheme(pal.restoreTheme, false); // dismissed mid-preview
  pal = null;
}
const refreshPalette = debounce(async () => {
  if (!pal) return;
  let raw = palInput.value;
  let mode = pal.mode === 'theme' ? 'theme' : 'file';
  if (mode === 'theme') { /* no prefixes: the query is a theme name */ }
  else if (raw.startsWith('>')) { mode = 'command'; raw = raw.slice(1); }
  else if (raw.startsWith('@')) { mode = 'symbol'; raw = raw.slice(1); }
  else if (raw.startsWith(':')) { mode = 'line'; raw = raw.slice(1); }
  pal.mode = mode;
  $('#pal-mode').textContent = PAL_MODES[mode].tag;
  $('#pal-hint').textContent = PAL_MODES[mode].hint;
  const q = raw.trim();

  if (mode === 'line') {
    const d = doc_();
    const n = parseInt(q, 10);
    pal.items = (d && n > 0) ? [{ kind: 'line', n: Math.min(n, d.total), label: 'Line ' + Math.min(n, d.total), sub: d.path }] : [];
  } else if (mode === 'command') {
    const lq = q.toLowerCase();
    pal.items = COMMANDS.filter(c => c.name.toLowerCase().includes(lq)).map(c => ({ kind: 'cmd', cmd: c, label: c.name, sub: '' }));
  } else if (mode === 'symbol') {
    const d = doc_();
    if (d && !d.outline) { try { d.outline = (await api('/api/outline', { path: d.path })).symbols || []; } catch { d.outline = []; } }
    const lq = q.toLowerCase();
    pal.items = ((d && d.outline) || []).filter(s => !lq || s.name.toLowerCase().includes(lq))
      .slice(0, 400).map(s => ({ kind: 'sym', n: s.line, label: s.name, sub: s.kind, right: String(s.line) }));
  } else if (mode === 'theme') {
    const lq = q.toLowerCase();
    pal.items = listThemes().filter(t => (t.name + ' ' + t.id).toLowerCase().includes(lq))
      .map(t => ({ kind: 'theme', id: t.id, label: t.name, sub: t.scheme, right: t.id === pal.restoreTheme ? 'current' : '' }));
  } else {
    let j;
    try { j = await api('/api/find', { q, limit: 120 }); } catch { return; }
    pal.items = j.results.map(r => {
      const cut = r.path.length - r.name.length;
      return {
        kind: 'file', path: r.path,
        label: fuzzyHTML(r.path.slice(cut), (r.pos || []).filter(p => p >= cut).map(p => p - cut)),
        sub: fuzzyHTML(r.path.slice(0, Math.max(0, cut - 1)), (r.pos || []).filter(p => p < cut)),
        raw: true,
      };
    });
  }
  pal.sel = mode === 'theme' ? Math.max(0, pal.items.findIndex(it => it.id === currentTheme())) : 0;
  drawPalette();
}, 40);

function fuzzyHTML(text, pos) {
  if (!pos || !pos.length) return esc(text);
  const set = new Set(pos);
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit && !open) { out += '<b>'; open = true; }
    if (!hit && open) { out += '</b>'; open = false; }
    out += esc(text[i]);
  }
  return out + (open ? '</b>' : '');
}

function drawPalette() {
  if (!pal) return;
  if (!pal.items.length) { palList.innerHTML = '<div class="pi"><span class="pp">No matches</span></div>'; return; }
  palList.innerHTML = pal.items.map((it, i) =>
    '<div class="pi' + (i === pal.sel ? ' sel' : '') + '" data-i="' + i + '">' +
    '<span class="pn">' + (it.raw ? it.label : esc(it.label)) + '</span>' +
    '<span class="pp">' + (it.raw ? it.sub : esc(it.sub || '')) + '</span>' +
    (it.right ? '<span class="pr">' + esc(it.right) + '</span>' : '') + '</div>').join('');
  const s = palList.children[pal.sel];
  if (s) s.scrollIntoView({ block: 'nearest' });
  if (pal.mode === 'theme') setTheme(pal.items[pal.sel].id, false); // live preview
}

function movePalette(delta) {
  if (!pal || !pal.items.length) return;
  pal.sel = (pal.sel + delta + pal.items.length) % pal.items.length;
  drawPalette();
}

function acceptPalette() {
  if (!pal || !pal.items.length) return;
  const it = pal.items[pal.sel];
  if (it.kind === 'theme') pal.restoreTheme = null;
  closePalette();
  if (it.kind === 'file') openFile(it.path);
  else if (it.kind === 'sym' || it.kind === 'line') {
    const d = doc_(); if (!d) return;
    d.cur = it.n; centerLine(it.n); render(); updateStatus(); pushHistory(d.path, it.n);
  } else if (it.kind === 'cmd') it.cmd.run();
  else if (it.kind === 'theme') setTheme(it.id);
}

function initPalette() {
  palInput.addEventListener('input', refreshPalette);
  palInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); movePalette(1); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); movePalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); acceptPalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'Tab') { e.preventDefault(); movePalette(e.shiftKey ? -1 : 1); }
  });
  palList.addEventListener('click', e => {
    const p = e.target.closest('.pi');
    if (p && p.dataset.i !== undefined) { pal.sel = +p.dataset.i; acceptPalette(); }
  });
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closePalette(); });
}

// --- File: web/src/main.js ---
// web/src/main.js



















// Initialize all subsystems
initRenderer();
initTabs();
initCursor();
initHover();
initSelectionBar();
initTree();
initSearch();
initOutline();
initPanels();
initInspector();
initCalls();
initFind();
initPalette();
initShortcuts();
initMarkdown();
initDiff();
initMetrics();
initStatus();
initStatusFit();

// Bootstrap application lifecycle
(async function boot() {
  try {
    initTheme();

    // Restore word wrap (default ON)
    const wrapPref = localStorage.getItem('px0.wrap');
    S.wrap = wrapPref !== null ? wrapPref === 'true' : true;
    document.body.classList.toggle('word-wrap', S.wrap);

    // Restore line numbers (default ON)
    const linesPref = localStorage.getItem('px0.lineNumbers');
    S.lineNumbers = linesPref !== null ? linesPref === 'true' : true;
    document.body.classList.toggle('hide-lines', !S.lineNumbers);

    // Restore Markdown preview (default ON)
    const mdPref = localStorage.getItem('px0.mdPreview');
    S.mdPreview = mdPref !== null ? mdPref === 'true' : true;

    // Restore HTML preview (default ON)
    const htmlPref = localStorage.getItem('px0.htmlPreview');
    S.htmlPreview = htmlPref !== null ? htmlPref === 'true' : true;

    updateEditorOptionControls();
  } catch {}

  applyKeyLabels();

  measure();
  S.meta = await api('/api/meta');
  if (S.meta.metrics) updateMetricsDisplay(S.meta.metrics);
  if (S.meta.git) { const b = $('#btn-changed'); if (b) b.hidden = false; }
  document.title = S.meta.name + ' - px0';
  $('#root-name').textContent = S.meta.name;
  $('#root-name').title = S.meta.root;
  if (S.meta.version) {
    const emptyVerEl = $('#empty-ver');
    if (emptyVerEl) emptyVerEl.textContent = 'v' + S.meta.version;
  }
  updateStatus();
  await drawTree('', treeEl, 0);

  const params = new URLSearchParams(window.location.search);
  const initialPath = params.get('path');
  const initialLine = parseInt(params.get('line'), 10) || undefined;
  if (initialPath) {
    await openFile(initialPath, { line: initialLine });
    await revealFile(initialPath);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('path');
      u.searchParams.delete('line');
      const cleanSearch = u.searchParams.toString();
      const cleanUrl = u.pathname + (cleanSearch ? '?' + cleanSearch : '') + u.hash;
      window.history.replaceState({}, '', cleanUrl);
    } catch {}
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measure(); layout(); render(); });
  }

  // If the background indexer was still running when the UI loaded, poll briefly
  // until complete to update the total file count and index time in the status bar.
  if (S.meta && !S.meta.ready) {
    const timer = setInterval(async () => {
      try {
        const m = await api('/api/meta');
        if (m.ready) {
          clearInterval(timer);
          S.meta = m;
          updateStatus();
        }
      } catch {
        clearInterval(timer);
      }
    }, 150);
  }
})();

})();
