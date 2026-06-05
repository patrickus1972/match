// Feedback agent — conversational dialogue across 4 categories from the FO:
//   1. Adviesfeedback (advies juist/onjuist + richting)
//   2. Tagfeedback (tag missing/incorrect)
//   3. Labelfeedback (gekozen label vs top-N + reden)
//   4. Algemene systeemfeedback
import { MOCK_MODE, anthropic, MODEL } from './client.js';

const SYSTEM = `Je bent de Forta Match feedback-agent. Doel: in een korte, natuurlijke dialoog de medewerker
helpen feedback te geven over één specifiek matching-advies. Stel ÉÉN vraag tegelijk, kort, geen lange uitleg.
Doorloop de 4 categorieën in deze volgorde:
  1. Adviesfeedback (klopt het advies?)
  2. Tagfeedback (klopt de tag-set links?)
  3. Labelfeedback (klopt de gekozen optie t.o.v. top-N?)
  4. Algemene systeemfeedback (iets structureel beter?)
Gebruik 3-4 antwoordsuggesties per vraag, plus altijd een vrije-tekst optie impliciet (zeg "of typ zelf").
Sluit af met een korte bevestiging dat de feedback naar de applicatiebeheerder gaat.`;

const STARTER = {
  agent: "Hoi — heb je een minuutje? Ik wil graag even doorlopen wat je van het advies vond. Eerst de hoofdvraag: vond je het AI-advies in deze case juist?",
  options: ['Ja, juist', 'Twijfel — niet helemaal', 'Nee, ik koos anders'],
  step: 0
};

// Agent works step by step. We keep state on the client; server is stateless per turn.
// Each turn: client sends transcript so far + latest user reply -> server returns next agent message + options.
export async function feedbackTurn({ caseContext, transcript }) {
  if (transcript.length === 0) return STARTER;
  if (MOCK_MODE) return mockTurn(transcript);

  const messages = transcript.map(t => ({
    role: t.role === 'agent' ? 'assistant' : 'user',
    content: t.content
  }));
  // Make sure last is from user
  const ctx = `Context van de case:\n${JSON.stringify(caseContext, null, 2)}`;
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM + '\n\n' + ctx,
    tools: [{
      name: 'next_message',
      description: 'Next agent message + suggested replies. options=[] when conversation should end.',
      input_schema: {
        type: 'object',
        properties: {
          agent:   { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          step:    { type: 'integer', description: '0..3 = current FO category index; 4 = closing.' },
          done:    { type: 'boolean' }
        },
        required: ['agent','options','step','done']
      }
    }],
    tool_choice: { type: 'tool', name: 'next_message' },
    messages
  });
  const block = resp.content.find(b => b.type === 'tool_use');
  if (!block) return mockTurn(transcript);
  return block.input;
}

function mockTurn(transcript) {
  const userTurns = transcript.filter(t => t.role === 'user').length;
  const flow = [
    { agent: 'Helder. En de geëxtraheerde tags links — heeft Match volgens jou de juiste signalen uit de brief gehaald?',
      options: ['Klopt — niets aan te merken','Eén tag ontbreekt','Eén tag stond er onterecht'], step: 1, done: false },
    { agent: 'Goed om te weten. Klopt de gekozen optie t.o.v. de top-N, of had een andere optie beter gepast?',
      options: ['Top-keuze klopt','Tweede optie had beter gepast','Iets anders'], step: 2, done: false },
    { agent: 'Tot slot — zie je iets aan het systeem dat structureel beter kan?',
      options: ['Nee, alles oké','Ja, ik typ het zelf','Later misschien'], step: 3, done: false },
    { agent: 'Bedankt — alles vastgelegd. Dit gaat naar de applicatiebeheerder. Tot de volgende!',
      options: [], step: 4, done: true }
  ];
  return flow[Math.min(userTurns - 1, flow.length - 1)] || flow[flow.length - 1];
}

export async function summarizeFeedback({ caseContext, transcript }) {
  if (MOCK_MODE || transcript.length < 2) {
    return { advies_oordeel: 'onbekend', tag_oordeel: 'onbekend', label_oordeel: 'onbekend', systeem_observatie: '' };
  }
  const tool = {
    name: 'summarize_feedback',
    description: 'Vat de feedback samen in 4 categorieën.',
    input_schema: {
      type: 'object',
      properties: {
        advies_oordeel:    { type: 'string', enum: ['juist','te_streng','te_soepel','onbekend'] },
        tag_oordeel:       { type: 'string', enum: ['correct','tag_mist','tag_onterecht','onbekend'] },
        label_oordeel:     { type: 'string', enum: ['top_correct','andere_beter','onbekend'] },
        systeem_observatie:{ type: 'string' }
      },
      required: ['advies_oordeel','tag_oordeel','label_oordeel','systeem_observatie']
    }
  };
  const resp = await anthropic.messages.create({
    model: MODEL, max_tokens: 400,
    system: 'Je vat een feedback-gesprek bondig samen.',
    tools: [tool], tool_choice: { type: 'tool', name: 'summarize_feedback' },
    messages: [{ role: 'user', content: `Context: ${JSON.stringify(caseContext)}\nGesprek:\n${transcript.map(t => `${t.role}: ${t.content}`).join('\n')}` }]
  });
  const block = resp.content.find(b => b.type === 'tool_use');
  return block?.input ?? { advies_oordeel: 'onbekend', tag_oordeel: 'onbekend', label_oordeel: 'onbekend', systeem_observatie: '' };
}
