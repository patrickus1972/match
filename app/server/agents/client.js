import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const apiKey = process.env.ANTHROPIC_API_KEY;
export const MOCK_MODE = !apiKey;
export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

export const anthropic = MOCK_MODE ? null : new Anthropic({ apiKey });

if (MOCK_MODE) {
  console.warn('[forta-match] ANTHROPIC_API_KEY not set — running agents in MOCK mode.');
}

// Helper: enforce JSON tool-use response. Returns the parsed input of the named tool.
export async function runStructured({ system, user, tool, maxTokens = 1500 }) {
  if (MOCK_MODE) throw new Error('runStructured() called while in MOCK mode');
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: user }]
  });
  const block = resp.content.find(b => b.type === 'tool_use' && b.name === tool.name);
  if (!block) throw new Error('LLM did not return tool_use for ' + tool.name);
  return block.input;
}
