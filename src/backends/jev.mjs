export const name = 'jev';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export function endpoint(env = process.env) {
  return env.FLINCH_JEV_URL || ENDPOINT;
}

export function apiKey(env = process.env) {
  return env.CLAUDE_PLUGIN_OPTION_JEV_API_KEY || env.TYPESAFE_API_KEY || env.JEV_API_KEY || '';
}

export function available(env = process.env) {
  return Boolean(apiKey(env));
}

export function buildRequest(question, choices, { descriptions = {}, model = 'jev-latest' } = {}) {
  return {
    model,
    state: question,
    questions: {
      verdict: {
        type: 'choice',
        instructions: 'Answer the question at the end of the text. Pick exactly one option.',
        criteria: Object.fromEntries(choices.map((c) => [c, descriptions[c] ?? c])),
      },
    },
  };
}

export function readAnswer(body, choices) {
  const answer = body?.answers?.verdict;
  if (!answer || !choices.includes(answer.choice)) throw new Error('jev returned no usable choice');
  const p = answer.probabilities?.[answer.choice] ?? answer.confidence;
  const confidence = Number(p);
  if (!Number.isFinite(confidence)) throw new Error('jev returned no confidence');
  return { choice: answer.choice, confidence, probabilities: answer.probabilities };
}

export async function classify(question, choices, { timeoutMs = 1500, env = process.env, ...opts } = {}) {
  const res = await fetch(endpoint(env), {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey(env)}` },
    body: JSON.stringify(buildRequest(question, choices, opts)),
  });
  if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return readAnswer(await res.json(), choices);
}
