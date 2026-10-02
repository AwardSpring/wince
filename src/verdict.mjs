export function parseVerdict(text, choices) {
  const match = String(text).match(/\{[^{}]*\}/);
  if (!match) throw new Error('no JSON object in reply');
  const { choice, confidence } = JSON.parse(match[0]);
  if (!choices.includes(choice)) throw new Error(`choice "${choice}" not in list`);
  const value = Number(confidence);
  if (!Number.isFinite(value)) throw new Error('confidence is not a number');
  return { choice, confidence: Math.min(1, Math.max(0, value)) };
}
