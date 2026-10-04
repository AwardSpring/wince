# Rule check

Asked after every Edit/Write/MultiEdit. One classification call per edit.

## Inputs

- `rules`: the project's rules whose `applies` globs match the edited file, rendered as `id: rule`. Only matching rules are sent, which keeps the input short and the choice list small.
- `file_path`: the edited file.
- `diff`: the unified diff of this edit only, capped at 80 changed lines. Larger edits are split into hunks and each hunk is checked separately.

## Question

```
Here are a project's coding rules, followed by one code edit.

RULES
{{#rules}}
{{id}}: {{rule}}
{{/rules}}

FILE: {{file_path}}
EDIT:
{{diff}}

Which rule does the ADDED code clearly violate? Judge only lines starting with "+".
If no rule is clearly violated, or you would need code outside this edit to be sure, answer "none".
```

## Choices

`none`, then each rule `id` from the list above.

## Decision

- If `none` wins, or the top choice's confidence is below the threshold (0.6 by default), stay silent.
- Otherwise, in nudge mode: `PostToolUse` returns the message `Wince: this edit may break "{{id}}": {{rule}}` as context Claude sees.
- In block mode the same message is returned as a block, and Claude has to fix the edit or explain it.
- If the call errors or times out, stay silent. Wince fails open.

## Notes

- "Clearly", and the instruction to answer `none` when unsure, bias the check toward silence. A false nudge costs more trust than a missed one.
- One verdict per hunk. Two violations in one hunk surface the stronger one; the next edit surfaces the other.
