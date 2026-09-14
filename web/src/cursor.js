// web/src/cursor.js
import { $, S, doc_, MOD, LH, api } from './state.js';
import { vp, rowsEl } from './ui.js';
import { paint, render, rowFor, placeCaret } from './renderer.js';
import { updateStatus } from './status.js';
import { gotoDefinition } from './lsp.js';
import { pushHistory } from './history.js';
import { openFile } from './tabs.js';

export const WORD = /[A-Za-z0-9_$]/;

/* Returns {word, line, col} where col counts UTF-16 units from the start of the
   line, which is both what JS string indexes give us and what the server needs
   to place an LSP request. Walking text nodes keeps this correct even after
   find or occurrence marks have wrapped parts of the line. */
export function wordAtPoint(x, y) {
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
export function pathAtPoint(x, y) {
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
export function colAtPoint(x, y) {
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
export function moveCol(delta) {
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

export function caretToEdge(end) {
  const d = doc_(); if (!d) return;
  d.col = end ? Infinity : 0;
  revealCaretX(placeCaret());
}

export function moveCursor(delta) {
  const d = doc_(); if (!d) return;
  d.cur = Math.max(1, Math.min(d.total, d.cur + delta));
  const y = (d.cur - 1) * LH;
  if (y < vp.scrollTop) vp.scrollTop = y - LH;
  else if (y > vp.scrollTop + vp.clientHeight - LH * 2) vp.scrollTop = y - vp.clientHeight + LH * 3;
  render(); updateStatus();
}

export function initCursor() {
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
