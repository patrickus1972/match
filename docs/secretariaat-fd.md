# Functioneel ontwerp — Secretariaat-flow Forta Match

**Status:** concept · **Versie:** 0.1 · **Datum:** 2026-05-29
**Auteur:** —
**Reviewers:** —
**Scope:** secretariaat-rol in Forta Match (pilot 1a)

---

## 1. Doel & rol

**Gebruiker:** Secretariaat-medewerker (rol-naam *Maria Boom*).
**Doel:** Een binnengekomen verwijzing zo snel mogelijk koppelen aan het juiste Forta-aanbod óf doorzetten naar een passende vervolgroute, met minimale switching tussen schermen.

**Ontwerpprincipes:**
- Conversationeel-eerst: één lopend chat-paneel als rode draad in plaats van losse pagina's.
- Progressive disclosure: alleen tonen wat nu relevant is; rest onder expandables.
- Eén plek waar de "actieve aanvraag" leeft — geen werklijst meer als landingspagina.

**Niet-doelen:**
- Beheer-functies (label-, tag-, regelbeheer) — vallen onder rol *Applicatiebeheerder*.
- Klinische beoordeling — die ligt bij de rol *Screenteam*.
- Rapportage / KPI-dashboards — buiten scope van pilot 1a.

---

## 2. Hoofdscenario's

### 2.1 Verwijzing aanleveren (binnenkomende brief)
**Trigger:** Verwijzing komt binnen via Zorgdomein, ZIVVER of beveiligde mailbox.

**Stappen:**
1. Welkomstgesprek: agent vraagt *"Wat wil je doen?"*
2. Keuze: **Verwijzing aanleveren**
3. Bron-keuze: **PDF kiezen** óf **Casus typen of inspreken**
4. Tussenvraag: **Volledigheidscheck eerst doen?** (Ja / Nee / Terug)
5. Uitvoeren:
   - PDF: file picker → `POST /api/cases` → pdf-parse → LLM-extractie → check + knock-out
   - Casus: invoerscherm (textarea + opname-knop + optioneel PDF-upload) → `POST /api/cases/intern`
6. Bij Ja-keuze volledigheidscheck: in-chat check-overzicht (zie §3.4) → gebruiker bevestigt *"Doorgaan naar matching"*
7. Match-resultaten verschijnen in de chat (§3.3)
8. Gebruiker kiest een match (Bevestig) of een afwijkende route (Doorsturen / Afwijzen / Nogmaals matchen)

### 2.2 Aanbod verkennen (zoeken zonder concrete aanvraag)
**Trigger:** Vraag van collega ("ik denk dat ik iemand heb…"), externe oriëntatie, prevalidatie van een complexe casus.

**Stappen:**
1. Welkomstgesprek → keuze **Aanbod verkennen**
2. Agent: *"Vertel waar het over gaat — wie is de cliënt, wat is de hulpvraag?"*
3. Vrije invoer: typen óf inspreken (mic-knop, transcriptie via `POST /api/cases/intern/transcribe`)
4. Iedere beurt:
   - `POST /api/explore` draait extractie + matching tegen actieve labels
   - Chat toont aantal labels in scope (met trend ↓↑), tag-chips, en de top-resultaten in dezelfde Forta + Alternatieven stack als de echte matching-flow
   - Agent stelt een gerichte vervolg-dimensie voor (leeftijd / postcode / comorbiditeit / verzekeraar / online-voorkeur)
5. Klik op een resultaat → inline matchoverzicht (beschrijving, locatie, score-breakdown). **Geen vastleg.**
6. Wanneer de gebruiker er een concrete aanvraag van wil maken: **Maak hiervan een aanvraag** → opent het invoerscherm met de tot-dan-toe-tekst vooringevuld, óf PDF-upload-optie
7. Vanaf daar identieke reguliere matching-loop als §2.1

### 2.3 Vervolgacties bij ongeschikt resultaat
- **Doorsturen naar screenteam** — in-chat formulier met reden (verplicht), type onduidelijkheid (chips), urgentie, specifieke uitvraag, contactvoorkeur cliënt. Velden worden samengevoegd tot motivatie en gepost als `outcome: doorzetten_screenteam`.
- **Afwijzen** — motivering opgeven, gepost als `outcome: afwijzen` (terugstuurbrief volgt in vervolgproces).
- **Nogmaals matchen** — `POST /api/cases/:id/match` opnieuw aanroepen (bv. na voorkeur-aanpassing of regel-update).

---

## 3. Functionele componenten

