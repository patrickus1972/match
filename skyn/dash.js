/* ============================================================
   SKYN — recognised homepage ("pick up where you left off")
   ============================================================ */
(() => {
  'use strict';

  const toast = document.getElementById('db-toast');
  let tT;
  const showToast = (m) => {
    if (!toast) return;
    toast.textContent = m; toast.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  document.getElementById('db-start')?.addEventListener('click', () => {
    /* in the combined build the router intercepts [data-nav]; standalone falls back */
    if (document.querySelector('#pgsw')) return;
    showToast('Opening a new design…');
    setTimeout(() => { window.location.href = 'page2.html'; }, 650);
  });

  document.getElementById('db-switch')?.addEventListener('click', (e) => {
    e.preventDefault();
    showToast('Switching account…');
  });
})();
