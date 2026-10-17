# Error Handling

## Rule #1: Result envelope for every server function — never throw

See `rules/web-app-rpc.md` Rule #1 — in short:

```javascript
function anyServerFunction(...args) {
  try {
    // ...
    return { ok: true, data: ... };
  } catch (err) {
    Logger.log('[funcName] ' + (err.stack || err));
    return { ok: false, message: err.message || String(err) };
  }
}
```

---

## Rule #2: user-facing message in the user's language — developer log in English

```javascript
function checkIn(callerUserId, visitId, lat, lng) {
  try {
    const visit = readVisit_(visitId);
    if (!visit) {
      Logger.log('[checkIn] visit not found: ' + visitId);
      throw new Error('Appointment not found, please refresh the screen');
    }
    const distance = haversine_(lat, lng, visit.HouseLat, visit.HouseLng);
    if (distance > 1000) {
      Logger.log('[checkIn] too far: ' + distance + 'm');
      throw new Error('You are more than 1 km from the patient house (measured ' + Math.round(distance) + ' m)');
    }
    // ...
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
```

**Pattern:** Logger.log for context (technical) — `err.message` for the user (actionable, in their language)

---

## Rule #3: catch + rethrow — add context

```javascript
try {
  generatePdfForRecord(...);
} catch (err) {
  throw new Error('Failed to build the PDF for record ' + recordId + ': ' + err.message);
}
```

---

## Rule #4: never swallow an error silently

```javascript
// ✗ Bad — the error disappears, no idea where it broke
try {
  doStuff();
} catch (e) {}

// ✓ Good — log it at minimum
try {
  doStuff();
} catch (e) {
  Logger.log('[doStuff] silenced: ' + (e.stack || e));
}

// ✓ Good — state clearly why swallowing it is OK
try {
  DriveApp.getFileById(oldId).setTrashed(true);
} catch (e) {
  // the file is already trashed — OK, not an error
}
```

---

## Rule #5: user-actionable error messages — not "Error"

### ✗ Bad

```javascript
throw new Error('Error');
throw new Error('Invalid input');
throw new Error('Failed');
```

### ✓ Good

```javascript
throw new Error('Please enter a subject name');
throw new Error('Password must be at least 8 characters');
throw new Error('You do not have permission to delete records belonging to others');
```

Every message answers 2 questions:
1. **What went wrong?** (what the user did wrong, or what the system hit)
2. **What to do next?** (re-enter it, contact the admin, wait and retry)

---

## Rule #6: common GAS error messages that need translating

| GAS native | Translate for the user |
|---|---|
| `Service error: Spreadsheet` | "The Sheet service is temporarily unavailable, please try again" + log the real error |
| `Service Spreadsheets failed while accessing document` | "Could not open the document — check permissions" |
| `Exception: Address unavailable` | "Could not reach the external API, please try again" |
| `Lock wait timeout` | "The system is handling other requests, please retry in a moment" |
| `Exceeded maximum execution time` | "Processing took too long — split the work into smaller batches" |

```javascript
function translateError_(err) {
  const msg = String(err.message || err);
  if (msg.includes('Service error')) {
    return 'The Sheet service is temporarily unavailable, please try again';
  }
  if (msg.includes('Lock')) {
    return 'The system is handling other requests, please retry in a moment';
  }
  if (msg.includes('execution time')) {
    return 'Processing took too long, please try again';
  }
  return msg;
}
```

---

## Rule #7: show errors in a modal on the client, not in the console

```javascript
// ✗ Bad
console.error(res.message);

// ✓ Good
Swal.fire('Error', res.message, 'error');
```

Severity levels:
- `error` (red) — cannot continue, must be fixed
- `warning` (yellow) — something is wrong but the work can continue
- `info` (blue) — just a notice

---

## Rule #8: retry pattern for transient errors

```javascript
async function rpcWithRetry(name, ...args) {
  const maxAttempts = 3;
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await rpc(name, ...args);
      if (res.ok) return res;
      // if the error is lock/transient — retry
      if (/lock|busy|timeout|service/i.test(res.message)) {
        await sleep(1000 * (i + 1));
        continue;
      }
      return res; // permanent error — do not retry
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (i + 1));
    }
  }
  return { ok: false, message: 'Could not reach the system, please try again later' };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
```