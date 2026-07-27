/* ============================================================
   SKYN — top-up / tokens page interactions
   ============================================================ */
(() => {
  'use strict';
  const toast = document.getElementById('tk-toast');
  let tT;
  const showToast = (m) => {
    if (!toast) return;
    toast.textContent = m; toast.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  document.querySelectorAll('.tk-plan').forEach((card) => {
    const buy = card.querySelector('.tk-buy');
    if (!buy) return;
    buy.addEventListener('click', () => {
      const name = card.querySelector('h3')?.textContent || 'pack';
      const amt = card.querySelector('.tk-amount b')?.textContent || '';
      showToast('Adding the ' + name + ' pack (' + amt + ' tokens) to checkout…');
    });
  });

  const apply = document.getElementById('tk-apply');
  const code = document.getElementById('tk-code');
  apply?.addEventListener('click', () => {
    const v = (code?.value || '').trim();
    if (!v) { showToast('Enter a coupon or gift-card code first.'); code?.focus(); return; }
    showToast('Checking code “' + v + '”…');
  });
  code?.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply?.click(); });
})();
