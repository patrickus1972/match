/* ============================================================
   SKYN — quality-check step interactions
   ============================================================ */
(() => {
  'use strict';
  const agree = document.getElementById('qc-agree');
  const btn = document.getElementById('qc-continue');
  const toast = document.getElementById('qc-toast');
  if (!agree || !btn) return;

  let tT;
  const showToast = (m) => {
    if (!toast) return;
    toast.textContent = m; toast.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => toast.classList.remove('show'), 2400);
  };

  const sync = () => {
    btn.classList.toggle('on', agree.checked);
    btn.disabled = !agree.checked;
  };
  agree.addEventListener('change', sync);
  sync();

  btn.addEventListener('click', () => {
    if (!agree.checked) return;
    /* in the combined build the router intercepts [data-nav]; standalone falls back */
    if (document.querySelector('#pgsw')) return;
    showToast('Looks great — starting your render…');
    window.location.href = 'page4.html';
  });
})();
