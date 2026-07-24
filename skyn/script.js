/* ============================================================
   SKYN — interactions
   ============================================================ */
(() => {
  'use strict';

  const toast = document.getElementById('toast');
  let toastTimer;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  };

  /* ---------- Upload dropzone ---------- */
  const upload = document.querySelector('.upload-zone input');
  const MAX = 25 * 1024 * 1024;
  upload?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ok = ['image/png', 'image/jpeg'].includes(f.type) && f.size <= MAX;
    showToast(ok
      ? `Ready to turn into a SKYN: ${f.name}`
      : 'Please choose a PNG or JPG under 25 MB.');
  });

  /* ---------- FAQ accordion (single open) ---------- */
  const rows = [...document.querySelectorAll('.faq-row')];
  rows.forEach((row) => {
    const btn = row.querySelector('.faq-q');
    btn.addEventListener('click', () => {
      const isOpen = row.hasAttribute('data-open');
      rows.forEach((r) => {
        r.removeAttribute('data-open');
        r.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        row.setAttribute('data-open', '');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Friendly stubs for auth CTAs ---------- */
  document.querySelector('.signup-btn')?.addEventListener('click', () => {
    document.querySelector('.upload-zone')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Your first outfit is free — drop a design to start.');
  });
  document.querySelector('.footer-cta')?.addEventListener('click', () => {
    document.querySelector('.upload-zone')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.querySelector('.login-hit')?.addEventListener('click', () => showToast('Log in is coming soon.'));

  /* ---------- Demo video player (reveals after 4s) ---------- */
  const videoDemo = document.getElementById('video-demo');
  if (videoDemo) {
    setTimeout(() => videoDemo.classList.add('show'), 4000);
    videoDemo.querySelector('.vd-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      videoDemo.classList.remove('show');
    });
    videoDemo.querySelector('.vd-frame')?.addEventListener('click', () => showToast('Demo video coming soon.'));
  }

  /* ---------- Cookie preferences ---------- */
  const cookie = document.getElementById('cookie-panel');
  const KEY = 'skyn-cookie-choice';
  if (!localStorage.getItem(KEY)) setTimeout(() => cookie.classList.add('show'), 700);
  const choose = (v) => { localStorage.setItem(KEY, v); cookie.classList.remove('show'); };
  document.getElementById('accept-cookies').onclick = () => choose('all');
  document.getElementById('reject-cookies').onclick = () => choose('essential');
  document.getElementById('cookie-settings').onclick = () => cookie.classList.add('show');
})();
