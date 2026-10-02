# Hook contract

Checked against code.claude.com/docs/en/hooks (2026-10-01). Items marked **verify** are not settled by the docs and need an empirical test.

## Check → hook

| Check | Event | Output |
|---|---|---|
| Risky command | `PreToolUse` (Bash) | `hookSpecificOutput.permissionDecision`: `ask` (nudge mode) or `deny` (block mode), with `permissionDecisionReason` |
| Stuck / looping | `PostToolUse` | `hookSpecificOutput.additionalContext`, which Claude sees as context, not as an error |
| Rule check | `PostToolUse` (Edit, Write, MultiEdit) | `additionalContext` (nudge mode); block mode is still to be decided |
| Done without proof | `Stop`, `SubagentStop` | `decision: "block"` plus a reason, so Claude keeps working |
| Drift | `UserPromptSubmit` records the task; `PostToolUse` compares against it | `additionalContext` |

## Inputs

- Every event gets `session_id`, `transcript_path`, `cwd`, `permission_mode` and `hook_event_name` on stdin.
- Tool events add `tool_name`, `tool_input` and `tool_use_id`. `PostToolUse` also gets `tool_response`.
- `Stop` gets `last_assistant_message`.
- History (the last N tool calls, edits since the last test run) comes from parsing `transcript_path`. Flinch keeps its own small per-session state in `${CLAUDE_PLUGIN_DATA}` so it doesn't re-parse the whole transcript on every call.

## Packaging

- Hooks are declared in `hooks/hooks.json` and call `node ${CLAUDE_PLUGIN_ROOT}/dist/flinch.js <event>`.
- The Jev key is declared in `plugin.json` `userConfig` as `{ "jev_api_key": { "type": "string", "sensitive": true } }`. The user is prompted for it at install time, and hooks read it from `CLAUDE_PLUGIN_OPTION_jev_api_key`.
- Install:
  - `/plugin marketplace add awardspring/flinch`
  - `/plugin install flinch@flinch`

## Failure behavior

- A timeout or error is non-blocking unless the hook exits 2. Flinch never exits 2 on its own failure: it catches everything and exits 0 with no output.
- Each hook sets its own `timeout` to a few seconds, not the 600s default. The Jev call is capped at about 500ms and then fails open.

## Verify empirically

1. **Stop-loop guard.** The docs page fetched didn't confirm a `stop_hook_active` input field. Until a test confirms it, Flinch blocks a stop at most once per user prompt, tracked in its own state.
2. **Parallel vs sequential.** It's unclear whether multiple hooks on the same event run in parallel or one after another. This affects total latency when a user has other hooks installed.
3. **`async` / `asyncRewake`.** Flinch could run the rule check in the background and wake Claude only on a hit, adding zero latency to clean edits. The timing still needs measuring.
4. **Prompt and agent hooks (`type: "prompt"` / `"agent"`).** These run a model natively, but their 30s / 60s figures are timeouts, not measured latency. They still need to be benchmarked against Jev to see whether Jev's speed advantage is real here.
