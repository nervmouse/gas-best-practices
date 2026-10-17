# Logging at Data Boundaries

## Rule #1: Log both sides of every RPC boundary — client + server

**Why:** when a bug reports "I hit save and got an unknown error" — without logs at the boundary you cannot tell:
- what the payload looked like leaving the client
- what arrived at the server (missing fields? wrong type?)
- what the server returned
- whether the client interpreted the return correctly

User reports bug → ask for a "console screenshot", get it instantly (F12 → Console)

---

## Rule #2: Client — `console.log` before sending + after receiving every RPC

### ✓ Good — wrap `rpc()` so logging is automatic

```javascript
function rpc(name, ...args) {
  const t0 = Date.now();
  console.log('→ RPC', name, args);
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((res) => {
        console.log('← RPC', name, (Date.now() - t0) + 'ms', res);
        resolve(res);
      })
      .withFailureHandler((err) => {
        console.error('✗ RPC', name, (Date.now() - t0) + 'ms', err);
        reject(err);
      })
      [name](...args);
  });
}
```

What you see in the Console:

```
→ RPC saveRecord ["U002", {folderId: "...", totalStudents: 20, ...}]
← RPC saveRecord 312ms {ok: true, recordId: "REC1234..."}
```

On a bug — you immediately see where the payload changed or whether the server was slow

---

## Rule #3: Server — `Logger.log` entry + exit for every function the client calls

```javascript
function saveRecord(callerUserId, payload) {
  Logger.log('[saveRecord] in caller=' + callerUserId + ' keys=' + Object.keys(payload || {}).join(','));
  try {
    const caller = requireUser_(callerUserId);
    // ... mutation ...
    Logger.log('[saveRecord] out ok recordId=' + recordId);
    return { ok: true, recordId: recordId };
  } catch (err) {
    Logger.log('[saveRecord] out ERR ' + (err.stack || err.message));
    return { ok: false, message: err.message };
  }
}
```

**Standard format:**
- `[FuncName] in <key params>` — entry
- `[FuncName] step:<name>` — important step (read DB, validate, write, external API)
- `[FuncName] out ok <key result>` — success
- `[FuncName] out ERR <message>` — error

---

## Rule #4: Never log sensitive data — mask it first

```javascript
// ✗ Bad
console.log('→ RPC login', username, password);
Logger.log('[login] password=' + password);

// ✓ Good — mask
console.log('→ RPC login', username, '***');
Logger.log('[login] passwordLen=' + (password || '').length);
```

Data that must be masked:
- password, OTP, token, API key
- national ID number (keep last 4 digits: `***-***1234`)
- credit card number
- email / phone number if the system treats it as sensitive (PII)

---

## Rule #5: log payload size — know it is large before you hit quota

```javascript
function rpc(name, ...args) {
  const argSize = JSON.stringify(args).length;
  if (argSize > 100000) console.warn('⚠ RPC large payload', name, argSize, 'bytes');
  console.log('→ RPC', name, argSize + 'b', args);
  // ...
}
```

Server fallback:
```javascript
function saveLargePayload(callerUserId, payload) {
  const sz = JSON.stringify(payload || {}).length;
  Logger.log('[saveLargePayload] size=' + sz);
  if (sz > 5 * 1024 * 1024) throw new Error('payload exceeds 5MB');
  // ...
}
```

---

## Rule #6: log version + build identifier at boot

Helps when a user reports a bug — you know which version they are on

### Client

```html
<!-- Index.html -->
<script>
  window.APP_VERSION = '2026.05.28-1';
  console.log('App boot', window.APP_VERSION, navigator.userAgent);
</script>
```

### Server

```javascript
const APP_VERSION = '2026.05.28-1';

function doGet() {
  Logger.log('[doGet] v=' + APP_VERSION + ' user=' + Session.getActiveUser().getEmail());
  return HtmlService.createHtmlOutputFromFile('Index');
}
```

When the user sends a console screenshot — the very first line tells you which build they ran

---

## Rule #7: group logs for complex flows

