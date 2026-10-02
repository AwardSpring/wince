<p align="center">
  <img src="docs/assets/flinch.png" alt="Flinch: your coding agent flinches before the mistake." width="360">
</p>

Flinch is a [Claude Code](https://code.claude.com) plugin that watches each step your agent takes and speaks up when something looks wrong. You don't have to be watching: it catches edits that break your project's rules, risky commands, and "done!" claims that were never checked.

> **Status: pre-release.** Flinch is in active development and not yet published. The **rules**, **unproven done** and **risky command** checks work today. The other checks and the `flinch` commands are designed but not built yet, and are marked *coming* below.

```
● Bash(git reset --hard origin/main)
  ⤷ flinch: this command throws away uncommitted changes. Allow it?

● Edit(src/Orders/OrderQueries.cs)
  ⤷ flinch: this edit may break "tenant-filter": every query on a tenant-owned table filters by TenantId.

● "Fixed! The bug is resolved."
  ⤷ flinch: you said it's done, but nothing has been tested since your last edit. Verify first.
```

## What it checks

| Check | When | What it catches | |
|---|---|---|---|
| **Your rules** | After each edit | Code that breaks a rule from your own project rules (see [Rules](#rules)) | available |
| **Unproven done** | When the agent tries to finish | Claiming success with no test or build run since the last edit | available |
| **Risky command** | Before each shell command | Destructive or outward-facing commands: force-push, `rm -rf`, publishing, deploying | available |
| **Drift** | After each tool call | Work that has wandered away from what you asked for | *coming* |

Every check can be turned on or off on its own.

We also built a *stuck* check (the same command failing again and again, or editing in circles) and measured it on 5,000 real agent turns before shipping. It never fired: current models read the error and change course on their own. So it isn't included.

## What you see

Flinch is quiet when nothing is wrong. When it speaks, you always see it:

| Check | When it fires, you see |
|---|---|
| Your rules | A one-line notice, for example `Flinch flagged "tenant-filter" in OrderQueries.cs`. The agent gets the full rule. |
| Unproven done | A line under the agent's last message (nudge mode), or the agent keeps working (block mode). |
| Risky command | Claude Code's permission prompt, with Flinch's reason (nudge mode). |

To see that Flinch is running even when it has nothing to say, add it to Claude Code's status line. It shows a segment like `flinch 12 checks · 1 flag · last 3:08pm` for the current session, and nothing in sessions where Flinch isn't loaded:

```bash
# in your status line script, which receives Claude Code's status JSON on stdin
input=$(cat)
flinch=$(echo "$input" | flinch statusline 2>/dev/null)
```

`flinch statusline` reads the same JSON Claude Code gives your status line command. If `flinch` isn't on the path where your status line runs, call `node <plugin folder>/src/cli.mjs statusline` instead.

## How well it works

We measured the rules check on real edits from a production codebase's review history. Each case is an edit a human reviewer flagged as breaking a team rule, or a clean edit from the same codebase, many of them near misses. We tuned on one set of cases, then confirmed on a second set of 50 that shared no pull request, commit, or diff with the first.

On the held-out set, averaged over three runs:

| Backend | Rule violations caught | Wrong rule named | False alarms on clean edits | No answer | Time per check |
|---|---|---|---|---|---|
| **Jev** | **19 of 25** | 0 | **0 of 25** | 0 | about 150ms |
| Claude Haiku | 17 to 19 of 25 | 0 to 1 | 2 to 6 of 25 | 3 to 5 | about 6.5s |

Ranges are the spread across the three runs.

- **Jev stays quiet when it should.** It never raised a false alarm, and it gave the same answers on every run. Its confidence is a real probability, so the threshold works as intended.
- **Claude catches about as many, but it's noisy.** Identical runs raised between 2 and 6 false alarms. Its confidence is 0.85 to 0.95 whether it's right or wrong, so the threshold can't filter it. A few checks per run also gave no usable answer; those fail open.
- **In a live Claude Code session**, a Jev check takes about 300ms from start to finish. On the Claude Code fallback it takes about 4 seconds.

These numbers come from one codebase and one team's rules. Yours will depend on how concrete your rules are (see [Writing rules that work](#writing-rules-that-work)), so test them on your own history before you rely on block mode.

## Install

In Claude Code:

```
/plugin marketplace add awardspring/flinch
/plugin install flinch@flinch
```

That's it. Flinch works right away using your existing Claude Code login (see [Backends](#backends)).

## Backends

Each check is one small multiple-choice question. Flinch sends it to the fastest backend you have:

1. **[Jev](https://typesafe.ai/)** (recommended). Paste a key when the plugin asks, or set `TYPESAFE_API_KEY`. A check takes about 150ms, so it finishes before the agent's next step.
2. **Anthropic API.** Used when `ANTHROPIC_API_KEY` is set. Each check takes a second or more.
3. **Claude Code itself.** Always available, with no key needed. It uses your existing login, takes about 4 seconds per check, and counts against your Claude plan's limits.

The agent waits for each check, so a slower backend slows the agent down. `flinch status` (*coming*) will show which backend is active.

## Modes

- **Nudge (default):** Flinch tells the agent what it noticed, and the agent decides what to do.
- **Block:** a rule-breaking edit has to be fixed or explained, an unproven "done" is sent back, and a risky command is refused.

A risky command always stops before it runs. In nudge mode Claude Code asks you to approve it, with Flinch's reason; in block mode it is refused and the agent is told why.

```json
// .flinch.json in your project root (all fields optional)
{
  "mode": "nudge",
  "checks": { "rules": true, "done": true, "risky": true },
  "threshold": 0.6,
  "rules": ".flinch/rules.json"
}
```

## Risky commands

The risky command check runs before every Bash and PowerShell command. It needs no backend: it matches a short list of command shapes, so it takes about 10ms and never calls a model.

| It stops | For example |
|---|---|
| Force-pushes | `git push --force`, `git push origin +main` (`--force-with-lease` is allowed) |
| Throwing away uncommitted changes | `git reset --hard`, `git checkout -- .`, `git clean -fd` |
| Deleting a branch on the remote | `git push origin --delete feature` |
| Deleting files outside the project | `rm -rf ~`, `rm -rf ../other`, `Remove-Item -Recurse C:\` (temp folders are fine) |
| Publishing | `npm publish`, `dotnet nuget push`, `gh release create`, `docker push` |
| Deploying or deleting cloud resources | `terraform apply`, `kubectl delete`, `az ... delete`, `aws s3 rm` |
| Dropping tables on a database server | `DROP TABLE` through `psql`, `sqlcmd` or `mysql`, unless the server is local |

Each pattern looks at one command at a time, from its start, so `git commit -m "fix -f flag" && git push` is not a force-push. Over about 19,000 real commands from agent sessions, it stopped 13 (about 1 in 1,500), and each was a hard reset, a remote branch delete, or a cloud resource delete.

Turn it off with `"checks": { "risky": false }` in `.flinch.json`.

## Rules

The rules check works from your project's own rules. Write them in `.flinch/rules.json`, one sentence each:

```json
{
  "rules": [
    { "id": "tenant-filter", "applies": ["**/*.cs"], "rule": "Every query on a tenant-owned table filters by TenantId." },
    { "id": "no-raw-hex", "applies": ["**/*.scss"], "rule": "Use color tokens, never raw hex values." }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Short name, shown in nudges and in `flinch log` |
| `applies` | File patterns the rule covers. Only rules matching the edited file are sent with a check, so narrow patterns keep checks fast and accurate |
| `rule` | One sentence the agent's edit is judged against |

**Getting started.** Copy a starter set from [`examples/`](examples/) and edit it, or (*coming*) run `flinch rules init` to draft the file from your `CLAUDE.md` / `AGENTS.md`. Then trim it. Ten sharp rules beat forty vague ones.

**Commit it.** `.flinch/rules.json` belongs in your repository, so everyone on the team, and every agent, is held to the same rules. If you keep it local instead, Flinch still finds it from any git worktree of the same repository.

### Writing rules that work

Flinch judges one edit at a time, with nothing but the rule and the changed lines. A good rule is one a careful reviewer could check by looking at just that diff.

| Works well | Works poorly | Why |
|---|---|---|
| "Every query on a tenant-owned table filters by TenantId." | "Keep tenant data isolated." | Name the thing you'd see in the code |
| "No raw hex colors in stylesheets; use the color tokens." | "Follow the design system." | One concrete check, not a whole document |
| "Controller actions only call a service; no database queries in controllers." | "Keep controllers thin." | "Thin" is a judgment; "no queries" is visible |
| "Async functions that do I/O take a cancellation token." | "Write good async code." | Vague rules turn into false alarms |

Avoid rules about taste, tone, or comment style. In our own testing, judgment-call rules caused most of the false alarms while concrete rules stayed accurate. If a rule needs context outside the edit to decide, such as "this file must also be registered elsewhere", Flinch can't see it and will stay quiet.

### Test your rules

Before you turn on block mode, check your rules against real edits from your own history:

```bash
flinch eval --rules .flinch/rules.json --cases .flinch/cases.jsonl
```

Until the `flinch` command ships, run the same thing from a clone of this repository: `npm run eval -- --rules <your rules> --cases <your cases> --backend jev`.

Each line of `cases.jsonl` is one real edit, labeled with the rule it breaks or `"none"`:

```json
{"id": "c01", "expected": "tenant-filter", "file_path": "src/Orders/OrderQueries.cs", "diff": "@@ ... @@\n+ var orders = db.Orders.Where(o => o.Status == status);"}
```

Include clean edits, especially near misses, as well as rule-breaking ones. The eval reports catches, misses, wrong-rule answers, and false alarms, and shows how each would change at every threshold from 0.4 to 0.9. A rule that raises false alarms should be rewritten to be more concrete, or removed.

## Commands

The `flinch` command is on your path inside Claude Code while the plugin is enabled.

| Command | What it does | |
|---|---|---|
| `flinch log` | When the last check ran, how many ran and were flagged, how many stood down (no rule covers the file, or tests already ran), each backend's speed, the rules flagged most, and the latest flags. `--days N` changes the window; `--json` prints raw numbers | available |
| `flinch statusline` | A one-line summary for the current session, for Claude Code's status line | available |
| `flinch status` | Active backend, mode, and enabled checks | *coming* |
| `flinch rules init` | Draft `.flinch/rules.json` from your agent instructions | *coming* |
| `flinch eval` | Score your rules against a labeled set of real edits | *coming* |

## Privacy

Flinch sends each check the smallest amount of context it can: the edited hunk, the command about to run, or a short summary of recent steps, plus the rules that apply. It never sends whole files or your full conversation. Requests go only to the backend you're using. With the Claude Code backend, nothing leaves your machine except through Claude Code itself.

Flinch has no telemetry. It keeps a log on your machine, in Claude Code's plugin data folder (`~/.claude/plugins/data/`), with one line per check: the time, a short session id, which check, the file type, the verdict, the confidence, and how long it took. It holds no file paths, code, or rule text, and it is never sent anywhere. The log is capped: at 5 MB the file rolls over and the older copy is replaced, so it never takes more than about 10 MB.

## Failing safe

Flinch never makes your agent worse. If a backend is slow, down, or returns an error, the step goes ahead as if Flinch weren't installed. If Flinch isn't sure, it stays quiet: a false alarm costs more trust than a missed catch.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © AwardSpring
