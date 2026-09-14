// web/src/panels.js
import { $, $$, S, api } from './state.js';
import { layout, render } from './renderer.js';
import { updateStatus } from './status.js';
import { loadOutline } from './outline.js';
import { treeEl, openDirs, drawTree } from './tree.js';

export function showPanel(name) {
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

export function initPanels() {
  $('#btn-show-search')?.addEventListener('click', () => showPanel('search'));
  $('#btn-show-files')?.addEventListener('click', () => showPanel('files'));

  $('#btn-reindex').addEventListener('click', async () => {
    $('#st-index').textContent = 'reindexing…';
    const j = await api('/api/reindex');
    S.meta.files = j.files; S.meta.indexMs = j.indexMs;
    treeEl.innerHTML = ''; openDirs.clear();
    await drawTree('', treeEl, 0);
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
