/* ============================================================
   SKYN — editor page interactions
   ============================================================ */
(() => {
  'use strict';

  // 13 colourways: [hood, body, sleeveL, sleeveR, pocket, rib, logo]
  const COLOURWAYS = [
    { name: 'Sunrise',  c: ['#b6d61a','#efe3d1','#1f8a7a','#f2a71b','#c6d900','#c6d900','#e6ea0f'] },
    { name: 'Midnight', c: ['#17171b','#17171b','#f2c400','#1f8a7a','#f2c400','#6a3fd0','#f2c400'] },
    { name: 'Olive',    c: ['#4a5320','#e7dcc4','#7d8a3a','#7d8a3a','#7d8a3a','#4a5320','#cbd870'] },
    { name: 'Cobalt',   c: ['#2a6df0','#f3f2f4','#f2a71b','#2a6df0','#f2a71b','#6a3fd0','#2a6df0'] },
    { name: 'Crimson',  c: ['#17171b','#17171b','#d33a2c','#3a7d3a','#d33a2c','#cf6b2a','#8ad06a'] },
    { name: 'Peach',    c: ['#1f7a8a','#f4c9a0','#2a6df0','#f4c9a0','#2a6df0','#f2c400','#1f7a8a'] },
    { name: 'Frost',    c: ['#8ecae6','#f4f6f7','#2a3d66','#8ecae6','#2a3d66','#dfe7ec','#2a3d66'] },
    { name: 'Ember',    c: ['#e4572e','#221b1a','#f2c400','#e4572e','#f2c400','#221b1a','#f2c400'] },
    { name: 'Grape',    c: ['#6a3fd0','#efe7fb','#b6d61a','#6a3fd0','#b6d61a','#3a2170','#b6d61a'] },
    { name: 'Mint',     c: ['#1fd1a4','#f2f7f4','#17171b','#1fd1a4','#17171b','#0f8f6f','#17171b'] },
    { name: 'Slate',    c: ['#3a3f4a','#c9ccd2','#e6ea0f','#3a3f4a','#e6ea0f','#20232a','#e6ea0f'] },
    { name: 'Coral',    c: ['#ff7a8a','#fff0f1','#3a2c66','#ff7a8a','#3a2c66','#ffd23f','#3a2c66'] },
    { name: 'Sand',     c: ['#c9a877','#f3ead9','#5a4a2e','#c9a877','#5a4a2e','#8a6f42','#5a4a2e'] },
  ];
  const KEYS = ['--c-hood','--c-body','--c-sl','--c-sr','--c-pocket','--c-rib','--c-logo'];

  const $ = (s, r = document) => r.querySelector(s);
  const hoodie = $('#hoodie');
  const variantsBox = $('#variants');
  let current = 0;

  const applyColourway = (svgEl, idx) => {
    const cw = COLOURWAYS[idx % COLOURWAYS.length];
    KEYS.forEach((k, i) => svgEl.style.setProperty(k, cw.c[i]));
  };

  // ---- toast ----
  const toast = $('#ed-toast');
  let tTimer;
  const showToast = (msg) => {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(tTimer); tTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  // ---- build variant thumbnails (clone the main hoodie) ----
  const buildVariants = () => {
    variantsBox.innerHTML = '';
    COLOURWAYS.forEach((cw, i) => {
      const btn = document.createElement('button');
      btn.className = 'variant' + (i === current ? ' sel' : '');
      btn.type = 'button';
      btn.title = cw.name;
      const svg = hoodie.cloneNode(true);
      svg.removeAttribute('id');
      svg.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      // keep gradient refs working by scoping ids per-thumb
      applyColourway(svg, i);
      // thumbnails: drop drop-shadow for crispness
      svg.style.filter = 'none';
      btn.appendChild(svg);
      btn.addEventListener('click', () => selectVariant(i));
      variantsBox.appendChild(btn);
    });
  };

  const selectVariant = (i) => {
    current = i;
    applyColourway(hoodie, i);
    [...variantsBox.children].forEach((el, idx) => el.classList.toggle('sel', idx === i));
    showToast(`Colourway: ${COLOURWAYS[i % COLOURWAYS.length].name}`);
  };

  // ---- render modes ----
  const seg = $('#mode-seg');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...seg.children].forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const stage = $('#stage');
    stage.classList.remove('mode-shaded','mode-normal','mode-diffuse','mode-roughness');
    stage.classList.add('mode-' + b.dataset.mode);
  });

  // ---- UV / Wireframe toggles ----
  const stage = $('#stage');
  $('#uv-btn').addEventListener('click', function () {
    this.classList.toggle('on'); stage.classList.toggle('uv-on', this.classList.contains('on'));
  });
  $('#wire-btn').addEventListener('click', function () {
    this.classList.toggle('on'); stage.classList.toggle('wire', this.classList.contains('on'));
  });

  // ---- tokens / cart / generate ----
  const tokenEl = $('#token-count');
  const readTokens = () => parseInt(tokenEl.textContent.replace(/,/g, ''), 10) || 0;
  const writeTokens = (n) => tokenEl.textContent = n.toLocaleString('en-US');

  $('#gen-btn').addEventListener('click', () => {
    const t = readTokens();
    if (t < 10) { showToast('Not enough tokens.'); return; }
    writeTokens(t - 10);
    // add a fresh random-ish colourway by rotating hues of an existing one
    const base = COLOURWAYS[Math.floor((Date.now ? 0 : 0)) % COLOURWAYS.length]; // deterministic-safe
    const idx = COLOURWAYS.length;
    const src = COLOURWAYS[current];
    COLOURWAYS.push({ name: 'Variant ' + (idx + 1), c: src.c.slice().reverse() });
    $('#col-count').textContent = COLOURWAYS.length;
    buildVariants();
    selectVariant(COLOURWAYS.length - 1);
    variantsBox.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('New variant generated · −10 tokens');
  });

  const badge = $('#cart-badge');
  $('#addcart').addEventListener('click', () => {
    badge.textContent = (parseInt(badge.textContent, 10) || 0) + 1;
    showToast(`Added “${COLOURWAYS[current].name} hoodie-pro” to cart`);
  });

  // ---- misc stubs ----
  $('#rename-btn').addEventListener('click', () => showToast('Rename — coming soon.'));
  $('#addproj-btn').addEventListener('click', () => showToast('Add to project — coming soon.'));

  // ---- init ----
  applyColourway(hoodie, 0);
  stage.classList.add('mode-shaded');
  buildVariants();
})();
