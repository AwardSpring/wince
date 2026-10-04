# Starter rule sets

Copy the file closest to your stack to `.wince/rules.json` in your project, then edit it:

- Delete rules that don't apply to you.
- Change the `applies` patterns to match your folder layout.
- Add the rules your team actually enforces in code review.

| File | Stack |
|---|---|
| [`typescript-react.json`](typescript-react.json) | TypeScript, React |
| [`dotnet.json`](dotnet.json) | C#, ASP.NET Core, EF Core |
| [`python.json`](python.json) | Python, Django or FastAPI |
| [`rails.json`](rails.json) | Ruby on Rails |

These rules are deliberately concrete: each one can be judged from the edited lines alone. See [Writing rules that work](../README.md#writing-rules-that-work) before you add your own.
