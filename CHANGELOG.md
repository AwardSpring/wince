# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## Unreleased

Initial development toward 0.1.0.

- Plugin manifest and marketplace entry, installable from this repository.
- Rules check: after each Edit, Write or MultiEdit, judges the change against the project's `.flinch/rules.json` and nudges the agent (or blocks, in block mode).
- Done check: when the agent stops after editing files without running a test, build or check, warns the user (or sends the agent back, in block mode).
- Backends: Anthropic API (`ANTHROPIC_API_KEY`) or, with no key, Claude Code's own CLI on the user's login.
- Fails open on any backend error, timeout, malformed input or bad config.
