import { relative, isAbsolute, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function editToDiff(toolName, toolInput) {
  if (toolName === 'Edit') return hunk(toolInput.old_string, toolInput.new_string);
  if (toolName === 'MultiEdit') return (toolInput.edits ?? []).map((e) => hunk(e.old_string, e.new_string)).join('\n');
  if (toolName === 'Write') return hunk('', toolInput.content);
  return '';
}

// Rule patterns are written from a repository's root. An edit can land in a
// git worktree nested inside the project (or elsewhere), so the path is
// taken from the nearest folder above the file that holds a .git entry,
// falling back to the project folder.
export function projectPath(filePath, projectDir) {
  if (!filePath) return '';
  if (!isAbsolute(filePath)) return filePath.replaceAll('\\', '/');
  const root = repoRoot(filePath) ?? projectDir;
  return (root ? relative(root, filePath) : filePath).replaceAll('\\', '/');
}

export function repoRoot(filePath) {
  let dir = dirname(filePath);
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function capDiff(diff, maxChangedLines = 80) {
  const lines = diff.split('\n');
  let changed = 0;
  const kept = [];
  for (const line of lines) {
    if (line.startsWith('+') || line.startsWith('-')) changed++;
    if (changed > maxChangedLines) break;
    kept.push(line);
  }
  return kept.join('\n');
}

function hunk(oldText = '', newText = '') {
  const removed = oldText ? oldText.split('\n').map((l) => `-${l}`) : [];
  const added = newText ? newText.split('\n').map((l) => `+${l}`) : [];
  return ['@@', ...removed, ...added].join('\n');
}
