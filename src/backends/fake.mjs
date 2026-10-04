// Test double, selected with WINCE_BACKEND=fake. WINCE_FAKE picks the
// behavior: a choice id to return it, or throw / hang / garbage.
export const name = 'fake';

export function available() {
  return true;
}

export async function classify(question, choices, { env = process.env } = {}) {
  const behavior = env.WINCE_FAKE ?? 'none';
  if (behavior === 'throw') throw new Error('fake backend failure');
  if (behavior === 'hang') return new Promise(() => {});
  if (behavior === 'garbage') return { choice: 'not-a-choice', confidence: 'very' };
  return { choice: behavior, confidence: Number(env.WINCE_FAKE_CONFIDENCE ?? 0.95) };
}
