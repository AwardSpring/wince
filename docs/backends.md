# Backends

Flinch asks every check as a multiple-choice question. Every backend implements one interface:

```ts
classify(question: string, choices: string[], opts: { timeoutMs: number }): Promise<{ choice: string; confidence: number }>
```

Adapters call each provider's HTTP API with `fetch`, with no provider SDKs, so installing Flinch never pulls in a dependency tree.

**v0.1 ships tiers 1, 2 and 6 only (Jev, Anthropic, `claude -p`), with Claude Code as the only host.** The other adapters stay in this design so they can be added later without changes to the checks.

## Selection

`backend` in the Flinch config pins one backend. If it is unset, Flinch uses the first one available:

| Order | Backend | Available when | How checks run |
|---|---|---|---|
| 1 | Jev | `jev_api_key` / `JEV_API_KEY` | Inline (~100ms) |
| 2 | Anthropic | `ANTHROPIC_API_KEY` | Inline for Stop/PreToolUse, background for PostToolUse |
| 3 | OpenAI | `OPENAI_API_KEY` | Same as Anthropic |
| 4 | Gemini | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Same as Anthropic |
| 5 | Any OpenAI-compatible endpoint | `FLINCH_BASE_URL` (+ optional `FLINCH_API_KEY`, `FLINCH_MODEL`) | Covers Ollama, LM Studio, vLLM, Azure OpenAI, OpenRouter, a company gateway. Latency decides inline vs background |
| 6 | The host agent's own CLI | Always | Reuses the user's existing login (`claude -p`, later `codex exec` / `gemini -p`). Background for everything except Stop |

- Each API backend defaults to that provider's small, fast model. `FLINCH_MODEL` overrides it.
- With a local model behind `FLINCH_BASE_URL` (Ollama), nothing leaves the machine. Some teams need that before they'll install anything.

## Rules

- **No key is needed to install.** Tier 6 always works.
- **Slow backends never slow the agent down.** A backend whose measured p50 is above 300ms runs PostToolUse checks in the background (`asyncRewake`), so it wakes Claude only on a hit. Flinch measures this itself and doesn't use a hardcoded list.
- **Stop always runs inline.** It fires once per turn.
- **Usage-based backends cost the user money, and tier 6 uses their plan limits.** `flinch init` and the README say so. Individual checks can be switched off.
- **Each backend carries its own timeout.** A timeout or error fails open.
- **Scoring is the same everywhere:** one choice id plus a confidence from 0 to 1, with the same threshold (0.6 by default). The default was set on Jev's probabilities, which are calibrated. Claude backends report their own confidence, which runs high (0.85 to 0.95 whether right or wrong), so the threshold filters little for them.
- `flinch status` shows the active backend. `flinch log` records which backend gave each verdict.

## Host agents (separate question)

The backends answer "which LLM judges." The host is "which coding agent Flinch watches." v0.1 is Claude Code only. Codex CLI and Gemini CLI support depends on how complete their hook systems are, which still has to be verified. That would mean a host adapter per agent mapping its events onto Flinch's five checks.

## Verify

- Latency per backend: Jev, Haiku, gpt mini, Gemini Flash, a local 7-8B model in Ollama, and `claude -p` cold start on Windows and macOS.
- A spawned `claude -p` must not trigger Flinch's own hooks (guard: `FLINCH_INNER=1`).
- Test-set accuracy per backend. This sets the launch claim: if small general models match Jev, the pitch is speed and cost. It also tells users which local model is good enough.
