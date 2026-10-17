# Data Integrity — Prevent Overwrites, Prevent Bulk Deletes, Verify After Editing

This file is about GAS that acts as the **real, non-reversible system of record** (money balances, stock, registration numbers) — a bug in this category does not make the program crash, it makes the **data quietly wrong**

| # | Rule |
|---|---|
| 1 | Force the client to send `rev` on every full overwrite — not sent = reject |
| 2 | A circuit breaker that prevents bulk deletes |
| 3 | Post-save work must sit inside try/catch — never turn a successful save into an error |
| 4 | Server-owned fields must not be overwritten by the client payload |
| 5 | Reconcile must read from **every** place the value is stored |
| 6 | Verify the result by "identity", not by "total" |

---

## Rule #1: Force the client to send `rev` on every full overwrite — not sent = reject

**Why:** this happened in production — a browser tab that had been left sitting for 3 weeks was opened again and synced its stale `localStorage` state back up, wiping 179 bookings in a single instant. The code already had a `rev` guard, but it was written as "if `rev` *is present*, then compare" — an old client that has never heard of the field sails straight through

An optimistic-lock gate that can be bypassed by simply **not sending the field** is not a gate

**Apply this to every state-changing command, not just the save button** — skip / advance / complete / postpone / cancel are all writes too (seen in the wild: the "Postpone" button on a stale card advanced the next installment that was not even due yet, and postponed entries that had already been disabled, because that command never checked the current state the way the other commands did)

