# LockService — Concurrency Control

## Rule #1: Wrap mutations that multiple users can collide on in `LockService.getScriptLock()`

**Why:** GAS runs functions in parallel — two users clicking "Generate PDF" at the same moment can:
- create a duplicate temp sheet name
- overwrite the same row
- export a PDF while the template has not been flushed yet

### ✓ Good

```javascript
function generatePdfForRecord(callerUserId, rowIndex) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('The system is processing another request, please try again in a moment');
  }
  try {
    // ... mutations that must be atomic ...
    return { ok: true, /* ... */ };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    lock.releaseLock(); // **mandatory in finally**
  }
}
```

---

## Rule #2: Pick the right lock scope

| Lock | Scope | Use when |
|---|---|---|
| `getScriptLock()` | Whole script (cross-user) | Mutations that must be atomic system-wide (PDF gen, transaction) |
| `getDocumentLock()` | That one container document only | Bound script that modifies the active doc |
| `getUserLock()` | That one user only | Stops a user spamming the same button repeatedly |

Most of the time you want `getScriptLock()` — pick `getUserLock()` only when per-user rate limiting is enough and there is no cross-user race condition to prevent

---

## Rule #3: Pick a sensible `tryLock` timeout — never 0, never oversized

- **0ms** — fails instantly if anyone holds it → users hit errors often, bad UX
- **30000ms (30s)** — long enough to wait, but not long enough for the user to feel frozen
- **> 5 minutes** — more than half the execution quota (6 min); leave it open that long and the whole script dies

### ✓ Standard values

```javascript
const TIMEOUT_PDF = 30000;       // PDF gen 30s
const TIMEOUT_QUICK_WRITE = 5000;  // append row 5s
const TIMEOUT_RARE_BATCH = 60000;  // import 100 rows 1 min
```

---

## Rule #4: Always use `finally { lock.releaseLock(); }` — even on error

**Real bug:** throw before releaseLock with no finally — the lock sticks for 6 minutes until the script times out — every request after that point fails tryLock

```javascript
// ✗ Bad
const lock = LockService.getScriptLock();
lock.waitLock(30000);
doStuff(); // if this throws → the lock sticks!
lock.releaseLock();

// ✓ Good
const lock = LockService.getScriptLock();
if (!lock.tryLock(30000)) throw new Error('busy');
try {
  doStuff();
} finally {
  lock.releaseLock();
}
```

---

## Rule #5: **Never** hold the lock around `UrlFetchApp` or any long-running trigger

**Why:** every millisecond inside the lock = blocking other users

### ✗ Bad

```javascript
const lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
  const data = UrlFetchApp.fetch('https://slow-api.com/...'); // 10 seconds
  saveToSheet(data); // fast
} finally { lock.releaseLock(); }
```

### ✓ Good — fetch outside the lock

```javascript
const data = UrlFetchApp.fetch('https://slow-api.com/...'); // 10 seconds (no lock)
const lock = LockService.getScriptLock();
if (!lock.tryLock(5000)) throw new Error('busy');
try {
  saveToSheet(data); // fast — the lock covers only this
} finally { lock.releaseLock(); }
```

---

## Rule #6: Use unique temp resource names even with a lock — defense in depth

```javascript
// even with a lock in place, use timestamp + random
const tempName = '__pdf_temp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
```

Covers the case where the lock sticks (rare, but possible) and the script forgot to clean up temp sheets from an earlier run
