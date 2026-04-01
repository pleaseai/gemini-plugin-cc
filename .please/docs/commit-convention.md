# Commit Convention

# source: standards:commit-convention

# version: 1.0.0

# synced: 2026-03-13

# This file was created by /standards:init.

# You can customize it for your project.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Valid Types

| Type       | Description                              |
| ---------- | ---------------------------------------- |
| `feat`     | New feature                              |
| `fix`      | Bug fix                                  |
| `docs`     | Documentation only                       |
| `style`    | Code style (formatting, no logic change) |
| `refactor` | Code refactoring                         |
| `perf`     | Performance improvement                  |
| `test`     | Add or update tests                      |
| `build`    | Build system changes                     |
| `ci`       | CI/CD configuration                      |
| `chore`    | Maintenance tasks                        |
| `revert`   | Revert previous commit                   |

## Quick Rules

Do:

- Use lowercase for type: `feat:` not `Feat:`
- Keep header <= 100 characters
- Use imperative mood: "add" not "added"
- Omit trailing period in subject
- Add blank line before body/footer

Don't:

- Start subject with capital letter (unless proper noun)
- End subject with period
- Use past tense
- Mix multiple changes in one commit

## Korean Projects

- Keep `type` and `scope` in English
- Write subject and body in Korean
- Example: `feat(auth): 사용자 인증 기능 추가`
