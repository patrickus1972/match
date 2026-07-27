/* ============================================================
   SKYN — My Designs page
   ============================================================ */
(() => {
  'use strict';

  // [hood, body, sleeveL, sleeveR, pocket, rib, logo]
  const DESIGNS = [
    { name: 'Ranger Squad', count: 6, edited: 'edited 2d ago',  paid: 4, c: ['#b6d61a','#efe3d1','#1f8a7a','#f2a71b','#c6d900','#c6d900','#e6ea0f'] },
    { name: 'Y2K Pack',     count: 6, edited: 'edited 1w ago',  paid: 2, c: ['#7a3fe0','#17171b','#1f8a5a','#f2c400','#2f7d8a','#2a6df0','#f2c400'] },
    { name: 'Summer Drop',  count: 6, edited: 'edited 3w ago',  paid: 6, c: ['#4a5320','#efe3d1','#5a6a2a','#b07a3a','#b07a3a','#4a5320','#e0d6b0'] },
    { name: 'Ocean Drive',  count: 6, edited: 'edited 1mo ago', paid: 3, c: ['#2a6df0','#efe3d1','#2e8a4f','#c6d900','#f2942b','#2a6df0','#2a6df0'] },
    { name: 'Neon Rush',    count: 6, edited: 'edited 1mo ago', paid: 6, c: ['#e0342b','#17171b','#8a2420','#7db54a','#5a6a2a','#c9b07a','#f2c400'] },
    { name: 'Cloud Hoodie', count: 6, edited: 'edited 1mo ago', paid: 4, c: ['#ff5da2','#efe3d1','#a05cf0','#a05cf0','#ff5da2','#e0d6b0','#a05cf0'] },
    { name: 'Studio Line',  count: 4, edited: 'edited 2mo ago', paid: 4, c: ['#3b3b3b','#e8e8ec','#6e6e6e','#6e6e6e','#3b3b3b','#20232a','#141414'] },
    { name: 'Retro Wave',   count: 5, edited: 'edited 2mo ago', paid: 5, c: ['#e8552b','#efe6d0','#2a8a6e','#2b5aa8','#e8552b','#2b5aa8','#e8552b'] },
    { name: 'Court Kit',    count: 6, edited: 'edited 3mo ago', paid: 2, c: ['#2a6df0','#f3f2f4','#f2a71b','#2a6df0','#f2a71b','#6a3fd0','#2a6df0'] },
  ];
  const KEYS = ['--c-hood','--c-body','--c-sl','--c-sr','--c-pocket','--c-rib','--c-logo'];

  const $ = (s, r = document) => r.querySelector(s);
  const grid = $('#dz-grid');
  const tpl = $('#hoodie-tpl');
  const CHECK = '<svg viewBox="0 0 24 24"><path d="m5 13 4 4 10-10"/></svg>';

  // ---- toast (reuses .ed-toast styling) ----
  const toast = $('#dz-toast');
  let tTimer;
  const showToast = (msg) => {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(tTimer); tTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  // ---- build cards ----
  const cards = [];
  DESIGNS.forEach((d) => {
    d.status = d.paid >= d.count ? 'paid' : 'notpaid';
    const card = document.createElement('div');
    card.className = 'dz-card';
    card.dataset.name = d.name.toLowerCase();
    card.dataset.status = d.status;

    const check = document.createElement('button');
    check.className = 'dz-check';
    check.type = 'button';
    check.setAttribute('aria-label', 'Select ' + d.name);
    check.innerHTML = CHECK;

    const thumb = document.createElement('div');
    thumb.className = 'dz-thumb';
    const svg = tpl.cloneNode(true);
    svg.removeAttribute('id'); svg.style.display = 'block';
    svg.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    KEYS.forEach((k, i) => svg.style.setProperty(k, d.c[i]));
    thumb.appendChild(svg);

    const head = document.createElement('div');
    head.className = 'dz-cardhead';
    head.innerHTML = '<span class="dz-name">' + d.name + '</span>' +
      '<span class="dz-count">' + d.count + ' designs</span>';
    const meta = document.createElement('p');
    meta.className = 'dz-meta';
    meta.textContent = d.edited + '  ·  ' + d.paid + ' paid';

    card.append(check, thumb, head, meta);
    grid.appendChild(card);
    cards.push(card);

    check.addEventListener('click', (e) => { e.stopPropagation(); card.classList.toggle('sel'); updateSel(); });
    card.addEventListener('click', () => showToast('Opening “' + d.name + '” in the editor…'));
  });

  // ---- selection / bulk bar ----
  const selCount = $('#dz-selcount');
  const bulkBtns = [...document.querySelectorAll('.dz-bulkbtn')];
  const clearBtn = $('#dz-clear');
  const setBulkEnabled = (on) => { bulkBtns.forEach(b => b.disabled = !on); clearBtn.disabled = !on; };
  const updateSel = () => {
    const n = cards.filter(c => c.classList.contains('sel') && !c.hidden).length;
    selCount.textContent = n + ' selected';
    setBulkEnabled(n > 0);
  };
  const clearSel = () => { cards.forEach(c => c.classList.remove('sel')); updateSel(); };

  clearBtn.addEventListener('click', clearSel);
  bulkBtns.forEach(b => b.addEventListener('click', () => {
    const sel = cards.filter(c => c.classList.contains('sel') && !c.hidden);
    if (!sel.length) return;
    const act = b.dataset.act;
    if (act === 'delete') {
      sel.forEach(c => { c.remove(); const i = cards.indexOf(c); if (i > -1) cards.splice(i, 1); });
      updateCount(); showToast('Deleted ' + sel.length + ' design' + (sel.length > 1 ? 's' : ''));
    } else {
      showToast({ move: 'Moved', export: 'Exported', duplicate: 'Duplicated' }[act] + ' ' + sel.length + ' design' + (sel.length > 1 ? 's' : ''));
    }
    updateSel();
  }));

  // ---- filter ----
  const filterBar = $('#dz-filter');
  let filter = 'all';
  const search = $('#dz-searchinput');
  const applyFilters = () => {
    const q = search.value.trim().toLowerCase();
    cards.forEach(c => {
      const okF = filter === 'all' || c.dataset.status === filter;
      const okQ = !q || c.dataset.name.includes(q);
      c.hidden = !(okF && okQ);
    });
    updateSel();
  };
  filterBar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...filterBar.children].forEach(x => x.classList.remove('active'));
    b.classList.add('active'); filter = b.dataset.filter; applyFilters();
  });
  search.addEventListener('input', applyFilters);

  // ---- count badge ----
  const countBadge = $('#dz-count');
  const updateCount = () => { if (countBadge) countBadge.textContent = cards.length + ' designs'; };

  // ---- new design ----
  $('#dz-new').addEventListener('click', () => showToast('New design — opening the editor…'));

  // ---- init ----
  updateCount();
  updateSel();
})();
