# Contributing to Flinch

Thanks for helping. Bug reports, new checks, better prompts, and eval cases are all welcome.

## Before you start

- **Bugs:** open an issue with the bug report template. Include `flinch status` output and the relevant `flinch log` lines. Trim anything private first.
- **New checks or behavior changes:** open an issue to discuss before writing code. Every check costs latency and attention, so new checks must earn their place.
- **Security issues:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 20+ and Claude Code.

```bash
git clone https://github.com/awardspring/flinch
cd flinch
npm install
npm test
```

To try your local copy in Claude Code:

```
/plugin marketplace add ./path/to/flinch
/plugin install flinch@flinch
```

Set `FLINCH_DEBUG=1` to log every check, its input size, the backend, latency, and the verdict to stderr.

## What a good change looks like

- **Quiet beats noisy.** A check should speak only when it's confident. A change that catches more but also raises more false alarms needs eval numbers showing it's worth it.
- **Fail open.** No error, timeout, or bad config in Flinch may block the agent. Flinch must never exit with a blocking code because of its own failure.
- **Send less.** Don't widen what a check sends to a backend without saying so in the PR description and updating the Privacy section of the README.
- **No new runtime dependencies** without discussion. Backends talk to provider APIs with plain `fetch`.

## Evals

Changes to a check's prompt, threshold, or input must include eval results. `evals/` holds labeled cases, real tool calls and edits each marked with the verdict a careful reviewer would give:

```bash
npm run eval -- --rules examples/dotnet.json --cases path/to/cases.jsonl --backend claude-cli
```

When you add eval cases:

- Use **real** edits and commands from open-source projects or your own work. Don't write cases to fit a check. A check tuned to invented examples will look great and fail in practice.
- Add cases where the right answer is "nothing wrong," especially near misses. They measure false alarms, which matter as much as catches.
- Never include secrets, credentials, or personal data.

## Pull requests

- Keep each PR to one change and explain *why* in the description.
- Add or update tests, and eval results where they apply.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- CI must pass.

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).

## Code of conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md).
