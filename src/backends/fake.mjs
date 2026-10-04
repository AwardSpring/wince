// Test double, selected with WINCE_BACKEND=fake. WINCE_FAKE picks the
// behavior: throw / hang / garbage, or choice ids separated by commas; the
// first one offered by the question is returned, otherwise the first id.
export const name = 'fake';

export function available() {
  return true;
}

export async function classify(question, choices, { env = process.env } = {}) {
  const behavior = env.WINCE_FAKE ?? 'none';
  if (behavior === 'throw') throw new Error('fake backend failure');
  if (behavior === 'hang') return new Promise(() => {});
  if (behavior === 'garbage') return { choice: 'not-a-choice', confidence: 'very' };
  const wanted = behavior.split(',');
  const choice = wanted.find((c) => choices.includes(c)) ?? wanted[0];
  return { choice, confidence: Number(env.WINCE_FAKE_CONFIDENCE ?? 0.95) };
}
