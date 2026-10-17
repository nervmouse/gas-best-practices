# PropertiesService (Script / User / Document properties)

## Rule #1: Pick the store at the right layer — Script vs User vs Document

| Store | Scope | Use for |
|---|---|---|
| `getScriptProperties()` | everyone using the script sees the same value | API key, system-level config, job checkpoint |
| `getUserProperties()` | separate value per Google account | personal preferences (language, default view) |
| `getDocumentProperties()` | bound to the file (for add-ons) | per-spreadsheet state inside an add-on |

**Gotcha:** a web app deployed with `executeAs: USER_DEPLOYING` + a user not signed into Google → `getUserProperties()` belongs to the **owner**, not the real user → a system with its own login (session token) must keep preferences in a Users sheet instead

---

## Rule #2: Criteria for choosing between Properties and a Config sheet

Both are key-value stores — choose based on **who needs to edit the value**:

| Store it in | When | Examples |
|---|---|---|
| **Script Properties** | secrets / values only a developer edits | API token (LINE, OpenAI), salt, job cursor |
| **Config sheet** | values a user-side admin must be able to edit without opening the script editor | folder ID, admin email, current academic year, announcement text |

**Why:** a Config sheet is editable from the Sheet page admins already know (the same principle as `rules/drive-ops.md` Rule #1) but **never put a secret in a Config sheet** — the sheet can be shared with other people, while Script Properties are readable only by people with script edit rights

```javascript
// secret → Script Properties
const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');

// admin-editable → Config sheet
const folderId = getConfig_('PDF_FOLDER_ID');
```

---

## Rule #3: Know the limits — 9KB/value, 500KB/store — never use it as a database

**Why:** Properties is a config store, not a database — storing a big JSON blob (a record list, a query result cache) randomly hits `Argument too large` as the data grows

- Real data → Sheet
- Temporary cache → `CacheService` (100KB/key, has a TTL — see `rules/cache-service.md`)
- Properties → short config values + checkpoints

---

## Rule #4: To read several values use `getProperties()` once — and cache it

**Why:** every `getProperty()` is a round-trip (tens of ms slower than a variable) — a function that reads 5 properties on every call is slow for no reason

```javascript
let _propsCache = null;
function getProps_() {
  if (!_propsCache) _propsCache = PropertiesService.getScriptProperties().getProperties();
  return _propsCache; // cached per execution — a new execution always re-reads
}
```

---

## Rule #5: Configure secrets through the UI or a setup function you delete afterwards — never leave them in source

```javascript
// ✗ Bad — the token stays in git history forever
function setup() {
  PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_TOKEN', 'AbCdEf123...');
}
```

**✓ Good — 2 ways:**
1. **UI:** Apps Script editor → Project Settings ⚙️ → Script properties → Add property (no code involved at all)
2. **Temporary:** write a setup function → run it once → **delete the code before committing** (easy to forget — the UI route is safer)

If a token has already leaked into git — revoke it and issue a new one, deleting the commit is not enough
