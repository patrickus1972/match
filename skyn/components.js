/* ============================================================
   SKYN — Web Components
   Every visual block is a custom element. Components render into
   the light DOM so the shared design-system CSS applies globally.
   ============================================================ */
(() => {
  'use strict';

  /* ---------- tiny helpers ---------- */
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content;
  };
  const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- icon set (feather-ish) ---------- */
  const ICONS = {
    arrow:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
    upload:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M12 3v13"/><path d="m7 8 5-5 5 5"/></svg>',
    cube:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 21V13"/></svg>',
    tag:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13.3 13.3 20a1.6 1.6 0 0 1-2.3 0L3 12V3h9l8 8a1.6 1.6 0 0 1 0 2.3Z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
    shirt:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 5 5 3 9l3 2v10h12V11l3-2-2-4-4-2a3 3 0 0 1-6 0Z"/></svg>',
    badge:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="m8.5 14-2 7 5.5-3 5.5 3-2-7"/></svg>',
    help:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.8 2.8 0 0 1 5.4.9c0 1.9-2.8 2.4-2.8 4"/><path d="M12 17h.01"/></svg>',
    file:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>',
    gamepad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4"/><circle cx="16" cy="10" r="0.6" fill="currentColor"/><circle cx="18" cy="12" r="0.6" fill="currentColor"/><path d="M17.5 5H6.5a4.5 4.5 0 0 0-4.4 3.6L1 15.4A2.4 2.4 0 0 0 5.6 17l1-2h10.8l1 2a2.4 2.4 0 0 0 4.6-1.6l-1.1-6.8A4.5 4.5 0 0 0 17.5 5Z"/></svg>',
    user:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    shield:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
    layers:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
    menu:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  };

  /* ============================================================
     <skyn-button>  — primary / secondary / ghost / dark, with hover
     attrs: variant, href, icon, size, block, label
     ============================================================ */
  class SkynButton extends HTMLElement {
    connectedCallback() {
      const variant = this.getAttribute('variant') || 'primary';
      const href = this.getAttribute('href');
      const icon = this.getAttribute('icon');
      const size = this.getAttribute('size');
      const block = this.hasAttribute('block');
      const label = this.getAttribute('label') || this.textContent.trim() || 'Button';
      const cls = ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm', block && 'btn--block']
        .filter(Boolean).join(' ');
      const inner = `<span class="btn__label">${esc(label)}</span>` +
        (icon && ICONS[icon] ? `<span class="btn__icon">${ICONS[icon]}</span>` : '');
      const tag = href ? 'a' : 'button';
      const attr = href ? ` href="${esc(href)}"` : ' type="button"';
      this.replaceChildren(h(`<${tag} class="${cls}"${attr}>${inner}</${tag}>`));
    }
  }

  /* ============================================================
     <skyn-header> — sticky nav with mobile drawer
     ============================================================ */
  class SkynHeader extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <header class="site-header">
          <div class="shell">
            <nav class="nav" aria-label="Primary">
              <a class="brand" href="#top" aria-label="SKYN home"><b>SKYN</b></a>
              <ul class="nav__links">
                <li><a href="#how-it-works">How it works</a></li>
                <li><a href="#faq">FAQ</a></li>
                <li><a href="#about">About</a></li>
              </ul>
              <div class="nav__actions">
                <skyn-button variant="ghost" href="#" label="Log in"></skyn-button>
                <skyn-button variant="primary" href="#" label="Sign up" icon="arrow"></skyn-button>
                <button class="nav__toggle" aria-label="Open menu" aria-expanded="false">${ICONS.menu}</button>
              </div>
            </nav>
          </div>
        </header>`;

      const header = this.querySelector('.site-header');
      const nav = this.querySelector('.nav');
      const toggle = this.querySelector('.nav__toggle');

      toggle.addEventListener('click', () => {
        const open = nav.getAttribute('data-open') === 'true';
        nav.setAttribute('data-open', String(!open));
        toggle.setAttribute('aria-expanded', String(!open));
      });
      this.querySelectorAll('.nav__links a').forEach((a) =>
        a.addEventListener('click', () => nav.setAttribute('data-open', 'false')));

      const onScroll = () => header.setAttribute('data-stuck', String(window.scrollY > 8));
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  /* ============================================================
     <neon-figure> — stylised 3D-character placeholder + neon glow
     Swap the <svg> for a real render later; API stays the same.
     attrs: variant (hero-blue | faq-rainbow | about-pink)
     ============================================================ */
  const MANNEQUIN = (accent) => `
    <svg class="mannequin" viewBox="0 0 240 460" role="img" aria-label="3D character">
      <defs>
        <linearGradient id="body-${accent.id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset="1" stop-color="#d8d6dd"/>
        </linearGradient>
      </defs>
      <g fill="url(#body-${accent.id})" stroke="#c7c5cd" stroke-width="1">
        <!-- head -->
        <circle cx="120" cy="52" r="30"/>
        <!-- glasses -->
        <rect x="98" y="44" width="44" height="12" rx="4" fill="#1a1a1f" stroke="none"/>
        <!-- torso / hoodie -->
        <path d="M78 92 q42 -16 84 0 l10 96 q-52 16 -104 0 Z"/>
        <!-- arms -->
        <path d="M78 96 q-22 40 -18 96 l16 4 q6 -52 20 -84 Z"/>
        <path d="M162 96 q22 40 18 96 l-16 4 q-6 -52 -20 -84 Z"/>
        <!-- legs -->
        <path d="M92 186 q28 8 56 0 l-4 150 -20 2 -6 -120 -6 120 -20 -2 Z" fill="${accent.legs}"/>
        <!-- shoes -->
        <path d="M100 336 h26 l4 20 q-18 8 -34 0 Z" fill="#ffffff" stroke="#c7c5cd"/>
        <path d="M138 336 h26 q2 14 0 20 q-18 8 -30 0 Z" fill="#ffffff" stroke="#c7c5cd"/>
      </g>
    </svg>`;

  let glowSeq = 0;
  const GLOW = (colors, core = 'rgba(255,255,255,.95)') => {
    const id = `soft-${glowSeq++}`;
    return `
    <svg class="figure__glow" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="8"/>
        </filter>
      </defs>
      <g filter="url(#${id})" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="90,470 300,120 510,470" stroke="${colors[0]}" stroke-width="14" opacity=".85"/>
        <polyline points="150,470 300,210 450,470" stroke="${colors[1]}" stroke-width="9" opacity=".7"/>
      </g>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="90,470 300,120 510,470" stroke="${core}" stroke-width="2.5" opacity=".9"/>
      </g>
    </svg>`;
  };

  const FIGURE_VARIANTS = {
    'hero-blue':    { accent: { id: 'b', legs: '#1f43d8' }, glow: ['#ffffff', '#dfefff'] },
    'faq-rainbow':  { accent: { id: 'r', legs: '#e6e4ea' }, glow: ['#ff2d9b', '#8a2be2'] },
    'about-pink':   { accent: { id: 'p', legs: '#e6e4ea' }, glow: ['#ff3fb0', '#ff8ad4'] },
  };

  class NeonFigure extends HTMLElement {
    connectedCallback() {
      const v = FIGURE_VARIANTS[this.getAttribute('variant')] || FIGURE_VARIANTS['hero-blue'];
      this.innerHTML = `<div class="figure">${GLOW(v.glow)}${MANNEQUIN(v.accent)}</div>`;
    }
  }

  /* ============================================================
     <skyn-upload> — drag & drop zone with drag / hover states
     ============================================================ */
  class SkynUpload extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <div class="dropzone" role="button" tabindex="0" aria-label="Upload your 2D design">
          <div class="dropzone__title">Drop your 2D design here</div>
          <div class="dropzone__hint">PNG or JPG · up to 25&nbsp;MB</div>
          <skyn-button variant="primary" label="Browse files" icon="upload"></skyn-button>
          <input type="file" accept="image/png,image/jpeg" hidden>
        </div>`;
      const zone = this.querySelector('.dropzone');
      const input = this.querySelector('input');
      const open = () => input.click();

      zone.addEventListener('click', open);
      zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      ['dragenter', 'dragover'].forEach((ev) =>
        zone.addEventListener(ev, (e) => { e.preventDefault(); zone.setAttribute('data-drag', 'true'); }));
      ['dragleave', 'drop'].forEach((ev) =>
        zone.addEventListener(ev, (e) => { e.preventDefault(); zone.removeAttribute('data-drag'); }));
      const show = (name) => {
        if (!name) return;
        zone.querySelector('.dropzone__title').textContent = name;
        zone.querySelector('.dropzone__hint').textContent = 'Ready to turn into a SKYN';
      };
      zone.addEventListener('drop', (e) => show(e.dataTransfer?.files?.[0]?.name));
      input.addEventListener('change', () => show(input.files?.[0]?.name));
    }
  }

  /* ============================================================
     <brand-strip> — platform logos with hover
     ============================================================ */
  class BrandStrip extends HTMLElement {
    connectedCallback() {
      const brands = ['ROBLOX', 'The Sims', 'FORTNITE', 'MINECRAFT', 'VRCHAT', 'ZEPETO'];
      this.innerHTML = `<div class="brands__row">${
        brands.map((b) => `<span class="brand-logo">${esc(b)}</span>`).join('')
      }</div>`;
    }
  }

  /* ============================================================
     <testimonial-card> — coloured card, figure, quote
     attrs: theme (pink|dark|purple), quote, author
     ============================================================ */
  class TestimonialCard extends HTMLElement {
    connectedCallback() {
      const theme = this.getAttribute('theme') || 'pink';
      const glow = { pink: ['#ffd0ec', '#ff5db1'], dark: ['#ffd8b0', '#ff7a3c'], purple: ['#e6c8ff', '#b15cff'] }[theme];
      this.innerHTML = `
        <article class="tcard tcard--${theme}">
          <p class="tcard__quote">“${esc(this.getAttribute('quote') || '')}”</p>
          <p class="tcard__author">— ${esc(this.getAttribute('author') || '')}</p>
          <div class="tcard__figure">${GLOW(glow)}${MANNEQUIN({ id: theme, legs: '#efeef2' })}</div>
        </article>`;
    }
  }

  /* ============================================================
     <how-it-works> — steps list (upload / generate / sell)
     ============================================================ */
  class HowItWorks extends HTMLElement {
    connectedCallback() {
      const steps = [
        { no: '01', name: 'Upload', ico: 'upload', desc: "Drop in the 2D garment art you've already drawn." },
        { no: '02', name: 'Generate', ico: 'cube', desc: 'SKYN builds a high-res, game-ready 3D SKYN.' },
        { no: '03', name: 'Sell', ico: 'tag', desc: "Export the file and list it on Roblox — it's yours to sell." },
      ];
      this.innerHTML = `
        <div class="how">
          <h3 class="how__title">How it works</h3>
          ${steps.map((s) => `
            <div class="step">
              <div class="step__badge">${ICONS[s.ico]}</div>
              <div>
                <div class="step__no">${s.no}</div>
                <div class="step__name">${s.name}</div>
                <div class="step__desc">${esc(s.desc)}</div>
              </div>
            </div>`).join('')}
        </div>`;
    }
  }

  /* ============================================================
     <faq-accordion> — native <details> items + contact CTA
     ============================================================ */
  class FaqAccordion extends HTMLElement {
    connectedCallback() {
      const items = [
        { ico: 'help',    q: 'What is SKYN?',                    a: 'SKYN turns your 2D garment art into a production-ready 3D wearable you can use in games and virtual worlds.' },
        { ico: 'shirt',   q: 'What kind of files can I upload?', a: 'PNG or JPG artwork up to 25 MB. Clean, high-contrast designs give the best results.' },
        { ico: 'gamepad', q: 'How does the 3D generation work?', a: 'We map your artwork onto a game-ready garment base, then refine geometry and materials for real-time engines.' },
        { ico: 'user',    q: 'Can I use SKYN for free?',         a: 'Your first outfit is free — no install required. After that, a full outfit is a flat $10.' },
        { ico: 'tag',     q: 'Can I sell what I create with SKYN?', a: 'Yes. You own the exported file and can list it on platforms like Roblox and keep the revenue.' },
        { ico: 'shield',  q: 'Is my design data safe?',          a: 'Your uploads stay private and are only used to generate your SKYN. You keep full ownership.' },
        { ico: 'layers',  q: 'What platforms are supported?',    a: 'Roblox, The Sims, Fortnite, Minecraft, VRChat, Zepeto and any engine that accepts standard 3D formats.' },
        { ico: 'cube',    q: 'Do I need 3D modeling skills?',    a: 'None at all. If you can draw or design in 2D, SKYN handles the entire 3D pipeline for you.' },
        { ico: 'help',    q: 'What if I run into an issue?',     a: 'Our support team is one click away and happy to help you get your SKYN game-ready.' },
      ];
      this.innerHTML = `
        <div class="faq__list">
          ${items.map((it, i) => `
            <details class="faq-item"${i === 0 ? ' open' : ''}>
              <summary class="faq-item__q">
                <span class="faq-item__ico">${ICONS[it.ico]}</span>
                <span>${esc(it.q)}</span>
                <span class="faq-item__plus" aria-hidden="true"></span>
              </summary>
              <div class="faq-item__a">${esc(it.a)}</div>
            </details>`).join('')}

          <div class="faq-cta">
            <div class="faq-cta__body">
              <span class="faq-cta__ico">${ICONS.help}</span>
              <div>
                <strong>Still have questions?</strong>
                <span>We're here to help.</span>
              </div>
            </div>
            <skyn-button variant="primary" label="Contact support" icon="arrow"></skyn-button>
          </div>
        </div>`;

      /* single-open accordion behaviour */
      const all = [...this.querySelectorAll('.faq-item')];
      all.forEach((d) => d.addEventListener('toggle', () => {
        if (d.open) all.forEach((o) => { if (o !== d) o.open = false; });
      }));
    }
  }

  /* ============================================================
     <price-card> — pricing tier, optional colour swatches
     ============================================================ */
  class PriceCard extends HTMLElement {
    connectedCallback() {
      const swatches = this.hasAttribute('swatches');
      const colors = ['#e3ff32', '#3b6dff', '#8a2be2', '#ff6a2b', '#ff3fb0', '#22d3c5', '#111014'];
      this.innerHTML = `
        <article class="price-card">
          <span class="price-card__step">${esc(this.getAttribute('step') || '')}</span>
          <h3 class="price-card__name">${esc(this.getAttribute('name') || '')}</h3>
          <p class="lede" style="font-size:.92rem">${esc(this.getAttribute('copy') || '')}</p>
          <div class="price-card__figure">${GLOW(['#c9a3ff', '#8a2be2'])}
            <svg viewBox="0 0 120 90" width="120" height="90" aria-hidden="true">
              <path d="M30 20 q30 -12 60 0 l8 46 q-38 12 -76 0Z" fill="#1a1a1f"/>
              <path d="M30 20 l-8 20 12 6 6 -14Z" fill="#8a2be2"/>
              <path d="M90 20 l8 20 -12 6 -6 -14Z" fill="#e3ff32"/>
              <path d="M34 52 h52 l4 14 q-30 10 -60 0Z" fill="#2b6cff"/>
            </svg>
          </div>
          <div class="price-tag">${esc(this.getAttribute('price') || '')}<small>${esc(this.getAttribute('note') || '')}</small></div>
          ${swatches ? `<div class="swatches">${colors.map((c) =>
            `<span class="swatch" style="background:${c}" title="${c}"></span>`).join('')}</div>` : ''}
        </article>`;
    }
  }

  /* ============================================================
     <stat-card> — about-section metric tile
     attrs: icon, big (\n for line break), desc
     ============================================================ */
  class StatCard extends HTMLElement {
    connectedCallback() {
      const icon = this.getAttribute('icon') || 'cube';
      const big = (this.getAttribute('big') || '').replace(/\n/g, '<br>');
      this.innerHTML = `
        <div class="stat-card">
          <div class="stat-card__ico">${ICONS[icon] || ICONS.cube}</div>
          <div class="stat-card__big">${big}</div>
          <div class="stat-card__desc">${esc(this.getAttribute('desc') || '')}</div>
        </div>`;
    }
  }

  /* ============================================================
     <skyn-footer>
     ============================================================ */
  class SkynFooter extends HTMLElement {
    connectedCallback() {
      const cols = [
        { h: 'Product', links: ['How it works', 'Pricing', 'FAQ', 'Platforms'] },
        { h: 'Company', links: ['About', 'Creators', 'Careers', 'Press'] },
        { h: 'Legal', links: ['Privacy', 'Terms', 'Licenses'] },
      ];
      this.innerHTML = `
        <footer class="site-footer">
          <div class="shell footer">
            <div class="footer__grid">
              <div class="footer__brand">
                <a class="brand" href="#top"><b>SKYN</b></a>
                <p>Turn the 2D art you already draw into a game-ready 3D wearable — you own the file.</p>
                <div style="margin-top:16px"><skyn-button variant="dark" label="Get your first outfit free" icon="arrow"></skyn-button></div>
              </div>
              ${cols.map((c) => `
                <div>
                  <h4>${c.h}</h4>
                  <ul>${c.links.map((l) => `<li><a href="#">${esc(l)}</a></li>`).join('')}</ul>
                </div>`).join('')}
            </div>
            <div class="footer__bar">
              <span>© ${new Date().getFullYear()} SKYN. All rights reserved.</span>
              <span>Made for the people who play.</span>
            </div>
          </div>
        </footer>`;
    }
  }

  /* ---------- register everything ---------- */
  customElements.define('skyn-button', SkynButton);
  customElements.define('skyn-header', SkynHeader);
  customElements.define('neon-figure', NeonFigure);
  customElements.define('skyn-upload', SkynUpload);
  customElements.define('brand-strip', BrandStrip);
  customElements.define('testimonial-card', TestimonialCard);
  customElements.define('how-it-works', HowItWorks);
  customElements.define('faq-accordion', FaqAccordion);
  customElements.define('price-card', PriceCard);
  customElements.define('stat-card', StatCard);
  customElements.define('skyn-footer', SkynFooter);

  /* ---------- reveal-on-scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  const observeReveals = () => document.querySelectorAll('[data-reveal]:not(.is-in)').forEach((el) => io.observe(el));
  document.addEventListener('DOMContentLoaded', observeReveals);
  observeReveals();
})();
