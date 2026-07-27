/* ============================================================
   SKYN — editor page interactions
   ============================================================ */
(() => {
  'use strict';

  // way = [hood, body, sleeveL, sleeveR, pocket, rib, logo]
  const W = (name, c) => ({ name, c });
  const THEMES = [
    { name: 'Theme 1', ways: [
      W('Sunrise',  ['#b6d61a','#efe3d1','#1f8a7a','#f2a71b','#c6d900','#c6d900','#e6ea0f']),
      W('Midnight', ['#17171b','#17171b','#f2c400','#1f8a7a','#f2c400','#6a3fd0','#f2c400']),
      W('Olive',    ['#4a5320','#e7dcc4','#7d8a3a','#7d8a3a','#7d8a3a','#4a5320','#cbd870']),
      W('Cobalt',   ['#2a6df0','#f3f2f4','#f2a71b','#2a6df0','#f2a71b','#6a3fd0','#2a6df0']),
      W('Crimson',  ['#17171b','#17171b','#d33a2c','#3a7d3a','#d33a2c','#cf6b2a','#8ad06a']),
      W('Peach',    ['#1f7a8a','#f4c9a0','#2a6df0','#f4c9a0','#2a6df0','#f2c400','#1f7a8a']),
    ] },
    { name: 'Theme 2', ways: [
      W('Frost',  ['#8ecae6','#f4f6f7','#2a3d66','#8ecae6','#2a3d66','#dfe7ec','#2a3d66']),
      W('Mint',   ['#1fd1a4','#f2f7f4','#17171b','#1fd1a4','#17171b','#0f8f6f','#17171b']),
      W('Coral',  ['#ff7a8a','#fff0f1','#3a2c66','#ff7a8a','#3a2c66','#ffd23f','#3a2c66']),
      W('Lilac',  ['#b6a0e6','#f5f1fb','#6a3fd0','#b6a0e6','#6a3fd0','#e3d9f5','#6a3fd0']),
      W('Sand',   ['#c9a877','#f3ead9','#5a4a2e','#c9a877','#5a4a2e','#8a6f42','#5a4a2e']),
      W('Sky',    ['#7ec8ff','#eef7ff','#f2a71b','#7ec8ff','#f2a71b','#2a6df0','#2a6df0']),
    ] },
    { name: 'Theme 3', ways: [
      W('Ember',  ['#e4572e','#221b1a','#f2c400','#e4572e','#f2c400','#221b1a','#f2c400']),
      W('Grape',  ['#6a3fd0','#efe7fb','#b6d61a','#6a3fd0','#b6d61a','#3a2170','#b6d61a']),
      W('Slate',  ['#3a3f4a','#c9ccd2','#e6ea0f','#3a3f4a','#e6ea0f','#20232a','#e6ea0f']),
      W('Neon',   ['#141414','#141414','#39ff14','#ff2fd0','#39ff14','#ff2fd0','#39ff14']),
      W('Racing', ['#0a5c2e','#f0f0f0','#e4572e','#0a5c2e','#e4572e','#141414','#e4572e']),
      W('Sunset', ['#ff6b35','#ffe8d6','#6a3fd0','#ff6b35','#6a3fd0','#ffd23f','#6a3fd0']),
    ] },
  ];
  const KEYS = ['--c-hood','--c-body','--c-sl','--c-sr','--c-pocket','--c-rib','--c-logo'];

  const $ = (s, r = document) => r.querySelector(s);
  const hoodie = $('#hoodie');
  const themesBox = $('#themes');
  let current = { t: 0, i: 0 };

  const applyWay = (svgEl, way) => KEYS.forEach((k, i) => svgEl.style.setProperty(k, way.c[i]));

  const FOLDER = '<svg class="folder" viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z"/></svg>';
  const CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';

  // ---- toast ----
  const toast = $('#ed-toast');
  let tTimer;
  const showToast = (msg) => {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(tTimer); tTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  const updateTotal = () => {
    const el = $('#col-total');
    if (el) el.textContent = THEMES.reduce((n, t) => n + t.ways.length, 0);
  };

  // ---- build accordion ----
  const buildThemes = () => {
    updateTotal();
    themesBox.innerHTML = '';
    THEMES.forEach((theme, ti) => {
      const sec = document.createElement('div');
      sec.className = 'theme' + (ti === current.t ? ' open' : '');

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'theme-head';
      head.innerHTML = '<span class="theme-name">' + theme.name + '</span>' +
        '<span class="theme-count">' + theme.ways.length + '</span>' + CHEV;
      head.addEventListener('click', () => {
        const wasOpen = sec.classList.contains('open');
        themesBox.querySelectorAll('.theme').forEach(s => s.classList.remove('open'));
        if (!wasOpen) sec.classList.add('open');
      });

      const body = document.createElement('div');
      body.className = 'theme-body';
      const grid = document.createElement('div');
      grid.className = 'variants';

      theme.ways.forEach((way, wi) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'variant' + (ti === current.t && wi === current.i ? ' sel' : '');
        btn.title = way.name;
        const svg = hoodie.cloneNode(true);
        svg.removeAttribute('id');
        svg.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
        applyWay(svg, way);
        svg.style.filter = 'none';
        btn.appendChild(svg);
        btn.addEventListener('click', () => selectWay(ti, wi));
        grid.appendChild(btn);
      });

      body.appendChild(grid);
      sec.appendChild(head);
      sec.appendChild(body);
      themesBox.appendChild(sec);
    });
  };

  const selectWay = (ti, wi) => {
    current = { t: ti, i: wi };
    const way = THEMES[ti].ways[wi];
    applyWay(hoodie, way);
    themesBox.querySelectorAll('.variant').forEach(el => el.classList.remove('sel'));
    const secs = themesBox.querySelectorAll('.theme');
    if (secs[ti]) {
      const vs = secs[ti].querySelectorAll('.variant');
      if (vs[wi]) vs[wi].classList.add('sel');
    }
    showToast(`${THEMES[ti].name} · ${way.name}`);
  };

  // ---- render modes ----
  const seg = $('#mode-seg');
  const stage = $('#stage');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...seg.children].forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    stage.classList.remove('mode-shaded','mode-normal','mode-diffuse','mode-roughness');
    stage.classList.add('mode-' + b.dataset.mode);
  });
  $('#uv-btn').addEventListener('click', function () {
    this.classList.toggle('on'); stage.classList.toggle('uv-on', this.classList.contains('on'));
  });
  $('#wire-btn').addEventListener('click', function () {
    this.classList.toggle('on'); stage.classList.toggle('wire', this.classList.contains('on'));
  });

  // ---- tokens / generate ----
  const tokenEl = $('#token-count');
  const readTokens = () => parseInt(tokenEl.textContent.replace(/,/g, ''), 10) || 0;
  const writeTokens = (n) => tokenEl.textContent = n.toLocaleString('en-US');

  // ---- "Add colours" palette modal (opens from Generate more variants) ----
  const PALETTES = [
    { name: 'Monochrome', c: ['#141414','#3b3b3b','#6e6e6e','#a9a9a9','#f0f0f0'] },
    { name: 'Pastel',     c: ['#c7d4f2','#d9c2f0','#f4c2d7','#d6d6db','#f2dd7a'] },
    { name: 'Vibrant',    c: ['#e5352b','#f2942b','#f2e13d','#4caf50','#3f7ff0'] },
    { name: 'Earth',      c: ['#4a3323','#6e4a2a','#4a5330','#3f4a2a','#c2a678'] },
    { name: 'Neon',       c: ['#d6f23d','#f2a02b','#f2611f','#f22ba8','#a02bf2'] },
    { name: 'Ocean',      c: ['#0a3d62','#1f7a8c','#2ec4b6','#8ecae6','#cdeeff'] },
    { name: 'Sunset',     c: ['#2a1a4a','#7a2b8a','#e0457b','#f2792b','#f2c94c'] },
    { name: 'Berry',      c: ['#3a0d2e','#7a1b56','#b83280','#e06fae','#f4b8dd'] },
    { name: 'Forest',     c: ['#14261a','#26492f','#3f7d4f','#7db584','#cfe6d0'] },
    { name: 'Candy',      c: ['#ff5da2','#ff8fb1','#ffd23f','#5ad1e6','#8a5cf0'] },
    { name: 'Mono Warm',  c: ['#2a201a','#4a3a2e','#7a6450','#b09a82','#efe4d4'] },
    { name: 'Jewel',      c: ['#0d3b3b','#8a1c4a','#3a2b8a','#1f8a5a','#c9a227'] },
    { name: 'Ice',        c: ['#2a3d5a','#5a7aa8','#9ec4e6','#cfe4f5','#eef7ff'] },
    { name: 'Retro',      c: ['#e8552b','#f2b53d','#2a8a6e','#2b5aa8','#efe6d0'] },
    { name: 'Grape Soda', c: ['#2a0d4a','#6a2bb0','#a05cf0','#d6a8ff','#efe0ff'] },
  ];
  const modal = $('#palette-modal');
  const pmList = $('#pm-list');
  const pmRender = $('#pm-render');
  let selPal = -1;
  $('#pm-count').textContent = PALETTES.length;

  const rot = (a, n) => a.slice(n).concat(a.slice(0, n));
  // turn a 5-colour palette into 5 hoodie colourways
  const paletteToWays = (pal) => pal.c.map((_, i) => {
    const r = rot(pal.c, i);
    return W(pal.name + ' ' + (i + 1), [r[0], r[4], r[1], r[2], r[3], r[1], r[3]]);
  });

  const buildPalettes = () => {
    pmList.innerHTML = '';
    PALETTES.forEach((pal, pi) => {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'pm-item';
      const sw = pal.c.map(c => '<span style="background:' + c + '"></span>').join('');
      it.innerHTML = '<div class="pm-item-head"><span class="pm-name">' + pal.name +
        '</span><span class="pm-meta">' + pal.c.length + ' colours</span>' +
        '<span class="pm-select">+ Select</span></div>' +
        '<div class="pm-swatches">' + sw + '</div>';
      it.addEventListener('click', () => selectPalette(pi));
      pmList.appendChild(it);
    });
  };
  const selectPalette = (pi) => {
    selPal = pi;
    [...pmList.children].forEach((el, i) => el.classList.toggle('selected', i === pi));
    pmRender.disabled = false;
    pmRender.textContent = 'Render ' + PALETTES[pi].name;
  };
  const openModal = () => {
    selPal = -1;
    pmRender.disabled = true;
    pmRender.textContent = 'Select a palette to render';
    [...pmList.children].forEach(el => el.classList.remove('selected'));
    modal.hidden = false;
  };
  const closeModal = () => { modal.hidden = true; };

  $('#gen-btn').addEventListener('click', openModal);
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  pmRender.addEventListener('click', () => {
    if (selPal < 0) return;
    const t = readTokens();
    if (t < 10) { showToast('Not enough tokens.'); return; }
    writeTokens(t - 10);
    const pal = PALETTES[selPal];
    THEMES.push({ name: pal.name, ways: paletteToWays(pal) });
    current = { t: THEMES.length - 1, i: 0 };
    buildThemes();
    selectWay(current.t, 0);
    themesBox.querySelectorAll('.theme')[current.t]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    closeModal();
    showToast('Added ' + pal.name + ' palette (' + pal.c.length + ' colours) · −10 tokens');
  });

  buildPalettes();

  // ---- cart ----
  const badge = $('#cart-badge');
  $('#addcart').addEventListener('click', () => {
    badge.textContent = (parseInt(badge.textContent, 10) || 0) + 1;
    showToast(`Added “${THEMES[current.t].ways[current.i].name} hoodie-pro” to cart`);
  });

  // ---- stubs ----
  $('#rename-btn').addEventListener('click', () => showToast('Rename — coming soon.'));
  $('#addproj-btn').addEventListener('click', () => showToast('Add to project — coming soon.'));

  // ---- init ----
  applyWay(hoodie, THEMES[0].ways[0]);
  stage.classList.add('mode-shaded');
  buildThemes();
})();