### 3.1 Geleid chat-paneel (`#guidedChat`)
- Header: agent-avatar (Fraunces F-monogram), status-dot, "Opnieuw beginnen" + "Sla over"-knoppen.
- Body: scrollbaar conversatieblok met agent-bubbles, gebruiker-bubbles, keuze-pills en rijke optie-cards.
- Reset-gedrag: bij navigatie weg → terug naar `werklijst` start een nieuwe conversatie (`gcWelcome`).
- Skip-state in `localStorage` (`forta.guidedChat.dismissed`) — gebruiker kan permanent uitzetten.

### 3.2 Invoercomponenten
- **Welkomst-opties** als grote rich-cards (titel + sub + icoon + pijl).
- **Vrije-tekstveld** in chat (auto-resize textarea + Enter-submit) met **microfoon-knop** (timer + pulse-animatie).
- **In-chat formulieren** (bv. screenteam-doorsturen): textarea, chip-groepen, verplichte velden, foutmelding-banner.
- **PDF-upload** via file-picker, óók beschikbaar binnen het intern-modal (intern-modal heeft 3 ingangen: opname, PDF-upload, vrije tekst).

### 3.3 Match-resultaten stack
**Twee gestapelde `<details>`:**
- **Forta locaties (N)** — open by default, alle live Forta-opties (offline + online) gesorteerd op score.
- **Alternatieven (M)** — sociaal-domein opties.

**Per match-card:**
- Rang, label-naam (serif), locatie · online/wachttijd, score-pill.
- *Aanbevolen*-badge op de top-keuze.
- **Selecteer-knop** (primair op top, secundair op rest) — opent inline detail-blok direct onder de card.
- Klik op de hele card heeft hetzelfde gedrag.

**Inline detail-blok:**
- Beschrijving, Locatie & wachttijd (grid: locatie/wachttijd/reistijd/type/code), volledige score-breakdown.
- **Bevestig deze match →** (vastleg + goto `decision`) of **Sluit detail**.

**Buiten behandelkader expandable:**
- Telling van afgevallen opties, lijst met label@locatie + knock-out reden.
- **Afwijzen — terugstuurbrief →** knop.

**Actiebalk eronder:**
Nogmaals matchen (primair) · Doorsturen naar screenteam · Afwijzen · Bekijk check · ← Terug.

### 3.4 Volledigheidscheck-component (in-chat)
**Eén unified card:**
- Status-regel: groen/oranje icoon-dot + serif-titel ("Brief is compleet / niet compleet") + sub-zin.
- **Wat nog mist** (alleen bij incompleet): inline lijst met rode/oranje icoon-pills + label + boodschap.
- **Concept-bericht aan verwijzer** (alleen bij incompleet): collapsible textarea met natuurlijke verzendklare tekst per veld + kopieerknop. Tekst is veldspecifiek en gericht op een verwijzend arts (geen checklist-jargon).
- **Split-paneel** onderaan:
  - Links: brieftekst met highlights (groen = bevestigd uit tekst, geel = neutraal extracted, rood = exclusie-trigger). Pre-wrap CSS, scrollbaar.
  - Rechts: lijst van bevestigde velden (✓ + label + extractie-resultaat).
- Eén achtergrond, hiërarchie via typografie en witruimte — geen geneste banners.

### 3.5 Verkenningsmodus
Hergebruikt §3.3-component met *isExplore*-flag:
- Stub-case (geen `case_id`), `populateMatching` wordt aangeroepen met `c = { id: null }`.
- Selecteer / kaart-klik opent **explore-variant van inline detail**: zelfde info, maar commit-knop is *"Maak hiervan een aanvraag →"* (opent intern-modal in plaats van decision-post).
- Buiten behandelkader expandable wordt niet getoond (geen casus om af te wijzen).
- Bij elke nieuwe input wordt de stack opnieuw gerenderd, oude stack-DOM wordt vervangen.

---

## 4. Statemachine / dialoogtrechter

```
welcome → upload-mode-choice → completeness-pref → process → matches → action
                                              ↳ inline-detail ↳ commit | back
              ↓
explore → input-loop → (results stack each turn) → maak-aanvraag → process → matches → action
```

**Belangrijke transities:**
- Na 1× `goto('werklijst')` wordt de chat geïnitialiseerd door `installGuidedChat()`. Vervolg-bezoeken (bv. via *Nieuwe aanvraag*) starten met `gcWelcome()`.
- `gcShowCaseMatches` ruimt voor render alle restanten op (`.gc-input-area, .chat-options, .gc-explore-cards, .gc-detail-inline, .gc-form, …`) zodat de matching-conversatie schoon start.
- Verkennen → intern-modal: bij upload of submit wordt de chat overgenomen door `gcShowCaseMatches` voor de zojuist gecreëerde case.

