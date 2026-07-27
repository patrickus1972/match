/* ============================================================
   SKYN — legal center interactions
   ============================================================ */
(() => {
  'use strict';
  const root = document.getElementById('legal');
  if (!root) return;
  const toast = document.getElementById('lg-toast');
  let tT;
  const showToast = (m) => {
    if (!toast) return;
    toast.textContent = m; toast.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  const items = root.querySelectorAll('.lg-navitem');
  const docs = root.querySelectorAll('.lg-doc');
  const valid = ['terms', 'privacy', 'cookies', 'settings'];

  const open = (doc) => {
    if (!valid.includes(doc)) doc = 'terms';
    items.forEach((b) => b.classList.toggle('active', b.dataset.doc === doc));
    docs.forEach((d) => d.classList.toggle('active', d.id === 'doc-' + doc));
    root.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  // expose for the combined-build router / cross-page footer links
  window.__legalOpen = open;

  root.querySelectorAll('[data-doc]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      open(el.dataset.doc);
    });
  });

  // deep link via hash (#privacy) on standalone
  const h = (location.hash || '').replace('#', '');
  if (valid.includes(h)) open(h);

  /* ---- cookie settings ---- */
  document.getElementById('ck-save')?.addEventListener('click', () => {
    const a = document.getElementById('ck-analytics')?.checked;
    const p = document.getElementById('ck-personal')?.checked;
    const on = ['Essential'].concat(a ? ['Analytics'] : []).concat(p ? ['Personalization'] : []);
    showToast('Preferences saved — ' + on.join(', ') + ' cookies active.');
  });
  document.getElementById('ck-reject')?.addEventListener('click', () => {
    const a = document.getElementById('ck-analytics'); const p = document.getElementById('ck-personal');
    if (a) a.checked = false; if (p) p.checked = false;
    showToast('Optional cookies turned off — essential only.');
  });
})();
