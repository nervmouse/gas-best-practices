# Deployment & Versioning (clasp)

## Rule #1: `clasp push` does not change the production web app — you must create a new version of the deployment

**Why:** the classic number-one beginner GAS bug — push the code, open `/exec`, and see nothing new, because a versioned deployment **pins the code at the version you deployed**

| URL | Runs code from | Who can access |
|---|---|---|
| `.../dev` | **HEAD** (the latest pushed code) | only people with script edit rights |
| `.../exec` | **the deployed version** | per `webapp.access` |

### ✓ The correct flow

```bash
clasp push                      # upload the code to HEAD
# test via the /dev URL first
clasp deploy -i <deploymentId> -d "v12 fix pdf margin"   # update the existing deployment → /exec changes
```

---

## Rule #2: Update the **same** deployment (`-i <deploymentId>`) — never run bare `clasp deploy` again

**Why:** `clasp deploy` without `-i` creates a **new** deployment with a **new URL** — the links you already sent to users / embedded in a LINE rich menu / QR code keep pointing at the old deployment running the old code

```bash
# see existing deployments
clasp deployments
# - AKfycb...XYZ @12 - production

# ✓ deploy over the existing one — the URL stays the same
clasp deploy -i AKfycb...XYZ -d "v13 add export excel"
```

In the Apps Script editor: **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy** (same result)

---

## Rule #3: Use 2 deployments — `dev` and `production`

**Why:** testing on the same URL users really use = users find bugs before you do

```
Deployment "production"  → the URL handed to real users — update only after testing passes
Deployment "staging"     → URL for the testing team — update often
HEAD (/dev)              → developers only — changes on every push
```

Keep both deployment IDs in the project README — prevents mixing up which is which

---

## Rule #4: Record version + date + change summary in the description every time

**Why:** when production breaks, the first question is "what did the latest version change, and which version should we roll back to?" — an empty description answers nothing

```bash
clasp deploy -i <id> -d "2026-08-14 v14: fix leading zero phone (spreadsheet-ops #6.6)"
```

**Rollback:** Manage deployments → edit → pick the old version → Deploy (same URL, code rolls back)

---

## Rule #5: Embed a version string in the code — so you can check which one the user is running

**Why:** when a user reports a bug the question is "which version are you on?" — browser cache can put the frontend and the backend on different versions (see the version stamp topic in `rules/logging-boundaries.md`)

```javascript
const APP_VERSION = 'v14-2026-08-14';

function getAppInfo() {
  return { ok: true, version: APP_VERSION };
}
```

Show the version in the page footer + log it on every important RPC call

---

## Rule #6: `.claspignore` — never push non-source files into Apps Script

**Why:** clasp pushes every file in the folder by default — README, test files, sample `.env` all show up in the Apps Script editor (and every `.js` file becomes runnable server code)

```
# .claspignore
**/**
!*.js
!*.html
!appsscript.json
```

(allowlist-style patterns — name only what you want to push)

---

## Rule #7: Changing `webapp.access` / `executeAs` always requires a new deployment version

**Why:** values in `appsscript.json` take effect at deploy time — editing the file and pushing is not enough, and changing `executeAs` can make Google re-request authorization for all scopes — tell users in advance, or the whole organization panics when the permission screen appears
