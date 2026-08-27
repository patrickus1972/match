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

## Deliberate placeholders

- **QR codes** are visually representative patterns, not encoded payloads. A
  real build renders the member ID and the redemption token.
- **Map tiles** are a supplier slot, drawn as a schematic. Pins, the selected
  state and the list below it are real.
- **Photography** is a slot on the welcome screen and the card art.
- **Earn rates, tier thresholds and reward prices** are Stage 1 placeholders, as
  the brief states — not proposition economics.
- **Wallet passes** confirm rather than call PassKit or the Google Wallet API.

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