```javascript
async function doSaveAndOpenPdf() {
  console.group('🎯 doSaveAndOpenPdf');
  try {
    console.log('1. validate form');
    const valid = validateForm();
    if (!valid) { console.warn('   form invalid'); return; }

    console.log('2. save record');
    const saveRes = await rpc('saveRecord', this.user.userId, this.form);

    console.log('3. generate PDF');
    const pdfRes = await rpc('generatePdf', this.user.userId, saveRes.recordId);

    console.log('4. open URL', pdfRes.url);
    window.open(pdfRes.url);
  } catch (e) {
    console.error('flow failed', e);
  } finally {
    console.groupEnd();
  }
}
```

Browser DevTools can collapse it — no console clutter when you are not debugging

---

## Rule #8: production toggle — `__DEBUG__` flag

```javascript
// Index.html
<script>
  window.__DEBUG__ = (new URLSearchParams(location.search)).get('debug') === '1';
</script>
```

```javascript
function dlog(...args) {
  if (window.__DEBUG__) console.log(...args);
}

// Replace bare console.log calls
dlog('→ RPC', name, args);
```

User reports bug → "open it with `?debug=1`" → verbose logs instantly, no redeploy needed

As for `console.error` / `console.warn` — **never gate them** with the debug flag, let them through always (they signal a real problem)

---

## Rule #9: Server log for external calls (UrlFetch, MailApp)

Every outbound call needs:
- a request log before the call (URL, method, body keys)
- a response log after the response (status, body length, time)

```javascript
function callLineApi_(payload) {
  const t0 = Date.now();
  Logger.log('[LINE] → ' + payload.to + ' type=' + payload.messages[0].type);
  const resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + getApiKey_('LINE_TOKEN'), 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  Logger.log('[LINE] ← ' + code + ' ' + (Date.now() - t0) + 'ms ' + (code >= 400 ? body : 'OK'));
  if (code >= 400) throw new Error('LINE API failed: ' + code + ' ' + body);
  return JSON.parse(body || '{}');
}
```

---

## Rule #10: client logs the user can see — make it copyable

Add a "Copy debug info" button for low-tech users:

```html
<button @click="copyDebugInfo()">📋 Copy debug info</button>
<script>
  async function copyDebugInfo() {
    const info = {
      version: window.APP_VERSION,
      url: location.href,
      userAgent: navigator.userAgent,
      time: new Date().toISOString(),
      user: window.app?.user?.userId,
      lastError: window.__lastError,
    };
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
    alert('Copied — paste it into a LINE chat / email and send it to the admin');
  }

  // dump last error
  window.addEventListener('error', (e) => {
    window.__lastError = { message: e.message, source: e.filename, line: e.lineno };
  });
</script>
```

The user never has to open F12 — one button click gives full context

---

## Rule #11: server execution log — tell the user where to look

In the docs for admin/dev:

> To view server logs: open the Apps Script editor → click the **Executions** menu (⏱ icon on the left) → click the execution of the function you care about → you see every `Logger.log` + timestamp + duration

```javascript
// Make filtering easy — a unique prefix per feature
Logger.log('[PDF.gen] start...');
Logger.log('[Auth.login] ...');
Logger.log('[Record.save] ...');
```

Filter in Executions: type `PDF` → you see only the logs of the PDF feature

---

## Rule #12: log retention — GAS keeps execution logs for only ~7 days

If you need a longer audit trail → append to a Logs sheet:

```javascript
function audit_(category, action, detail) {
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Audit');
    sh.appendRow([
      new Date().toISOString(),
      Session.getActiveUser().getEmail(),
      category,
      action,
      JSON.stringify(detail || {}),
    ]);
  } catch (e) {
    Logger.log('[audit] failed: ' + e.message);
  }
}

// Usage
audit_('Record', 'delete', { recordId: rec.RecordID, by: caller.UserID });
```

**Do not log every call into the sheet** — only mutation/security events (login, delete, approve, payment). For every call, `Logger.log` is enough