---

## 5. Datapunten / API-koppelingen

| Endpoint | Methode | Gebruikt door |
|---|---|---|
| `/api/cases` | POST (multipart of JSON) | PDF-upload + plak-tekst (regulier kanaal) |
| `/api/cases/intern` | POST (JSON) | Casus typen / inspreken |
| `/api/cases/intern/transcribe` | POST (multipart audio) | Mic-knop (chat + intern modal) |
| `/api/cases/:id` | GET | Case-detail (brief, extractie, completeness, knockout, last_match) |
| `/api/cases/:id/match` | POST | Initiële match + *Nogmaals matchen* |
| `/api/cases/:id/decision` | POST | Bevestigen / Doorsturen / Afwijzen |
| `/api/explore` | POST (JSON) | Verkenningsmodus — ephemeral, geen case |
| `/api/labels`, `/api/tags`, `/api/modus` | GET | Configuratie-data (indien in UI zichtbaar) |

**Datamodel-objecten die de UI verwacht:**
- `case`: `{ id, ref_code, channel, raw_text, patient_initials, patient_age, postcode, insurer_name, extraction, completeness, knockout, last_match, decision }`
- `match_option`: `{ label_id, label_code, label_name, label_description, kind, location_id, location_name, is_online, wachttijd_dagen, reisMin, totalScore, breakdown, knockedOut, knockoutReason }`
- `completeness_item`: `{ field, label, status: 'ok'|'warn'|'missing', message }`

---

## 6. Mode-handling

- **MOCK_MODE** (geen Anthropic-key): mock-extractie via regex + default `behandeling`-tag bij klachtprofiel-only input. PDF-uploads zonder verwijsbrief-fraseologie worden vervangen door een realistische mock-brief uit `INTERN_MOCK_TRANSCRIPTS` voor consistente demo-ervaring. Audio-transcriptie geeft een gerandomiseerde mock-brief.
- **LIVE_MODE**: extractie en transcriptie via Anthropic; PDF-content wordt altijd respecteerd.

---

## 7. Edge cases & aandachtspunten

| Situatie | Gedrag |
|---|---|
| Korte verkenningsvraag zonder procedurele intentie | Default `behandeling` toegevoegd zodat Forta-labels niet allemaal knock-outen |
| Geen Forta-opties live (alleen sociaal domein) | Aandacht in chat: agent meldt aantal afgevallen + reden bovenaan Forta-expandable |
| Knock-out gedetecteerd in check | Rode banner-bubble vóór het check-overzicht |
| Lege brief / parse failure | HTTP 400 met *"Geen brieftekst ontvangen (te kort)."* |
| Browser zonder clipboard-API | Concept-mail textarea krijgt `focus + select` als fallback |
| Microfoon-toegang geweigerd | Placeholder-melding in input, gebruiker valt terug op typen |
| Verkenning levert 0 live resultaten | Agent vraagt om exclusie te nuanceren; geen frustrerende lege-staat zonder uitleg |

---

## 8. Niet-functioneel

- **Auto-scroll-strategie:** smooth scrolls in `gcAgent`; bij match-render wordt expliciet géén auto-scroll naar onderen gedaan zodat de eerste kaart in beeld blijft.
- **Animatie:** match-stack soft fade-in (450 ms). Verkenningsdialoog: tag-chips en aantal updaten direct, geen kunstmatige delay.
- **Responsief:** split-panelen stackeren naar één kolom onder 720 px breed.
- **Toegankelijkheid:** semantische `<details>/<summary>`-elementen voor expandables, focusbare buttons, voldoende contrast (WCAG AA op tekst + status-iconen).

---

## 9. Open vragen / vervolgwerk

- Hoe omgaan met meerdere parallelle aanvragen in één sessie? (Nu: één conversatie tegelijk; resetten bij terugkomst op `werklijst`.)
- Audit-trail van conversatie zelf: opslaan ja/nee voor latere reproduceerbaarheid?
- Concept-bericht aan verwijzer — direct mailen of altijd kopiëren + extern mailen?
- Integratie met Zorgdomein-API voor automatische intake (in plaats van handmatige upload)?
- Gedrag bij niet-Forta voorkeursoptie (sociaal domein wint van Forta)? Nu: tonen in eigen expandable; FD-keuze of dat zichtbaar genoeg is.

---

## 10. Wijzigingsgeschiedenis

| Versie | Datum | Wijziging |
|---|---|---|
| 0.1 | 2026-05-29 | Eerste versie op basis van geïmplementeerde pilot 1a-flow |
