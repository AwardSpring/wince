import { rulesFor } from '../rules.mjs';
import { ruleCheck, NONE } from '../prompt.mjs';
import { EDIT_TOOLS, editToDiff, projectPath, capDiff } from '../edits.mjs';
import { decide } from '../score.mjs';
import { validVerdict } from '../verdict.mjs';
import { fileKind } from '../log.mjs';

export async function checkRules({ input, rules, threshold, backend, timeoutMs }) {
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const filePath = projectPath(input.tool_input?.file_path, input.cwd);
  const applicable = rulesFor(filePath, rules);
  if (applicable.length === 0) return null;

  const diff = capDiff(editToDiff(input.tool_name, input.tool_input ?? {}));
  const { question, choices, descriptions } = ruleCheck({ rules: applicable, filePath, diff });
  const verdict = await backend.classify(question, choices, { timeoutMs, descriptions });
  const trace = { check: 'rules', kind: fileKind(filePath), rules: applicable.length };
  if (!validVerdict(verdict, choices)) return { trace: { ...trace, outcome: 'unusable' } };

  trace.choice = verdict.choice;
  trace.confidence = verdict.confidence;
  const said = decide(verdict, threshold);
  if (said === NONE) return { trace: { ...trace, outcome: 'quiet' } };
  const rule = applicable.find((r) => r.id === said);
  return {
    trace: { ...trace, outcome: 'flagged' },
    finding: { check: 'rules', id: said, message: `Flinch: this edit to ${filePath} may break "${rule.id}": ${rule.rule}` },
  };
}
