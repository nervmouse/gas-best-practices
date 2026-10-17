# Changelog

## Unreleased

### Repository language

- All rules, docs, examples, evals, and comments converted to **English only** — no Thai or Chinese text remains anywhere in the repository
- The rule that reads "Thai user-facing error messages" is now "user-facing messages in the user's language", with English examples
- Added `npx skills` installation instructions (the [skills.sh](https://skills.sh) CLI) alongside the existing Claude Code one-liners
- `SKILL.md` frontmatter description is now ASCII-only (Thai trigger keywords removed)

## v1.2.3 — 2026-10-15

### Improved existing content

- `data-integrity.md` Rule #1 — the optimistic lock now applies to every state-changing command (skip / reschedule / complete / snooze), not just the save button: the web page sends back the state it rendered, and the server checks inside the lock that it still matches and that the row is still active before writing. A single helper is called from every command (hit for real: the snooze button on a stale card rescheduled an installment that was not due yet)

## v1.2.2 — 2026-10-15

### Fixed incorrect content

- `security.md` Rule #3 — dropped the recommendation to loop `Utilities.computeHmacSha256Signature` 10,000 times (PBKDF2 in the manual): in GAS that is nearly a minute per login (hit for real: after confirming a PIN the UI sat on "Verifying…" for a long time). Use a single HMAC whose key is a pepper in Script Properties plus a per-user salt, and rate-limit failed attempts instead

### Added a rule

- `triggers.md` Rule #8 — the app installs its own triggers on first-time setup (`ensureTriggers_()` idempotent + flag + separate try/catch), with a button and status in the app's setup page — never tell the user to open the editor and run `installTriggers()`

## v1.2.1 — 2026-10-07

### Fixed incorrect content

- `DriveApp` cannot use the `drive.file` scope (hit for real in a Drive photo-capture app: `DriveApp.createFolder` failed saying it needs `auth/drive`). Fixed consistently everywhere:
  - `security.md` Rule #4 — the scope example and the scope ordering now state that `DriveApp` writing files needs `drive`, read-only `DriveApp` needs `drive.readonly`, and `drive.file` applies only to the Drive REST API / Advanced Drive Service / Picker
  - `drive-ops.md` Rule #8 (new) — `DriveApp` scopes with a write/read table
  - `project-structure.md` — the `appsscript.json` template omits Drive scopes until they are actually needed
  - `examples/web-app-skeleton` — removed `drive.file`, since the example does not use Drive

## v1.2.0 — 2026-09-20

### Added a new rule file (22 → 23 files)

- `rules/data-integrity.md` — 6 rules distilled from a real incident in a card-booking system that used GAS as a money database: require `rev` on every write (a gate that can be bypassed by simply omitting the field), a circuit breaker against bulk deletes, post-save work must live inside try/catch, client payloads must never overwrite server-owned fields, reconciliation must read every place the real value is stored, and verify the result by identity rather than by aggregate total

### Improved existing content

- `cache-service.md` Rule #8 (new) — the cache key must be bound to the code version, not just the data revision, or a deploy keeps serving the old payload until the TTL expires
- `testing-debugging.md` Rule #11 (new) — `| grep` masks the test exit code in a deploy command (deployed to production once with 3 failing tests)
- `data-integrity.md` Rule #4 — fixed a `✓ Good` example that gated the lock on a flag that was never set, so a client payload could still overwrite server-owned fields; the lock is now derived from the value the server actually holds

## v1.1.0 — 2026-08-14

### Added 6 new rule topics (16 → 22 files)

- `rules/triggers.md` — time-driven / installable triggers, duplicate-trigger prevention, `onFormSubmit` (`e.namedValues`, not `e.values`), trigger authorization
- `rules/urlfetch-external-api.md` — `muteHttpExceptions`, retry + backoff, `fetchAll`, LINE Messaging API, quota
- `rules/deployment-versioning.md` — `/dev` vs `/exec`, `clasp deploy -i`, rollback, `.claspignore`, version stamp
- `rules/long-running-jobs.md` — checkpoint + continuation trigger to get past the 6-minute limit, submit+poll pattern
- `rules/email-notifications.md` — MailApp vs GmailApp, quota, throttled admin error alert
- `rules/properties-service.md` — Script/User/Document properties, criteria for Properties vs Config sheet

### Improved existing content

- `project-structure.md` — the `appsscript.json` template uses a narrow scope (`drive.file`), consistent with `security.md` Rule #4
- `spreadsheet-ops.md` Rule #2 — added the `getMergedRanges()` alternative + batch writing only in the safe zone (per-cell writes are slow on large sheets)
- `security.md` Rule #1 — the delete example references a RecordID instead of a row number, plus LockService to prevent a race condition
- `testing-debugging.md` Rule #5 — folded the RPC allow-list into the main `doPost` example
- Added tables of contents to the long files: `spreadsheet-ops`, `pdf-generation`, `external-frontend`, `drive-ops`

### Structure / tooling

- `build.sh` — generates `PROMPT.md` + syncs `.clinerules`/`.windsurfrules` from a single source (no more manual maintenance)
- GitHub Actions `check-drift.yml` — fails the PR if generated files are out of sync
- `evals/evals.json` — 6 test prompts for measuring the skill's effectiveness
- `examples/web-app-skeleton/` — the first real web app example (login + RPC + Lock)
- Synced the 10 core principles across every entry point (SKILL.md / AGENTS.md / .cursorrules / .clinerules / .windsurfrules)
- SKILL.md description — added trigger keywords and the new topics (triggers, doGet/doPost, LINE, deployment)

## v0.2.0 — 2026-05-28

- Made the skill portable: Cursor / Windsurf / Cline / Copilot / ChatGPT / Gemini support (`.cursorrules`, `AGENTS.md`, `PROMPT.md`)
- Added `check.sh` / `update.sh` for status checks and self-update

## v0.1.0 — 2026-05-28

- First version: 16 rule files for Claude Code plus bilingual install instructions