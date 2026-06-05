# Forta Match — werkende prototype

AI-ondersteund verwijsbrief-matching prototype, gebouwd op basis van het FO `match-version_01.docx`.

## Snel starten

```bash
cd /Users/Patrick_Van_Der_Vlie/Downloads/match/app
npm install   # eenmalig
npm start
# open http://localhost:3000
```

De seed-database wordt automatisch aangemaakt bij de eerste start. Wil je een schone reset?

```bash
npm run reset
```

## Met of zonder Anthropic API key

- **Zonder key (mock-modus, default).** Het systeem werkt end-to-end: regex-fallback voor extractie, deterministische volledigheidscheck, scripted feedback-agent. Goed genoeg om de flow door te lopen.
- **Met key (live-modus).** Kopieer `.env.example` → `.env`, vul `ANTHROPIC_API_KEY=...` in, herstart. Extractie en feedback-dialoog draaien dan op Claude (default `claude-sonnet-4-6`).

```bash
cp .env.example .env
# vul ANTHROPIC_API_KEY in
npm start
```

## Wat zit erin

| Onderdeel | FO-paragraaf | Implementatie |
|---|---|---|
| Volledigheidscheck | 3.2 | `server/agents/completeness.js` + handboek-checklist |
| Knock-out scan | 3.2 | `server/agents/knockout.js` (3 criteria + LLM double-check) |
| Tag-extractie | 3.3 | `server/agents/extraction.js` (LLM tool-use → JSON) |
| Rules engine | 3.3.4 | `server/rules.js` (5 dimensies + Forta-voorkeur) |
| Feedback-agent | 4.4 | `server/agents/feedback.js` (4 categorieën, 1 vraag tegelijk) |
| Beheermodule | 5.2 | API CRUD voor labels, tags, modus, voorkeuren; UI-pages bedraadt aan API |
| Audit-log | 1.3 | iedere mutatie naar `audit_log` tabel |

## API kort

- `POST /api/cases` — upload (PDF/text) → extractie + check + knock-out
- `POST /api/cases/:id/match` — rules engine, met optionele `modus`
- `POST /api/cases/:id/decision` — secretariaat/screenteam beslissing
- `POST /api/cases/:id/feedback/turn` — volgende beurt feedback-agent
- `POST /api/cases/:id/feedback/save` — sessie afsluiten + samenvatting
- `GET/POST/PUT /api/labels`, `/api/tags`, `/api/modus`, `/api/voorkeuren`
- `GET /api/audit`, `GET /api/dashboard`

## Beperkingen (pilot 1a)

- Geen authenticatie/rollen — frontend role-switcher is nog visueel.
- Geen Medicore/Kompas-koppeling (uit scope conform FO §1.4).
- Wachttijd is statisch geseed; geen automatische sync met planning.
- Forta-voorkeur max 90 dagen wordt server-side afgedwongen, maar zonder UI-edit (alleen DELETE).
- `pdf-parse` haalt platte tekst uit PDFs; ingewikkelde scans vergen OCR.

## Mappenstructuur

```
app/
├── server/
│   ├── index.js          # Express server + alle routes
│   ├── rules.js          # rules engine
│   ├── agents/
│   │   ├── client.js     # Anthropic SDK wrapper + mock toggle
│   │   ├── extraction.js
│   │   ├── completeness.js
│   │   ├── knockout.js
│   │   └── feedback.js
│   └── db/
│       ├── schema.sql
│       ├── index.js
│       └── seed.js
├── public/
│   ├── index.html        # bestaande demo, met IDs voor dynamische rendering
│   └── app.js            # frontend glue laag (vervangt fake scripts)
└── data/                 # SQLite db + uploads (gitignored)
```
