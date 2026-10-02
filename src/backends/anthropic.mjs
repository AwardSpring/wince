import { parseVerdict } from '../verdict.mjs';

const SYSTEM = 'You answer one multiple-choice question. Reply with only a JSON object {"choice": string, "confidence": number}. choice must be exactly one of the listed choices. confidence is 0 to 1. Write nothing else.';

export const name = 'anthropic';

export function available(env = process.env) {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export async function classify(question, choices, { timeoutMs = 3000, model = 'claude-haiku-4-5', env = process.env } = {}) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      system: SYSTEM,
      messages: [{ role: 'user', content: `${question}\n\nCHOICES: ${choices.join(', ')}` }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const body = await res.json();
  const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseVerdict(text, choices);
}
