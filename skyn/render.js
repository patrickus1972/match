/* ============================================================
   SKYN — render / loading page interactions
   ============================================================ */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);

  const toast = $('#rp-toast');
  let tT;
  const showToast = (m) => {
    if (!toast) return;
    toast.textContent = m; toast.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  /* ---- progress simulation ---- */
  const fill = $('#rp-fill'), pct = $('#rp-pct'), state = $('#rp-state'), step = $('#rp-step'), file = $('#rp-file');
  const scrim = $('#rp-scrim'), scan = $('#rp-scan'), view = document.querySelector('.rp-fact-view');
  const stepFor = (p) => {
    if (p < 20) return { n: 1, l: 'Generating mesh',  f: 'ranger-tee.png' };
    if (p < 40) return { n: 2, l: 'UV unwrap',        f: 'ranger-tee.uv' };
    if (p < 66) return { n: 3, l: 'Baking textures',  f: 'ranger-tee_4k.png' };
    if (p < 88) return { n: 4, l: 'Rigging & weights',f: 'ranger-tee.rig' };
    return { n: 5, l: 'Final polish', f: 'ranger-tee.glb' };
  };
  let p = 58;
  const render = () => {
    fill.style.width = p + '%';
    pct.textContent = p + '%';
    const s = stepFor(p);
    step.textContent = 'Step ' + s.n + ' of 5 · ' + s.l;
    file.textContent = s.f;
    state.textContent = p >= 100 ? 'done' : 'working…';
    /* the fun-fact reveal is driven by the carousel below, not by render progress */
  };
  render();
  const iv = setInterval(() => {
    if (p >= 100) { clearInterval(iv); state.textContent = 'done';
      document.querySelector('.rp-eta-ico')?.classList.add('is-done');
      fill.classList.add('is-done');
      document.querySelector('.rp-dot')?.classList.add('is-done');
      return; }
    p = Math.min(100, p + 1 + Math.floor(Math.random() * 3));
    render();
  }, 1600);

  /* ---- email / signup / footer ---- */
  $('#rp-emailbtn')?.addEventListener('click', () => {
    const v = ($('#rp-email').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { showToast('Enter a valid email address.'); return; }
    showToast('Done — we’ll email you when your skyn is ready.');
  });
  $('#rp-signup')?.addEventListener('click', () => showToast('Creating your free account…'));
  document.querySelector('.rp .footer-cta')?.addEventListener('click', () => showToast('Your first outfit is free — let’s go.'));
})();

/* ---- fun-fact carousel: cross-fade a new fact every 15s, quick reveal per slide ---- */
(() => {
  'use strict';
  const slides = [...document.querySelectorAll('.rp-fact-img')];
  const dots = [...document.querySelectorAll('#rp-dots button')];
  const scrim = document.getElementById('rp-scrim');
  const scan = document.getElementById('rp-scan');
  const view = document.querySelector('.rp-fact-view');
  if (slides.length < 2) return;
  const REVEAL = 3200;   // ms — top-to-bottom reveal, well within the 15s hold
  const HOLD = 15000;    // ms each fun fact stays on screen
  let idx = 0, timer = null;
  const reveal = () => {
    if (!scrim || !scan) return;
    view && view.classList.remove('done');
    scrim.style.transition = scan.style.transition = 'none';
    scrim.style.top = scan.style.top = '0%';
    void scrim.offsetHeight;                       // reflow so the reset applies
    const t = 'top ' + (REVEAL / 1000) + 's var(--ease,ease)';
    scrim.style.transition = scan.style.transition = t;
    scrim.style.top = scan.style.top = '100%';
    setTimeout(() => view && view.classList.add('done'), REVEAL);
  };
  const show = (n) => {
    slides[idx].classList.remove('is-active');
    dots[idx] && dots[idx].classList.remove('is-active');
    idx = (n + slides.length) % slides.length;
    slides[idx].classList.add('is-active');
    dots[idx] && dots[idx].classList.add('is-active');
    reveal();
  };
  const start = () => { timer = setInterval(() => show(idx + 1), HOLD); };
  dots.forEach((d, i) => d.addEventListener('click', () => { show(i); clearInterval(timer); start(); }));
  reveal();   // reveal the first slide on load
  start();
})();
