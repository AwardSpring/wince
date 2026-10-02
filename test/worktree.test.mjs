import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckout } from '../src/worktree.mjs';
import { readProjectJson } from '../src/config.mjs';

const HOOK = fileURLToPath(new URL('../src/hook.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

function repoWithWorktree() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'flinch-wt-')));
  const main = join(root, 'main');
  mkdirSync(main);
  git(main, 'init', '-q');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const tree = join(root, 'tree');
  git(main, 'worktree', 'add', '-q', '--detach', tree);
  return { main, tree };
}

const rulesFile = (dir, id) => {
  mkdirSync(join(dir, '.flinch'), { recursive: true });
  writeFileSync(join(dir, '.flinch', 'rules.json'), JSON.stringify({ rules: [{ id, applies: ['src/**/*.ts'], rule: 'Do not add any.' }] }));
};

test('mainCheckout finds the main repository from a linked worktree', async () => {
  const { main, tree } = repoWithWorktree();
  assert.equal(realpathSync.native(await mainCheckout(tree)), main);
});

test('mainCheckout is null for a main checkout and for a folder outside git', async () => {
  const { main } = repoWithWorktree();
  assert.equal(await mainCheckout(main), null);
  assert.equal(await mainCheckout(mkdtempSync(join(tmpdir(), 'flinch-nogit-'))), null);
});

test('a worktree without its own rules uses the main checkout rules', async () => {
  const { main, tree } = repoWithWorktree();
  rulesFile(main, 'from-main');
  assert.equal((await readProjectJson(tree, '.flinch/rules.json')).rules[0].id, 'from-main');
});

test('a worktree rules file wins over the main checkout', async () => {
  const { main, tree } = repoWithWorktree();
  rulesFile(main, 'from-main');
  rulesFile(tree, 'from-tree');
  assert.equal((await readProjectJson(tree, '.flinch/rules.json')).rules[0].id, 'from-tree');
});

test('the hook checks edits in a worktree against the main checkout rules, from a subfolder too', () => {
  const { main, tree } = repoWithWorktree();
  rulesFile(main, 'no-any');
  const res = spawnSync(process.execPath, [HOOK, 'post-tool-use'], {
    input: JSON.stringify({
      cwd: join(tree, 'src', 'deep'),
      tool_name: 'Edit',
      tool_input: { file_path: join(tree, 'src', 'a.ts'), old_string: 'x', new_string: 'let y: any;' },
    }),
    env: { ...process.env, FLINCH_INNER: '', FLINCH_BACKEND: 'fake', FLINCH_FAKE: 'no-any', CLAUDE_PROJECT_DIR: tree, CLAUDE_PLUGIN_DATA: join(tree, '.data') },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /no-any/);
});

test('an edit in a worktree nested inside the main checkout matches rules from that worktree root', () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'flinch-nest-')));
  git(root, 'init', '-q');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const nested = join(root, '.worktrees', 'feature');
  git(root, 'worktree', 'add', '-q', '--detach', nested);
  rulesFile(root, 'no-any');
  const res = spawnSync(process.execPath, [HOOK, 'post-tool-use'], {
    input: JSON.stringify({ cwd: root, tool_name: 'Edit', tool_input: { file_path: join(nested, 'src', 'a.ts'), old_string: 'x', new_string: 'let y: any;' } }),
    env: { ...process.env, FLINCH_INNER: '', FLINCH_BACKEND: 'fake', FLINCH_FAKE: 'no-any', CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: join(root, '.data') },
    encoding: 'utf8',
  });
  assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /src\/a\.ts may break "no-any"/);
});
