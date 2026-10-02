# Flinch

**Your coding agent flinches before the mistake.**

Flinch is a [Claude Code](https://code.claude.com) plugin that watches each step your agent takes. It asks a fast classifier a yes-or-no question about the step and nudges the agent when something looks wrong. You don't have to be watching: it catches loops, risky commands, broken project rules, and "done!" claims that were never checked.

> **Status: pre-release.** Flinch is in active development and not yet published. The commands below describe v0.1 as designed.

```
● Bash(dotnet test)  ✗ 3 failed
  ⤷ flinch: same failure 3 times in a row. Stop retrying, read the error, change approach.

● Edit(src/Orders/OrderQueries.cs)
  ⤷ flinch: this edit may break "tenant-filter": every query on a tenant-owned table filters by TenantId.

● "Fixed! The bug is resolved."
  ⤷ flinch: you said it's done, but nothing has been tested since your last edit. Verify first.
```

## What it checks

| Check | When | What it catches |
|---|---|---|
| **Stuck** | After each tool call | The same failure again and again, editing in circles, flailing |
| **Risky command** | Before each shell command | Destructive or outward-facing commands: force-push, `rm -rf`, publishing, deploying |
| **Unproven done** | When the agent tries to finish | Claiming success with no test or build run since the last edit |
| **Your rules** | After each edit | Code that breaks a rule from your own project rules (see [Rules](#rules)) |
| **Drift** | After each tool call | Work that has wandered away from what you asked for |

Every check can be turned on or off on its own.

## Install

In Claude Code:

```
/plugin marketplace add awardspring/flinch
/plugin install flinch@flinch
```

That's it. Flinch works right away using your existing Claude Code login (see [Backends](#backends)).

## Backends

Each check is one small multiple-choice question. Flinch sends it to the fastest backend you have:

1. **[Jev](https://typesafe.ai/)** (recommended). Paste a key when the plugin asks, or set `JEV_API_KEY`. Verdicts come back in about 100ms, so every check runs before the agent's next step.
2. **Anthropic API.** Used when `ANTHROPIC_API_KEY` is set. It's slower, so most checks run in the background and speak up only when they find something.
3. **Claude Code itself.** Always available, with no key needed. It uses your existing login and counts against your Claude plan's limits.

`flinch status` shows which backend is active.

## Modes

- **Nudge (default):** Flinch tells the agent what it noticed, and the agent decides what to do.
- **Block:** a risky command needs your approval, a rule-breaking edit has to be fixed or explained, and an unproven "done" is sent back.

```json
// .flinch.json in your project root (all fields optional)
{
  "mode": "nudge",
  "checks": { "stuck": true, "risky": true, "done": true, "rules": true, "drift": false },
  "threshold": 0.8,
  "rules": ".flinch/rules.json"
}
```

## Rules

The rules check works from a short list of your project's rules, with one sentence for each:

```json
{
  "rules": [
    { "id": "tenant-filter", "applies": ["**/*.cs"], "rule": "Every query on a tenant-owned table filters by TenantId." },
    { "id": "no-raw-hex", "applies": ["**/*.scss"], "rule": "Use color tokens, never raw hex values." }
  ]
}
```

`flinch rules init` reads your `CLAUDE.md` / `AGENTS.md` and drafts this file for you to edit. Only rules whose `applies` patterns match the edited file are sent with each check.

## Commands

| Command | What it does |
|---|---|
| `flinch status` | Active backend, mode, and enabled checks |
| `flinch log` | What Flinch caught, when, and which backend decided |
| `flinch rules init` | Draft `.flinch/rules.json` from your agent instructions |

## Privacy

Flinch sends each check the smallest amount of context it can: the edited hunk, the command about to run, or a short summary of recent steps, plus the rules that apply. It never sends whole files or your full conversation. Requests go only to the backend you're using. With the Claude Code backend, nothing leaves your machine except through Claude Code itself. Flinch has no telemetry.

## Failing safe

Flinch never makes your agent worse. If a backend is slow, down, or returns an error, the step goes ahead as if Flinch weren't installed. If Flinch isn't sure, it stays quiet: a false alarm costs more trust than a missed catch.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © AwardSpring
