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
- `hooks.json` gives each hook a 30s `timeout`. Inside it, every backend call has its own limit (Anthropic 3s, `claude-cli` 20s), and a 25s hard deadline returns nothing. Every limit fails open.

## Confirmed in a live session (Claude Code 2.1.285, 2026-10-02)

Run headless with `claude -p --plugin-dir <repo>` against a scratch project:

- PostToolUse `hookSpecificOutput.additionalContext` reaches the agent. It quoted the nudge back verbatim.
- PostToolUse `decision: "block"` with `reason` works. The agent rewrote the offending edit itself (`any` to `unknown`).
- Stop `systemMessage` is shown to the user as "Stop says: ...".
- Stop `decision: "block"` sends the agent back once. The second Stop arrives with `stop_hook_active` set, and Flinch stays quiet, so there is no loop.
- `${CLAUDE_PLUGIN_ROOT}` resolves, and `CLAUDE_PLUGIN_DATA` is `~/.claude/plugins/data/flinch-inline/` for a `--plugin-dir` load.
- Latency on the `claude-cli` backend is 3.5 to 4.3 seconds per check, run inline.

## Still to verify

1. Whether several hooks on the same event run in parallel or one after another.
2. `async` / `asyncRewake`: the docs list the fields but not how output is delivered. Test before moving the slower backends to background checks.
3. Prompt and agent hooks (`type: "prompt"` / `"agent"`): benchmark their real latency against Jev.
4. The `userConfig` env var is `CLAUDE_PLUGIN_OPTION_<KEY>` with the key uppercased, per the docs. Confirm when the Jev key option lands.
