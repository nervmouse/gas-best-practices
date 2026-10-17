# web-app-skeleton

A small single-page web app that covers the skill's core patterns: login (hash + session token), RPC through `google.script.run` with a Result envelope, LockService, leading-zero protection, Date serialization

## Files

| File | Patterns used |
|---|---|
| `appsscript.json` | `rules/project-structure.md` — V8, timezone, narrow scope (`spreadsheets` only because Drive is not used) |
| `Main.js` | idempotent schema, `readSheet_`, `appendRowByHeaders_`, `sanitizeForClient_` |
| `Users.js` | `rules/security.md` — hash+salt, session token, `requireSession_`/`requireRole_` |
| `Records.js` | `rules/web-app-rpc.md`, `rules/lock-service.md` — Result envelope, validation at the boundary, Lock+finally |
| `Index.html` | `rules/htmlservice-frontend.md`, `rules/logging-boundaries.md` — viewport, rpc wrapper, log boundary |

## Usage

```bash
mkdir my-app && cd my-app
clasp create --type webapp --title "my-app"
cp <skill-path>/examples/web-app-skeleton/* .
clasp push
```

1. Open the Apps Script editor → run `_setup_createAdmin` once (creates user `admin` / `changeme`)
2. Deploy → New deployment → Web app
3. Open the URL → log in → save a record
4. **Change the admin password immediately** and delete `_setup_createAdmin` before going live

## Notes

- The example is trimmed so it can be read in 5 minutes — a real system should add: purging expired sessions with a trigger, caching user lookups (`rules/cache-service.md`), an audit log (`rules/security.md` Rule #8)