- The web page sends **the state it is currently looking at** every time (the row's `rev`, or whatever value it decided from — e.g. the due date of the installment whose button was pressed)
- The server checks **inside the lock** that it still matches the real data and that the entry is still enabled, before writing — on a mismatch, reject and tell the user the data has already changed, ask them to reload
- Write one helper (`assertCurrent_(row, seen)`) and call it from **every** command, then no command can slip through

### ✗ Bad

```javascript
// passes if body.rev is undefined / '' / never sent at all
if (body.rev !== undefined && body.rev !== null && body.rev !== '' &&
    !isNaN(Number(body.rev)) && Number(body.rev) !== curRev) {
  return json_({ ok: false, conflict: true, rev: curRev, state: readState_() });
}
writeState_(body.state);
```

### ✓ Good

```javascript
var curRev = rev_();
var sentRev = Number(body.rev);

// rev not sent = old client / does not know how stale its own data is → reject
if (body.rev === undefined || body.rev === null || body.rev === '' || isNaN(sentRev)) {
  return json_({
    ok: false, conflict: true, rev: curRev, state: readState_(),
    error: 'Save request did not specify a data version — the latest data has already been loaded, please save again'
  });
}
if (sentRev !== curRev) {
  return json_({ ok: false, conflict: true, rev: curRev, state: readState_(),
                 error: 'Someone else saved first — the latest data has already been loaded' });
}
```

**Edge case:** always attach the latest `state` to a conflict response — the client can then merge immediately without firing another round trip (which on GAS = another queue cycle)

---

## Rule #2: A circuit breaker that prevents bulk deletes

**Why:** `rev` only stops "stale data overwriting new data" — it does **not** stop a client-side bug that sends corrupt state along with a perfectly valid `rev` — e.g. empty state because parsing failed. Without a ceiling, a single save can delete the entire database

The ceiling should be set from "normal user behaviour" (a person deleting 1–2 entries at a time), not from the size of the data

### ✓ Good

```javascript
var MAX_DELETES_PER_SAVE = 5;

var deletes = pendingChanges.filter(function (c) { return c.action === 'deleteBooking'; });
if (deletes.length > MAX_DELETES_PER_SAVE && body.confirmBulkDelete !== true) {
  return json_({
    ok: false, bulkDeleteBlocked: true, rev: curRev, state: readState_(),
    deleteCount: deletes.length,
    deleteNames: deletes.slice(0, 10).map(function (c) { return c.name; }),
    error: 'This request will delete ' + deletes.length + ' entries at once — the system has held it back'
  });
}
```

**Edge case:** the unlock path must be something that is "deliberately sent" (`confirmBulkDelete: true`) and there must be **no confirm button in the web UI** that a person can hit by accident — do the real deletion through a custom menu in the sheet instead ([onopen-menu.md](onopen-menu.md))

---

## Rule #3: Post-save work must sit inside try/catch — never turn a successful save into an error

**Why:** once `writeState_()` has written to the sheet = it is committed. If the `refreshSummaries_()` that follows throws, the user sees "save failed" even though the data went in perfectly well → they press it again → duplicate data

### ✗ Bad

```javascript
writeState_(body.state);
refreshSummaries_();      // a throw here = the user sees the save fail
return json_({ ok: true, rev: bumpRev_() });
```

### ✓ Good

```javascript
writeState_(body.state);
var newRev = bumpRev_();

// derived data can be repaired later, but "telling the user the wrong thing" cannot
var summaryError = null;
try {
  refreshSummaries_();
} catch (e) {
  summaryError = String(e && e.message || e);
  Logger.log('[doPost] refreshSummaries_ failed after commit: ' + summaryError);
}
return json_({ ok: true, rev: newRev, summaryError: summaryError });
```

**Edge case:** apply this to **everything that lives after the commit point** — sending mail, writing the audit log, clearing the cache, calling external APIs

---

## Rule #4: Server-owned fields must not be overwritten by the client payload

**Why:** the frontend only knows part of the data. If `writeState_` writes the whole row from the object the client sent, then values the client does not have (an amount paid in from another screen, a status the system computes itself) get blanked out — completely silent, no error

### ✗ Bad

```javascript
rows.push([b.id, b.name, b.kind, b.phone,
           Number(b.paidAmount) || '',           // the client does not know this amount → blanked out
           ST_TH[b.status] || 'unpaid']);    // a status that was already repaired gets reverted
```

### ✓ Good

```javascript
// 1) Read the server-owned values first — keep only the rows that "actually have a value"
//    Rows that are still empty do not need keeping; let the client write the first value in
var keepPaid = {}, keepStatus = {};
existingRows.forEach(function (r) {
  var id = r['code'];
  if (r['amountReceived'] !== '' && r['amountReceived'] != null) keepPaid[id] = r['amountReceived'];
  if (r['status']) keepStatus[id] = r['status'];
});

// 2) Rows where the system already owns a value = locked, do not let the client payload overwrite
var hasOwn = Object.prototype.hasOwnProperty;
var rows = body.state.bookings.map(function (b) {
  return [b.id, b.name, b.kind, b.phone,
          hasOwn.call(keepPaid, b.id)   ? keepPaid[b.id]   : (Number(b.paidAmount) || ''),
          hasOwn.call(keepStatus, b.id) ? keepStatus[b.id] : (ST_TH[b.status] || 'unpaid')];
});
```

**Edge case:** check that the "lock" is bound to a value the server genuinely holds, not a flag that was merely declared — a `locked` flag that is never actually set to `true` is completely silent and behaves as if there were no gate at all

**Edge case 2:** the cleaner path is **do not let the client send these fields at all** — change them through a dedicated endpoint (`action=recordPayment`) that checks permissions and computes server-side ([web-app-rpc.md](web-app-rpc.md) Rule: recompute critical values server-side)

---

## Rule #5: Reconcile must read from **every** place the value is stored

**Why:** you write a status-repair job for "who has already paid but still shows as outstanding" that reads only the amount column in the main table → it runs and repairs 0 entries, because the broken rows are the ones where the money was recorded in **a separate payment log sheet**, not in that column

Before writing the reconcile, trace first how many paths can write that same value

### ✓ Good

```javascript
function reconcilePaidStatus_(bookingRows, paymentRows) {
  var logPaid = {};
  paymentRows.forEach(function (p) {
    logPaid[p['bookingCode']] = (logPaid[p['bookingCode']] || 0) + (Number(p['amountReceived']) || 0);
  });

  var fixed = 0;
  bookingRows.forEach(function (b) {
    // the money can live in 2 places → take whichever exists, do not add them together (adding = double counting)
    var paid = Number(b['amountReceived']) || logPaid[b['code']] || 0;
    if (paid >= Number(b['amountDue']) && b['status'] !== 'paid') {
      sh.getRange(b._row, ST_COL).setValue('paid');  // one-way upgrade
      fixed++;
    }
  });
  return fixed;
}
```

**Edge case:** a data-repair job should move **one way only** (outstanding → paid), never downgrade automatically — if the logic wrongly upgrades, that mistake can still be audited afterwards, but a wrong downgrade wipes out a status that a person entered by hand

**Edge case 2:** after reconcile runs you must also `bumpRev_()` + invalidate the cache, otherwise the web page keeps serving the old value from cache and it looks like the job did nothing ([cache-service.md](cache-service.md) Rule #2)

---

## Rule #6: Verify the result by "identity", not by "total"

**Why:** you hand a batch of card coupons over to one department, then check "280 coupons · 63,500 baht · 0 remaining" — every check passes **but they are a different batch from the ones actually delivered into the recipient's hand**. The count is right, the identity is wrong, and an aggregate checksum cannot catch that at all

Data that has an "identity" (document number, card number, serial, seat number) must be compared **number by number**

### ✓ Good — an endpoint that checks item by item, callable both before and after the edit

```javascript
function crossCheckOne_(code) {
  var actual = readAssignedNumbers_(code);      // what the system actually holds
  var expect = readRegistryNumbers_(code);      // what the source registry says

  return {
    code: code,
    countMatch: actual.length === expect.length,
    missing: expect.filter(function (n) { return actual.indexOf(n) < 0; }),
    extra:   actual.filter(function (n) { return expect.indexOf(n) < 0; }),
    actual: fmtRuns_(actual),                   // "261-262, 280-289"
    expect: fmtRuns_(expect)
  };
}
```

There is only one acceptable result: `missing` and `extra` **both empty** — a `countMatch: true` on its own does not count

**Edge case:** compress the output into ranges (`261-262, 280-289`) so a human can still catch the mistake by eye — nobody reads a list of 280 numbers laid out one after another

**Edge case 2:** a verification tool that already exists but was never pulled out and used = it does not exist. If you have an endpoint like this, run it **before and after every edit**, then paste the results from both rounds for the user to compare
