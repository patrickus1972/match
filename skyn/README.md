# SKYN — pixel-perfect landing page

The approved page renders (`assets/section-1..3.png`) are the visual
foundation, so typography, gradients, avatars and card styling stay exactly
on-design. Interactive layers are positioned on top and **scale with the
image at every viewport**.

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080/skyn/
```

No build step, no dependencies.

## How it works

Each section is a `container-type: inline-size` positioning context holding its
render as a full-width `<img>`. Interactive elements sit on top:

- **Position** is set in `%` of the image → stays aligned when the image scales.
- **Size / type** inside overlays use **container-query units (`cqw`)** → every
  hotspot, the whole FAQ, its icons and text scale proportionally with the
  image. The layout is pixel-perfect at 1116px *and* at 400px.

Coordinates were measured from the renders themselves (canvas colour sampling of
the yellow buttons and FAQ icon column), so buttons and hotspots line up to the
pixel.

## Interactive layers

| Element | Behaviour |
|---------|-----------|
| Nav links / logo / login | Transparent hotspots with a soft hover highlight |
| **Sign up / Browse / Contact / Footer** buttons | Real yellow pills over the render; hover inverts to black-on-yellow, lifts, arrow nudges |
| Upload dropzone | Whole card is a file input; validates PNG/JPG ≤ 25 MB and confirms with a toast |
| **FAQ** | Fully rebuilt accordion that covers the render's FAQ column seamlessly (matched background, pill fill, icon tiles). Single-open; `+` becomes `−` |
| Footer | Real HTML footer with link columns + first-outfit CTA |
| Cookie panel | Remembers the choice in `localStorage` |

## Why this replaces the earlier hand-built version

The first attempt rebuilt the characters as SVG placeholders — it looked
nothing like the design. This version keeps the real 3D renders (impossible to
reproduce in code) and only rebuilds the parts that genuinely need to be
interactive, matched so precisely that the seam is invisible.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Section markup + interactive FAQ |
| `styles.css` | Design tokens, `cqw`-scaled overlays, on-brand hovers |
| `script.js` | Upload validation, FAQ accordion, cookie preferences |
| `assets/section-*.png` | Approved page renders (1 = hero, 2 = FAQ/pricing, 3 = about, 4 = thumbnail) |

## Swapping to a fully-fluid rebuild

When production-ready character assets with transparency are available, each
section can graduate from “render + overlay” to native HTML/CSS. The overlay
components (buttons, FAQ, footer) already are native and carry straight over.
