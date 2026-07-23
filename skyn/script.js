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

  /* ---------- Sticky header shadow ---------- */
  const header = document.querySelector('.site-header');
  const onScroll = () => header.setAttribute('data-stuck', String(window.scrollY > 8));
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Mobile menu ---------- */
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');
  toggle?.addEventListener('click', () => {
    const open = nav.getAttribute('data-open') === 'true';
    nav.setAttribute('data-open', String(!open));
    toggle.setAttribute('aria-expanded', String(!open));
  });
  nav?.querySelectorAll('.nav-links a').forEach((a) =>
    a.addEventListener('click', () => nav.setAttribute('data-open', 'false')));

  /* ---------- Upload dropzone ---------- */
  const zone = document.querySelector('.dropzone');
  const input = zone?.querySelector('input');
  const MAX = 25 * 1024 * 1024;
  ['dragenter', 'dragover'].forEach((ev) =>
    zone?.addEventListener(ev, (e) => { e.preventDefault(); zone.setAttribute('data-drag', 'true'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone?.addEventListener(ev, (e) => { e.preventDefault(); zone.removeAttribute('data-drag'); }));
  const handleFile = (f) => {
    if (!f) return;
    const ok = ['image/png', 'image/jpeg'].includes(f.type) && f.size <= MAX;
    showToast(ok ? `Ready to turn into a SKYN: ${f.name}` : 'Please choose a PNG or JPG under 25 MB.');
  };
  input?.addEventListener('change', () => handleFile(input.files?.[0]));
  zone?.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));

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
      if (!isOpen) { row.setAttribute('data-open', ''); btn.setAttribute('aria-expanded', 'true'); }
    });
  });

  /* ---------- Auth / CTA stubs ---------- */
  document.querySelectorAll('.btn--primary').forEach((b) => {
    if (b.closest('.faq-cta') || b.tagName === 'A') return;
    b.addEventListener('click', () => {
      document.querySelector('.dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('Your first outfit is free — drop a design to start.');
    });
  });
  document.querySelector('.btn--ghost')?.addEventListener('click', () => showToast('Log in is coming soon.'));

  /* ---------- Cookie preferences ---------- */
  const cookie = document.getElementById('cookie-panel');
  const KEY = 'skyn-cookie-choice';
  if (!localStorage.getItem(KEY)) setTimeout(() => cookie.classList.add('show'), 700);
  const choose = (v) => { localStorage.setItem(KEY, v); cookie.classList.remove('show'); };
  document.getElementById('accept-cookies').onclick = () => choose('all');
  document.getElementById('reject-cookies').onclick = () => choose('essential');
  document.getElementById('cookie-settings').onclick = () => cookie.classList.add('show');
})();
