import { currentTurn, toolCalls } from '../transcript.mjs';
import { EDIT_TOOLS, capDiff } from '../edits.mjs';
import { rulesFor } from '../rules.mjs';
import { ruleCheck, NONE } from '../prompt.mjs';
import { decide } from '../score.mjs';
import { validVerdict } from '../verdict.mjs';
import { fileKind } from '../log.mjs';
import { candidateRoots, changedSince, fileDiff, sameFile } from '../sweep.mjs';

export const MAX_FILES = 8;
const CLOCK_SLACK_MS = 2000;

// Files changed on disk this turn without going through an edit tool, for
// example by a script run from the shell. Their edits never reached the
// per-edit rules check, so they are checked here when the turn ends.
export async function shellChangedFiles({ input, projectDir, records, subagent = false }) {
  const scope = { sidechain: subagent };
  const turn = currentTurn(records, scope);
  const since = Date.parse(turn[0]?.timestamp);
  if (!Number.isFinite(since)) return [];
  const calls = toolCalls(turn, scope);
  const roots = candidateRoots({ cwd: input.cwd, projectDir, calls });
  const edited = calls.filter((c) => EDIT_TOOLS.has(c.name)).map((c) => c.input?.file_path).filter(Boolean);
  const changed = (await Promise.all(roots.map((r) => changedSince(r, since - CLOCK_SLACK_MS)))).flat();
  return changed.filter((f) => !edited.some((e) => sameFile(e, f.abs)));
}

export async function checkSweep({ files, rules, threshold, backend, timeoutMs, subagent = false, input = {} }) {
  const who = subagent ? { agent: String(input.agent_type ?? 'subagent').slice(0, 40) } : {};
  const covered = files.map((f) => ({ ...f, applicable: rulesFor(f.rel, rules) })).filter((f) => f.applicable.length > 0);
  if (covered.length === 0) return null;

  const checked = covered.slice(0, MAX_FILES);
  const verdicts = await Promise.all(
    checked.map(async (f) => {
      const diff = capDiff(await fileDiff(f.root, f.rel));
      if (!diff.trim()) return null;
      const { question, choices, descriptions } = ruleCheck({ rules: f.applicable, filePath: f.rel, diff });
      try {
        const verdict = await backend.classify(question, choices, { timeoutMs, descriptions });
        if (!validVerdict(verdict, choices)) return null;
        const said = decide(verdict, threshold);
        return said === NONE ? null : { file: f, rule: f.applicable.find((r) => r.id === said) };
      } catch {
        return null;
      }
    }),
  );
  const hits = verdicts.filter(Boolean);
  const trace = { check: 'sweep', ...who, files: checked.length, skipped: covered.length - checked.length, kinds: [...new Set(checked.map((f) => fileKind(f.rel)))].slice(0, 5) };
  if (hits.length === 0) return { trace: { ...trace, outcome: 'quiet' } };

  const lines = hits.map((h) => `${h.file.rel} may break "${h.rule.id}": ${h.rule.rule}`);
  return {
    trace: { ...trace, outcome: 'flagged', flagged: hits.length, ids: hits.map((h) => h.rule.id) },
    finding: {
      check: 'sweep',
      id: hits.length === 1 ? hits[0].rule.id : 'several-rules',
      message: `Wince: files changed outside the edit tools this turn may break project rules:\n- ${lines.join('\n- ')}`,
      notice: `Wince flagged ${hits.length === 1 ? `"${hits[0].rule.id}" in ${hits[0].file.rel.split('/').pop()}` : `${hits.length} files changed by shell commands`}`,
    },
  };
}
