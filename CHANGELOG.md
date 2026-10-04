# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## Unreleased

Initial development toward 0.1.0.

- Renamed from Flinch to Wince before the first release, after finding an existing Claude Code plugin named Flinch. The plugin, command, settings file (`.wince.json`), rules folder (`.wince/`) and `WINCE_*` environment variables all use the new name.

- Plugin manifest and marketplace entry, installable from this repository.
- Rules check: after each Edit, Write or MultiEdit, judges the change against the project's `.wince/rules.json` and nudges the agent (or blocks, in block mode).
- Done check: when the agent stops after editing files without running a test, build or check, warns the user (or sends the agent back, in block mode).
- Jev backend (Typesafe AI), used first when a key is set through the plugin's optional `jev_api_key` setting or `TYPESAFE_API_KEY`. Confidence comes from Jev's per-option probabilities.
- Backends: Anthropic API (`ANTHROPIC_API_KEY`) or, with no key, Claude Code's own CLI on the user's login.
- Default confidence threshold is 0.6, confirmed on a held-out case set: no false alarms, and more catches than 0.8.
- Every check that reaches a backend is logged locally, quiet ones included, with no file paths, code or rule text. The log rolls over at 5 MB and keeps one older copy.
- `wince log` summarizes the log: checks run, flag rate, backend speed, top rules and recent flags.
- Inside a git worktree with no Wince files of its own, the main checkout's `.wince.json` and rules apply, so local-only rules cover every worktree.
- Risky command check: before every Bash and PowerShell command, stops force-pushes, discarding uncommitted changes, remote branch deletes, deletes outside the project, publishing, deploying and dropping tables on a remote database. Nudge mode asks the user; block mode refuses. Pattern-based, about 10ms, no backend.
- `WINCE_LOG_DIR` overrides where the log is written.
- A rule nudge also shows the user a one-line notice naming the rule and the file.
- Checks that stand down are logged: an edit no rule covers, and a finish after tests already ran. Session starts are logged too, and every entry carries a short session id.
- `wince log` shows when the last check ran and how many checks stood down. `wince statusline` prints a one-line summary of the current session for Claude Code's status line, and nothing for sessions without Wince.
- Subagents: a subagent that says done without testing its edits is sent back once to test, in both modes; `"subagents": "log"` only logs it. A PowerShell test or build run now counts as testing.
- Rule patterns are matched from the root of the repository or worktree holding the edited file, so edits in a worktree nested inside the project match the same rules.
- The done check ignores edits outside any repository, such as scratchpad files, temp folders and commit messages written to a file, so finishing a commit or PR turn no longer reads as untested code.
- Fails open on any backend error, timeout, malformed input or bad config.
