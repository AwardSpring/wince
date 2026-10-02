# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## Unreleased

Initial development toward 0.1.0.

- Plugin manifest and marketplace entry, installable from this repository.
- Rules check: after each Edit, Write or MultiEdit, judges the change against the project's `.flinch/rules.json` and nudges the agent (or blocks, in block mode).
- Done check: when the agent stops after editing files without running a test, build or check, warns the user (or sends the agent back, in block mode).
- Jev backend (Typesafe AI), used first when a key is set through the plugin's optional `jev_api_key` setting or `TYPESAFE_API_KEY`. Confidence comes from Jev's per-option probabilities.
- Backends: Anthropic API (`ANTHROPIC_API_KEY`) or, with no key, Claude Code's own CLI on the user's login.
- Default confidence threshold is 0.6, confirmed on a held-out case set: no false alarms, and more catches than 0.8.
- Every check that reaches a backend is logged locally, quiet ones included, with no file paths, code or rule text. The log rolls over at 5 MB and keeps one older copy.
- `flinch log` summarizes the log: checks run, flag rate, backend speed, top rules and recent flags.
- Inside a git worktree with no Flinch files of its own, the main checkout's `.flinch.json` and rules apply, so local-only rules cover every worktree.
- Fails open on any backend error, timeout, malformed input or bad config.
