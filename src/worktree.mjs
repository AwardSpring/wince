import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, basename } from 'node:path';

// A linked worktree has a .git file ("gitdir: <repo>/.git/worktrees/<name>")
// whose commondir file points at the shared .git directory. The main
// checkout is that directory's parent. Returns null for anything else: a
// main checkout, a bare repository, or a folder that isn't in git.
export async function mainCheckout(projectDir) {
  const dotGit = await readFile(resolve(projectDir, '.git'), 'utf8').catch(() => null);
  const match = dotGit?.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!match) return null;
  const gitDir = isAbsolute(match[1]) ? match[1] : resolve(projectDir, match[1]);
  const common = (await readFile(resolve(gitDir, 'commondir'), 'utf8').catch(() => '')).trim();
  if (!common) return null;
  const commonDir = isAbsolute(common) ? common : resolve(gitDir, common);
  if (basename(commonDir) !== '.git') return null;
  return dirname(commonDir);
}
