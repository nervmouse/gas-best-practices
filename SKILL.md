---
name: gas-best-practices
description: Google Apps Script best practices for production web apps and automation - project layout with clasp, Spreadsheet/Drive ops, LockService for concurrency, ScriptCache, web app RPC pattern with Result envelopes, PDF generation with placeholders, schema migrations, data-integrity guards for overwrite and bulk-delete protection, OAuth scopes, time-driven triggers, onFormSubmit, UrlFetchApp / LINE Messaging API, email quotas, deployment versioning (/dev vs /exec), and 6-minute limit workarounds. Use whenever working with .gs/.js files in clasp projects, when appsscript.json or .clasp.json exists, when code uses SpreadsheetApp / DriveApp / HtmlService / UrlFetchApp / doGet / doPost / onEdit / google.script.run, or when the user mentions Google Apps Script, GAS, clasp, or automating Google Sheets/Forms/Drive in any way.
---

# Google Apps Script — Best Practices

Apply these rules when working with Google Apps Script code (detect it via `.clasp.json`,
`appsscript.json`, `.gs` files, or the user saying "Apps Script" / "clasp").

## How to read

Each file in `rules/` has this structure:
- **Rule** — one short statement of the rule
- **Why** — the reason (usually a real bug that has actually happened)
- **✗ Bad** — code that breaks
- **✓ Good** — the pattern that works
- **Edge cases** — exceptions, if any

The long files (spreadsheet-ops, pdf-generation, external-frontend, drive-ops) have a
table of contents at the top — jump straight to the rule that matches the task.

## When to trigger

Read the rules that match the context of the task (several files if the work overlaps):

| The user is doing | Read these rules |
|---|---|
| Setting up a new project, organizing files | `rules/project-structure.md` |
| Reading/writing a Sheet, bulk updates | `rules/spreadsheet-ops.md` |
| Building a web app that calls back via `google.script.run` | `rules/web-app-rpc.md` |
| HTML head, viewport, partial include, template syntax | `rules/htmlservice-frontend.md` |
| Using a camera / PWA / service worker — moving the frontend to GitHub Pages | `rules/external-frontend.md` |
| Generating a PDF from a template | `rules/pdf-generation.md` |
| Managing folders/files in Drive | `rules/drive-ops.md` |
| Operations multiple users could hit at the same time | `rules/lock-service.md` |
| Queries that repeat often | `rules/cache-service.md` |
| Overwriting real data, preventing bulk deletes, verifying after an edit | `rules/data-integrity.md` |
| Year/month/enum dropdowns that are not hardcoded | `rules/dynamic-dropdowns.md` |
| Auth, role checks, OAuth scopes | `rules/security.md` |
| Adding tables/columns to a system that has already shipped | `rules/schema-migrations.md` |
| Handling errors and user-facing messages | `rules/error-handling.md` |
| Custom menus in a Sheet | `rules/onopen-menu.md` |
| Debugging, logging, execution history | `rules/testing-debugging.md` |
| Logging at the RPC boundary (client + server), masking secrets, end-user debug UX | `rules/logging-boundaries.md` |
| Scheduling automatic hourly/daily jobs, onEdit, onFormSubmit | `rules/triggers.md` |
| Calling external APIs, LINE Messaging API, webhooks | `rules/urlfetch-external-api.md` |
| Deployed but the live app is not updating, /dev vs /exec, rollback, .claspignore | `rules/deployment-versioning.md` |
| Large batch jobs / exceeding the 6-minute limit | `rules/long-running-jobs.md` |
| Sending notification emails, email quota, alerting admins on error | `rules/email-notifications.md` |
| Storing API keys / config — Properties vs Config sheet | `rules/properties-service.md` |

## Core principles

1. **Every server function the client can call must return a `Result<T>` envelope** — never let a stack trace reach the client
2. **Read a sheet once with `getDataRange().getValues()`** — batch-write when there are no merged cells, write cell-by-cell only inside merged zones
3. **Lazy resource creation** — folder IDs, sheets, and columns are created automatically on startup and stored in the Config sheet
4. **Cache user lookups and repeated computations** via `CacheService.getScriptCache()`, with explicit invalidation
5. **Wrap racy mutations in `LockService.getScriptLock()`** — such as generating a PDF, or delete/append row — with `try/finally { releaseLock() }`
6. **Store admin-editable values in the Config sheet and secrets in Script Properties** — never hardcode
7. **User-facing error messages in the end user's language** + `Logger.log` in English for developers
8. **Log every RPC boundary** — `console.log` on the client, `Logger.log` on the server (entry + exit)
9. **Force text format for numeric fields with leading zeros** — phone, ID card, postal code (`setNumberFormat('@')` + apostrophe prefix)
10. **Recompute critical values server-side** — never trust percentages or totals sent from the client