# Project Structure

## Rule: use clasp + split files by domain, not by type

**Why:** The web-based Apps Script editor shows every file as a flat list — naming files after the domain (`Users.js`, `Records.js`, `PdfGen.js`) is far easier to find than `models.js` / `controllers.js`

### ✗ Bad — everything in a single Code.gs

```
Code.gs   (2000 lines)
```

### ✓ Good — split by domain

```
project/
├── .clasp.json
├── appsscript.json
├── Code.gs           ← bootstrap + schema + getConfig_ + shared utilities
├── Users.js          ← login, requireUser_, requireRole_, password
├── Records.js        ← record/folder CRUD
├── Signature.js      ← signature upload/delete
├── PdfGen.js         ← PDF template + export
└── Index.html        ← single-page web app
```

## Rule: `.clasp.json` must be committed, but secret-bearing `*.json` must not

`.clasp.json` holds `scriptId` (not a secret) — safe to commit
`.clasprc.json` in the home directory holds the OAuth token — **never commit it**

```
# .gitignore
node_modules/
.clasprc.json
```

## Rule: appsscript.json must force a timezone + runtimeVersion: V8

```json
{
  "timeZone": "Asia/Bangkok",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

**Why V8:** it supports ES6+ (const/let, arrow functions, template literals, spread) — the old Rhino runtime does not

**`executeAs: USER_DEPLOYING`** = the web app runs with the permissions of the deployer → users who open the page never have to grant access themselves — but every mutation must still guard the role (see `rules/security.md`)

**`access: ANYONE_ANONYMOUS`** fits systems that implement their own login (session token) — if every user has a Google account in the same domain, `DOMAIN` is safer

**Scopes in this template start at the narrowest possible** — there is no Drive scope yet because the template does not use Drive as shipped: `DriveApp` calls that write files (`createFile`, `createFolder`) require the full `drive` scope, because `DriveApp` does not accept `drive.file`, while read-only `DriveApp` usage only needs `drive.readonly` (reasoning in `rules/security.md` Rule #4)

## Rule: never commit an `appsscript.json` that carries a `webapp.deploymentId` or a foreign `scriptId`

Keep the template blank — deployment-specific values belong in the clasp deploy output

## Rule: file naming

- bootstrap/main → `Code.gs` (the Apps Script default name) or `Main.js`
- per domain → PascalCase `Users.js`, `Records.js`
- global helpers → `Utils.js`
- no leading digits, no spaces (clasp pull/push will mangle them)
