# Testing & Debugging

## Rule #1: `Logger.log` on every critical path + execution boundary

**Why:** GAS has no good breakpoint debugger — logs are the source of truth

### ✓ Good — entry + exit log

```javascript
function generatePdfForRecord(callerUserId, rowIndex) {
  Logger.log('[PDF] start callerUserId=' + callerUserId + ' rowIndex=' + rowIndex);
  try {
    const record = readRecord_(rowIndex);
    Logger.log('[PDF] record=' + record.RecordID + ' status=' + record.AcademicStatus);
    // ...
    const pdfBlob = exportSheetAsPdf_(...);
    Logger.log('[PDF] export OK size=' + pdfBlob.getBytes().length);
    // ...
    Logger.log('[PDF] saved fileId=' + fileId);
    return { ok: true, /* ... */ };
  } catch (err) {
    Logger.log('[PDF] EXCEPTION: ' + (err.stack || err));
    return { ok: false, message: err.message };
  }
}
```

Read the logs: **Apps Script Editor → Executions** (left sidebar)

---

## Rule #2: always prefix logs with `[FunctionName]`

An execution log can run to hundreds of lines while debugging — filter by prefix:

```
[PDF] start callerUserId=U002
[PDF] record found: REC1779902539479
[saveRecord] payload total=20 pass=20
[PDF] EXCEPTION: ...
```

---

## Rule #3: log structured data — not one giant string concat

### ✗ Bad

```javascript
Logger.log(JSON.stringify(hugeObject));  // hard to read, truncates the stack trace
```

### ✓ Good

```javascript
Logger.log('[saveRecord] user=' + caller.UserID + ' role=' + caller.Role + ' folderId=' + payload.folderId);
```

Or when you need to inspect the whole object:

```javascript
console.log('record=', record); // V8 runtime support console.log + object
```

---

## Rule #4: manual test functions — use the Apps Script editor

Create test functions that never get committed to production:

```javascript
function _test_generatePdf() {
  const result = generatePdfForRecord('U002', 2);
  Logger.log(JSON.stringify(result, null, 2));
}
```

How to run: Apps Script editor → pick the function name from the dropdown → Run

**The `_test_` prefix** — tells you at a glance the client must never call it + is easy to grep for during cleanup

---

## Rule #5: e2e tests via fetch / curl

Once the web app is deployed — assume this endpoint:

```bash
# .env.test
WEB_APP_URL=https://script.google.com/macros/s/<id>/exec
TEST_USER_TOKEN=U002
```

```javascript
// scripts/e2e-pdf.mjs (Node)
import 'dotenv/config';

async function test_generatePdf() {
  const res = await fetch(process.env.WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: 'generatePdfForRecord',
      args: [process.env.TEST_USER_TOKEN, 2],
    }),
  });
  const data = await res.json();
  console.assert(data.ok === true, 'expected ok=true, got:', data);
  console.log('✓ generatePdf returns', data.pdfFileId);
}

test_generatePdf().catch(e => { console.error(e); process.exit(1); });
```

You must implement `doPost(e)` that dispatches by function name — **the allow-list is always part of the dispatcher** (a dispatcher that calls `globalThis[name]` directly = anyone can call any internal function, including `_test_*` and helpers that skip auth):

```javascript
const RPC_ALLOWED = ['login', 'saveRecord', 'generatePdfForRecord' /* ... */];

function doPost(e) {
  try {
    const { function: name, args } = JSON.parse(e.postData.contents);
    if (!RPC_ALLOWED.includes(name)) throw new Error('forbidden: ' + name);
    const result = globalThis[name](...args);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## Rule #6: clasp run — call a function from the CLI

```bash
clasp run 'generatePdfForRecord' --params '["U002", 2]'
```

Requires enabling the Apps Script API + OAuth setup: <https://script.google.com/home/usersettings>

---

## Rule #7: clean up state between tests

```javascript
function _test_setup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // delete leftover test records
  const sh = ss.getSheetByName('Records');
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).startsWith('TEST_')) sh.deleteRow(i + 1);
  }
}
```

---

## Rule #8: Stackdriver / Cloud Logging — for production

In `appsscript.json`:
```json
{ "exceptionLogging": "STACKDRIVER" }
```

Exceptions from every function get logged in Google Cloud Logging — view them at Apps Script editor → Executions (filter "Failed")

---

## Rule #9: timing logs — find the bottleneck

```javascript
function generatePdfForRecord(callerUserId, rowIndex) {
  const t0 = Date.now();
  // ...step 1
  Logger.log('[PDF] read ' + (Date.now() - t0) + 'ms');
  const t1 = Date.now();
  // ...step 2
  Logger.log('[PDF] fill placeholders ' + (Date.now() - t1) + 'ms');
  const t2 = Date.now();
  // ...step 3
  Logger.log('[PDF] export ' + (Date.now() - t2) + 'ms');
  Logger.log('[PDF] total ' + (Date.now() - t0) + 'ms');
}
```

GAS execution quota = 6 minutes — knowing which step is slow lets you optimize before hitting the limit

---

## Rule #10: rate limits — watch the daily quotas

| Service | Limit (Consumer) | Limit (Workspace) |
|---|---|---|
| URL Fetch | 20,000/day | 100,000/day |
| Email send | 100/day | 1,500/day |
| Triggers per script | 20 | 20 |
| Script execution time | 6 min | 6 min |
| Custom function exec | 30 s | 30 s |

Keep a counter in the Config sheet when you are near a quota — send an alert before it breaks

---

## Rule #11: never let `| grep` mask the test exit code in a deploy command

**Why:** `npm test | grep 'fail'` returns the exit code of **grep**, not the tests — `clasp deploy` once shipped to production while 3 tests were failing, because the pipe hid it

```bash
# ✗ Bad — grep's exit code masks the tests, && always passes
node --test tests/ | grep -E '^# (pass|fail)' && clasp push && clasp deploy -i "$DEPLOY_ID"

# ✓ Good — the tests decide, output is discarded
node --test tests/ > /dev/null && clasp push && clasp deploy -i "$DEPLOY_ID"

# ✓ Good — if you want the summary too, use PIPESTATUS (bash) or pipefail
set -o pipefail
node --test tests/ | tail -20 && clasp push
```

**Edge case:** the same applies to every pipeline that gates a deploy — `tee`, `head`, `sort` all mask the exit code