import { NONE } from './prompt.mjs';

export function decide(verdict, threshold) {
  return verdict.choice !== NONE && verdict.confidence >= threshold ? verdict.choice : NONE;
}

export function score(results) {
  const ok = (r) => r.accepted.includes(r.said);
  const violations = results.filter((r) => r.expected !== NONE);
  const clean = results.filter((r) => r.expected === NONE);
  return {
    caught: violations.filter(ok),
    wrongRule: violations.filter((r) => !ok(r) && r.said !== NONE),
    missed: violations.filter((r) => !ok(r) && r.said === NONE),
    falseAlarms: clean.filter((r) => r.said !== NONE),
    violations,
    clean,
  };
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
