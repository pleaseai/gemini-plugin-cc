# Engineering Standards

# source: standards:engineering-standards

# version: 2.3.0

# synced: 2026-03-13

# This file was created by /standards:init.

# You can customize it for your project.

Problem definition -> small, safe change -> change review -> refactor -- repeat the loop.

## Mandatory Rules

- Before changing anything, read the relevant files end to end, including all call/reference paths.
- Keep tasks, commits, and PRs small.
- If you make assumptions, record them in the Issue/PR/ADR.
- Never commit or log secrets; validate all inputs and encode/normalize outputs.
- Avoid premature abstraction and use intention-revealing names.
- Apply YAGNI principle: "You Aren't Gonna Need It" - don't build features until they're actually needed.
- Compare at least two options before deciding.
- State assumptions explicitly; ask for clarification when requirements are ambiguous.
- Make surgical changes: modify only what was requested; don't touch unrelated code.

## Mindset

- Think like a senior engineer.
- Don't jump in on guesses or rush to conclusions.
- Always evaluate multiple approaches; write one line each for pros/cons/risks, then choose the simplest solution.

## Code & File Reference Rules

- Read files thoroughly from start to finish (no partial reads).
- Before changing code, locate and read definitions, references, call sites, related tests, docs/config/flags.
- Do not change code without having read the entire file.
- Before modifying a symbol, run a global search to understand pre/postconditions and leave a 1-3 line impact note.

## Required Coding Rules

- Before coding, write a Problem 1-Pager: Context / Problem / Goal / Non-Goals / Constraints.
- Enforce limits: file <= 500 LOC (source/tests/types); function <= 50 LOC; parameters <= 5. If exceeded, split/refactor.
- Cyclomatic complexity <= 10; cognitive complexity <= 15 (aligned with SonarQube S1541/S3776 defaults).
- Prefer explicit code; no hidden "magic."
- Follow DRY, but avoid premature abstraction.
- Isolate side effects (I/O, network, global state) at the boundary layer.
- Catch only specific exceptions and present clear user-facing messages.
- Use structured logging and do not log sensitive data (propagate request/correlation IDs when possible).
- Account for time zones and DST.

## Testing Rules

- New code requires new tests; bug fixes must include a regression test (write it to fail first).
- Tests must be deterministic and independent; replace external systems with fakes/contract tests.
- Include >=1 happy path and >=1 failure path in e2e tests.
- Proactively assess risks from concurrency/locks/retries (duplication, deadlocks, etc.).

## Security Rules

- Never leave secrets in code/logs/tickets.
- Validate, normalize, and encode inputs; use parameterized operations.
- Apply the Principle of Least Privilege.

## Clean Code Rules

- Use intention-revealing names.
- Each function should do one thing.
- Keep side effects at the boundary.
- Prefer guard clauses first.
- Symbolize constants (no hardcoding).
- Structure code as Input -> Process -> Return.
- Report failures with specific errors/messages.
- Make tests serve as usage examples; include boundary and failure cases.
- Remove dead code created by your changes; flag pre-existing dead code without deleting.

## Anti-Pattern Rules

- Don't modify code without reading the whole context.
- Don't expose secrets.
- Don't ignore failures or warnings.
- Don't introduce unjustified optimization or abstraction.
- Don't overuse broad exceptions.
- Don't refactor or restyle code that isn't related to the current change.
- Don't make silent assumptions; surface uncertainty and ask for clarification.
- Don't accept AI-generated code you cannot explain.
- Don't let AI modify or delete tests to make code pass.
- Don't allow AI to add unrequested functionality.
- Don't let AI repeat the same failing approach in a loop -- stop and re-analyze.
