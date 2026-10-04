# Security Policy

## Reporting a vulnerability

Please don't report security issues in public issues or pull requests.

Report them privately through GitHub: on this repository, go to **Security → Report a vulnerability**. We'll acknowledge the report within 3 business days and keep you updated while we work on a fix.

## What counts

Wince sits between a coding agent and its tools, so we especially want to hear about:

- Ways to make Wince **send more data** to a backend than documented, or to the wrong place.
- Ways for repository content (rules files, file contents, command output) to **steer Wince's verdicts** in a way that lets a harmful action through. This includes prompt injection that turns off the risky-command check.
- Wince **blocking, hanging, or crashing** the agent when it should fail open.
- Leaks of API keys from config, logs, or `wince log` output.

## Supported versions

Security fixes go into the latest release.
