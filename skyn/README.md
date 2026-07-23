# SKYN — Advanced HTML (component-based)

An advanced, fully component-driven HTML build of the SKYN landing-page design.
Everything is built from **native Web Components** (custom elements), styled by a
single shared design-system in `index.html`. All buttons have hover states, the
FAQ is an interactive accordion, and the upload zone reacts to drag & hover.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup + design-system CSS (tokens, layout, component styles) |
| `components.js` | All custom elements + interactions (nav, reveal-on-scroll, accordion, upload) |

Open `index.html` directly in a browser — no build step, no dependencies.

## Components (custom elements)

| Element | Description |
|---------|-------------|
| `<skyn-header>` | Sticky nav, mobile drawer, scroll-shadow |
| `<skyn-button variant icon href size block>` | Button with `primary` / `secondary` / `ghost` / `dark` hover states |
| `<neon-figure variant>` | 3D-character placeholder (SVG mannequin + neon glow) |
| `<skyn-upload>` | Drag-&-drop upload zone with hover / drag states |
| `<brand-strip>` | Platform logo row (hover invert) |
| `<testimonial-card theme quote author>` | Coloured testimonial card |
| `<how-it-works>` | Upload / Generate / Sell steps |
| `<faq-accordion>` | Single-open FAQ using native `<details>` |
| `<price-card step name copy price note swatches>` | Pricing tier + colour swatches |
| `<stat-card icon big desc>` | About-section metric tile |
| `<skyn-footer>` | Footer with link columns |

## Hover / interaction states

- **Buttons** — lift + shadow; primary gets a yellow glow and the arrow icon slides up-right.
- **Nav links** — invert to dark pill on hover.
- **Cards** (testimonial / price / stat) — lift with a deeper shadow; icons rotate slightly.
- **FAQ** — click to expand; opening one closes the others; the `+` rotates into a `–`.
- **Upload** — border turns accent-yellow on hover, scales on drag-over, shows the file name on drop.
- **Swatches** — scale up on hover.
- **Reveal-on-scroll** — sections fade/slide in (respects `prefers-reduced-motion`).

## Swapping in real 3D renders

The characters are stylised SVG placeholders. To use real renders, replace the
markup produced by `<neon-figure>` (and the figure inside `<testimonial-card>`)
with an `<img>` — the component API and layout stay the same.

## Design tokens

All colours, radii, shadows, type and motion live in `:root` at the top of
`index.html` (e.g. `--accent: #e3ff32`). Change them there to re-theme globally.
