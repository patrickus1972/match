/* ============================================================
   SKYN — legal popup (modal) controller
   ============================================================ */
(() => {
  'use strict';
  const pop = document.getElementById('legal-pop');
  if (!pop) return;
  const menu = document.getElementById('lpop-menu');
  const docView = document.getElementById('lpop-doc');
  const docs = pop.querySelectorAll('#lpop-doc .lg-doc');
  const scroll = pop.querySelector('.lpop-scroll');
  const valid = ['terms', 'privacy', 'cookies', 'settings'];
  let lastFocus = null;

  const showMenu = () => {
    menu.hidden = false; docView.hidden = true;
  };
  const showDoc = (doc) => {
    if (!valid.includes(doc)) doc = 'terms';
    docs.forEach((d) => d.classList.toggle('active', d.id === 'lpop-' + doc));
    menu.hidden = true; docView.hidden = false;
    if (scroll) scroll.scrollTop = 0;
  };
  const openPop = (doc) => {
    lastFocus = document.activeElement;
    pop.hidden = false; pop.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (doc && valid.includes(doc)) showDoc(doc); else showMenu();
  };
  const closePop = () => {
    pop.classList.remove('open'); pop.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  // expose for the combined router / cross-page footer links
  window.__legalPop = openPop;

  // footer triggers anywhere in the document open the menu (the list of docs)
  document.querySelectorAll('[data-legalpop]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openPop('');
    });
  });

  pop.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { showDoc(open.dataset.open); return; }
    if (e.target.closest('[data-back]')) { showMenu(); return; }
    if (e.target.closest('[data-close]')) { closePop(); return; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop.classList.contains('open')) closePop();
  });

  /* ---- cookie settings inside the popup ---- */
  const save = document.getElementById('lp-save');
  const reject = document.getElementById('lp-reject');
  save?.addEventListener('click', () => {
    save.textContent = 'Saved ✓';
    setTimeout(() => { save.textContent = 'Save preferences'; closePop(); }, 700);
  });
  reject?.addEventListener('click', () => {
    const a = document.getElementById('lp-analytics'); const p = document.getElementById('lp-personal');
    if (a) a.checked = false; if (p) p.checked = false;
  });
})();
