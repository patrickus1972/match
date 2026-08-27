# Aramco Rewards — clickable MVP prototype

A working, clickable prototype of the Wave 1 loyalty app. It covers all
twenty-four screens from the Discover / Wave 1 design brief, in the order a
member meets them, and every control on every screen is live — you can walk the
whole journey from sign-up to a redemption code at the till.

## Run it

Open `index.html` in any browser. There is no build step, no server, no
dependencies and no network calls.

```bash
open loyalty-app/index.html          # macOS
xdg-open loyalty-app/index.html      # Linux
```

## What is on screen

| Panel | What it does |
| --- | --- |
| Left rail | The twenty-four-screen index, grouped by section. Click a row to jump straight to that screen with the right state already set up. `←` / `→` step through the list. |
| Centre | The prototype itself, in a phone frame. |
| Right panel | The design intent for the current screen, taken from the brief, plus a hint on what is interactive. Toggle it off with **Notes**. |

**العربية** flips the whole app to Arabic with full RTL. The review panels stay
in English on purpose — they are review chrome, not part of the product.
**Reset** returns the prototype to its starting state.

## The twenty-four screens

**01 · Onboarding and identity** — E1
1. Welcome · 2. Mobile number · 3. OTP · 4. PDPL consent · 5. Biometric
enrolment · 6. Locked state

**02 · Home, relevance and the forecourt** — E5 / E6 / E7
7. Home · 8. Next-best-offer push · 9. Offer detail · 10. Station locator ·
11. Station detail · 12. Authorise the pump

**03 · Paying, earning and attaching** — E3 / E7
13. Fuelling · 14. Receipt · 15. Café order ahead · 16. Pickup · 17. Member QR
sheet · 18. Digital card and wallet pass

**04 · Rewards, account and Arabic** — E2 / E4 / E8
19. Reward catalogue · 20. Reward detail · 21. Redemption code · 22. Account ·
23. Message preferences · 24. Arabic, full RTL

## The happy path, end to end

Join → fill the number (the **demo** key fills a valid one) → any six digits
signs you in → consent → Face ID → unlock → **Pay at pump** → pick a station →
pick a free pump → authorise → the pump runs live → receipt → the 3× nudge →
café order ahead → pickup code → **Rewards** → a reward you can reach →
redemption code. The member QR is one tap away from every screen.

## What is modelled, not mocked

- **Points and tiers.** Every paid stop earns points and counts one qualifying
  visit. Reaching the target promotes the tier (Bronze → Silver at 6 visits,
  Silver → Gold at 8) and the progress bar resets against the new target.
  Tiers move on visits, not spend.
- **Fuelling.** Runs in real time against the selected grade's price per litre.
  Amount, litres and points accrue together; stopping early carries the real
  figures through to the receipt.
- **Redemption.** Redeeming deducts the points there and then and starts a real
  thirty-minute expiry countdown on the code.
- **The catalogue.** Reachable-now items sort to the top; locked ones show the
  gap in points and how many stops it is worth.
- **Consent.** The two required PDPL switches are locked and say so when tapped.
  Marketing is off by default and can be withdrawn from Message preferences.
- **Language.** Every string has an Arabic translation and the layout mirrors
  properly. Numerals and Latin runs stay left-to-right inside the RTL layout.

## The visual system

Taken from the supplied screen designs: Aramco blue for every primary action, a
green-to-cyan brand gradient behind the hero areas, and white cards on a light
ground. Display headings are heavy and uppercase; the in-app ones the design
sets in italic — GOOD MORNING, the member name, SAR totals, MEMBER QR — carry
`.display--i`. Type is Archivo, loaded from Google Fonts with a system fallback,
so the page still renders offline. Tokens live at the top of `styles.css` —
change `--blue`, `--green`, `--cyan` and the three `--grad-*` values and the
whole prototype follows.

### Two SVG rules worth knowing

References that live *inside* a `<symbol>` — gradients, masks — do not resolve
reliably once the symbol is instantiated through `<use>`. Every `<defs>` in the
sprite is therefore hoisted to the root of the sprite `<svg>`, and the two
shapes that need a gradient of their own (the member-QR arch, the points orb)
are inlined at the point of use rather than referenced. The car is drawn without
a mask for the same reason.

## Imagery

Every image is inline SVG, drawn for this prototype, so the file stays
self-contained and makes no network requests:

- **Forecourt photography** — three sites (day, sunset, night), used on the home
  carousel, the locator list and the station header. Landscape compositions, so
  they crop cleanly in both the portrait card slot and the wide header.
- **Member portrait** — an illustrated avatar in the hero, the tier pill and
  Account.
- **The car** — the member's vehicle on the pump-complete screen, matching the
  design's dark green sports car.
- **Street map** — blocks, roads, a park and a route line under the station
  locator, with the pins and the live-pump badge laid over it.
- **The Aramco mark** — a simplified reproduction of the brand square.

Swap any of them for real assets by replacing the matching `<symbol>` in
`index.html`; nothing else needs to change.

## Deliberate placeholders

- **QR codes** are visually representative patterns, not encoded payloads. A
  real build renders the member ID and the redemption token.
- **Photography and the car** are illustrations standing in for real
  photography, and the map is a schematic standing in for supplier tiles.
- **The Aramco mark** is a simplified stand-in for the real brand asset.
- **Earn rates, tier thresholds and reward prices** are Stage 1 placeholders, as
  the brief states — not proposition economics.
- **Wallet passes** confirm rather than call PassKit or the Google Wallet API.
- **The four quick actions** from the brief live in the Menu tab rather than on
  Home, because the supplied home design goes straight from the balance card to
  the station carousel and puts a Menu item in the tab bar.

## Files

```
index.html   all 24 screens, the sheets, the phone shell and the review chrome
styles.css   design tokens and every component
app.js       state, router, the EN/AR dictionary, and the screen renderers
```

Vanilla HTML, CSS and JavaScript throughout — no framework, so any of it can be
lifted straight into a design conversation or handed to a build team as a
reference for behaviour.

## Single-file bundle

`prototype.html` is `index.html`, `styles.css` and `app.js` inlined into one
self-contained file — easier to email, drop into a review folder or open on a
machine that blocks local file requests. Regenerate it after any change:

```bash
sh build.sh
```
