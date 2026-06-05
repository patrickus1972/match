// Knockout agent — checks the 3 hard knockouts from the FO:
//   1. diagnostiek vs behandeling — onverenigbaar
//   2. buiten behandelkader (forensisch / primair somatisch / leeftijd buiten bereik)
//   3. acute suïcidaliteit (notify, no auto-knockout)
import { MOCK_MODE, runStructured } from './client.js';
import { db } from '../db/index.js';

function tagsFromExtraction(extraction) {
  return new Set((extraction.tags || []).map(t => t.name));
}

export async function runKnockoutScan(extraction) {
  const tags = tagsFromExtraction(extraction);

  // 1. Diagnostiek vs behandeling — wanneer cliënt diagnostiek vraagt maar Forta heeft géén actief diagnostiek-label dat raakt aan klachtprofiel
  const wantsDiagnostiek = tags.has('diagnostiek');
  const wantsBehandeling = tags.has('behandeling');
  let diagMismatch = false;
  if (wantsDiagnostiek && !wantsBehandeling) {
    const klachtTags = [...tags].filter(t => ['ADHD','autisme','angst','depressie','trauma','persoonlijkheidsproblematiek','eetstoornis'].includes(t));
    if (klachtTags.length > 0) {
      const placeholders = klachtTags.map(()=>'?').join(',');
      const row = db.prepare(`
        SELECT COUNT(*) AS n
        FROM labels l
        JOIN label_tags lt ON lt.label_id = l.id AND lt.role = 'incl_required'
        JOIN tags t ON t.id = lt.tag_id
        WHERE l.status = 'actief' AND l.treatment_form IN ('diagnostiek','beide')
          AND t.name IN (${placeholders})
      `).get(...klachtTags);
      diagMismatch = (row?.n ?? 0) === 0;
    }
  }
  if (diagMismatch) {
    return { triggered: true, criterion: 'diagnostiek_vs_behandeling',
             reasoning: 'Cliënt vraagt diagnostiek maar Forta heeft geen actief diagnostiek-label dat past bij dit klachtprofiel.' };
  }

  // 2. Buiten behandelkader
  if (tags.has('forensisch')) return { triggered: true, criterion: 'buiten_kader', reasoning: 'Forensisch profiel — Forta biedt geen forensische zorg.' };
  if (tags.has('primair somatisch')) return { triggered: true, criterion: 'buiten_kader', reasoning: 'Hoofdklacht is primair somatisch zonder GGZ-component.' };
  const age = extraction.patient_age || 0;
  if (age > 0 && age < 18) return { triggered: true, criterion: 'buiten_kader', reasoning: `Leeftijd ${age} valt buiten Forta volwassenen-aanbod.` };

  // 3. Acute suïcidaliteit — notify, geen automatische knockout
  if (tags.has('acute suïcidaliteit')) {
    return { triggered: false, criterion: 'acute_suicidaliteit_signaal',
             reasoning: 'Acute suïcidaliteit gedetecteerd — secretariaat dient direct te beoordelen of doorgang gepast is.' };
  }

  // No knockout — optionally double-check via LLM if available
  if (!MOCK_MODE && extraction.hulpvraag) {
    try {
      const llmCheck = await llmKnockoutDoubleCheck(extraction);
      if (llmCheck?.triggered) return llmCheck;
    } catch { /* swallow */ }
  }

  return { triggered: false, criterion: null, reasoning: 'Geen knock-out gedetecteerd.' };
}

async function llmKnockoutDoubleCheck(extraction) {
  const tool = {
    name: 'knockout_check',
    description: 'Decide if any hard knockout applies based on the extracted information.',
    input_schema: {
      type: 'object',
      properties: {
        triggered:  { type: 'boolean' },
        criterion:  { type: 'string', enum: ['diagnostiek_vs_behandeling','buiten_kader','acute_suicidaliteit_signaal',''] },
        reasoning:  { type: 'string' }
      },
      required: ['triggered','reasoning']
    }
  };
  const user = `Extractie:\n${JSON.stringify(extraction, null, 2)}\n\nForta volwassen-GGZ. Knockout alleen bij: forensisch profiel, primair somatisch, leeftijd<18, of geen passend label voor diagnostiekvraag. Acute suïcidaliteit is signaal (geen automatische knockout).`;
  const out = await runStructured({
    system: 'Je beoordeelt strikt en conservatief of een hard knock-out criterium van Forta Match van toepassing is.',
    user, tool, maxTokens: 400
  });
  if (!out.criterion) out.criterion = null;
  return out;
}
