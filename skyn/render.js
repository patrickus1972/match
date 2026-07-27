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
    /* reveal the left render preview from the top down to the frontier */
    if (scrim) scrim.style.top = p + '%';
    if (scan) scan.style.top = p + '%';
    if (view) view.classList.toggle('done', p >= 100);
  };
  render();
  const iv = setInterval(() => {
    if (p >= 100) { clearInterval(iv); state.textContent = 'done'; return; }
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
