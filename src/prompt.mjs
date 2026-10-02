export const NONE = 'none';

export function ruleCheck({ rules, filePath, diff }) {
  const ruleLines = rules.map((r) => `${r.id}: ${r.rule}`).join('\n');
  const question = `Here are a project's coding rules, followed by one code edit.

RULES
${ruleLines}

FILE: ${filePath}
EDIT:
${diff}

Which rule does the ADDED code clearly violate? Judge only lines starting with "+".
If no rule is clearly violated, or you would need code outside this edit to be sure, answer "none".`;
  const descriptions = { [NONE]: 'No rule is clearly violated by the added lines.', ...Object.fromEntries(rules.map((r) => [r.id, r.rule])) };
  return { question, choices: [NONE, ...rules.map((r) => r.id)], descriptions };
}
