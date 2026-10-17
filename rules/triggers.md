# Triggers (Time-driven / Installable)

## Rule #1: An install trigger must delete the old one first — prevent duplicate triggers

**Why:** calling `ScriptApp.newTrigger(...).create()` again (e.g. running setup twice) gives you **many overlapping triggers** — one job runs 2-3 times at once, data duplicates / emails send twice, and debugging becomes very hard because the logs do not show that it came from different triggers.

### ✗ Bad

```javascript
function setup() {
  ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(6).create();
  // run setup 3 times = 3 triggers = 3 reports sent
}
```

### ✓ Good — idempotent: delete the old ones pointing at the same function first

```javascript
function ensureTrigger_(handlerName, builderFn) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handlerName)
    .forEach(t => ScriptApp.deleteTrigger(t));
  builderFn();
}

function setup() {
  ensureTrigger_('dailyReport', () =>
    ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(6).create()
  );
}
```

**Limit:** max 20 installable triggers per script per user — going over throws at `create()`

---

## Rule #2: A trigger runs with the rights of the "installer" — not the sheet editor

**Why:** an installable `onEdit` or time-driven trigger runs as the installing account → `Session.getActiveUser()` may not be the person who edited the cell, and quota (e.g. email/day) is charged to the installing account.

- If you need to know who edited → use `e.user` (only available on the same Workspace domain) or keep a separate audit column
- Do not let multiple people install the same trigger — pick one central (service-account style) account as the installer

---

## Rule #3: Simple triggers (`onEdit`, `onOpen`) are limited — never rely on them for anything needing auth

**Why:** simple triggers run unauthorized — they cannot call `UrlFetchApp`, `MailApp`, `DriveApp` (they throw a permission error that is silent in the log)

| Need | Use |
|---|---|
| Format / validate a cell immediately on edit | simple `onEdit(e)` |
| Send email / call an API / write a Drive file when something changes | **installable** onEdit trigger |
| Scheduled work (daily/hourly) | time-driven trigger |

```javascript
// ✓ Install an installable onEdit
ScriptApp.newTrigger('onEditInstalled')
  .forSpreadsheet(SpreadsheetApp.getActive())
  .onEdit()
  .create();
```

---

## Rule #4: `onFormSubmit` — use `e.namedValues`, not `e.values`

**Why:** `e.values` is an array ordered by **column position** — the moment someone edits the form (adds/removes/moves a question) the indexes shift → you silently read the wrong fields (the same bug family as hardcoding column indexes in `rules/spreadsheet-ops.md` Rule #3)

### ✗ Bad

```javascript
function onFormSubmit(e) {
  const name = e.values[1];   // breaks the second someone reorders the form questions
  const phone = e.values[2];
}
```

### ✓ Good

```javascript
function onFormSubmit(e) {
  const name = (e.namedValues['Full name'] || [''])[0];
  const phone = (e.namedValues['Phone number'] || [''])[0];
  if (!name) { Logger.log('[onFormSubmit] missing name — form changed?'); return; }
  // ...
}
```

**Gotcha:** each key in `e.namedValues` is an **array** (a checkbox question can have multiple answers) — you must take `[0]` or `join(', ')` yourself

---

## Rule #5: A trigger handler needs a whole-body try/catch + an alert when it breaks

**Why:** a trigger runs when nobody is watching the screen — the exception vanishes into the Executions log until someone wonders "why has the report not arrived for 2 weeks?"

### ✓ Good

```javascript
function dailyReport() {
  try {
    Logger.log('[dailyReport] start');
    // ...the actual work...
    Logger.log('[dailyReport] done');
  } catch (err) {
    Logger.log('[dailyReport] EXCEPTION: ' + (err.stack || err));
    notifyAdminOnce_('dailyReport', err); // see rules/email-notifications.md Rule #4
  }
}
```

---

## Rule #6: Work inside a trigger that touches data shared with users — must also be in LockService

**Why:** a time-driven trigger and a user clicking a button in the web app can mutate the same sheet at the same time — triggers get no exemption from race conditions, use the same pattern as `rules/lock-service.md`

---

## Rule #7: Time-driven trigger times are a window, not an exact moment

**Why:** `atHour(6)` = runs sometime in 06:00–07:00 (Google spreads the load) — never design a job that must run at exactly 06:00

- Need minute-level accuracy → create a `everyMinutes(5)` trigger and check the time yourself in code, or use an external cron that calls `doGet`
- The `atHour` timezone = the timezone in `appsscript.json` — set `"timeZone": "Asia/Bangkok"` first or you get UTC times

---

## Rule #8: The app installs its own triggers on first setup — never tell the user to open the editor and run a function

**Why:** the classic "open the Apps Script editor and run `installTriggers()` once" instruction fails for anyone who is not a programmer (they do not know where the editor is, which function to pick) — so the system "never warned" even though the code was correct. Let the app install its own triggers at a moment when the owner is already using the app.

### ✓ Good — idempotent + flag + separate try/catch, called from the app's setup path

```javascript
// Safe to call many times without duplicate triggers (Rule #1) and remembers it ran
function ensureTriggers_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TRIGGERS_V') === '1') return { ok: true, already: true };
  ensureTrigger_('dailyReminder', () =>
    ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(7).create()
  );
  props.setProperty('TRIGGERS_V', '1');            // bump to '2' when the trigger set changes
  return { ok: true, already: false };
}

// 1) On first setup: after the sheet / seed data is created (a setup path the owner clicks, or lazily on the owner's first app open)
function setupFirstRun() {
  const ss = getDataSpreadsheet_();
  // ...create tabs / header row...
  try {                                            // its own try/catch — if this fails the app page must still open
    ensureTriggers_();
  } catch (err) {
    Logger.log('[setup] triggers: ' + err);        // e.g. the owner has not granted the script.scriptapp scope
  }
}

// 2) Button / status on the app's settings page — let the user see that it is on, and repair it themselves if step 1 failed
function getTriggerStatus() {
  const on = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyReminder');
  return { on, text: on ? 'On — checks every morning around 07:00' : 'Off' };
}
function enableTriggers() {                        // the "Enable automatic reminders" button in the UI
  try {
    ensureTriggers_();
    return getTriggerStatus();
  } catch (err) {
    throw new Error('Failed to enable: ' + err.message);   // the UI shows this message instead of failing silently
  }
}
```

- Declare `https://www.googleapis.com/auth/script.scriptapp` in `appsscript.json` from the start — the request then covers all scopes together at the owner's first open, instead of breaking later (see `rules/security.md` Rule #4)
- A trigger runs as the account that installed it (Rule #2) — in a web app running as the owner (`executeAs: USER_DEPLOYING`) whoever clicks the button, the trigger always belongs to the owner, which is correct
- Never call `ensureTriggers_()` on the main `doGet` path without a try/catch — an ungranted scope breaks the whole page
