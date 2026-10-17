# Spreadsheet Operations

**Contents:**

| Rule | Topic |
|---|---|
| #1 | Read the sheet once (bulk read) |
| #2 | merged cells vs `setValues()` — per-cell / batch only in safe zones |
| #3 | append row in header order |
| #4 | column index lookup by header name |
| #5 | `flush()` after a mutation |
| #6 (.1–.5) | Date object — serialize, timezone, ISO string, parse Buddhist Era input |
| #6.6 | leading zeros (phone numbers, IDs) — force text format |
| #7 | % columns — store as string |
| #8 | recompute on the server — never trust the client |

## Rule #1: read the sheet once with `getDataRange().getValues()`

**Why:** every `getValue()`/`getRange()` call is a round-trip to the Google server — 1 sheet × 100 rows × 10 cols = 1,000 calls = you blow past the quota timeout (6 min)

### ✗ Bad — N+1 calls

```javascript
for (let i = 2; i <= sheet.getLastRow(); i++) {
  const id = sheet.getRange(i, 1).getValue();  // round-trip
  const name = sheet.getRange(i, 2).getValue(); // round-trip
  // ...
}
```

### ✓ Good — bulk read

```javascript
function readSheet_(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues(); // 1 round-trip
  if (data.length <= 1) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const o = {};
    for (let j = 0; j < headers.length; j++) o[headers[j]] = data[i][j];
    o.__rowIndex = i + 1; // 1-based sheet row, for later updates
    rows.push(o);
  }
  return rows;
}
```

---

## Rule #2: never call `range.setValues()` on a sheet that may contain merged cells

**Why:** `range.setValues(values)` throws `Exception: Service error: Spreadsheet` (Spreadsheet service error) if the range contains merged cells — Sheets does not allow writing multiple values across a single merge

This is a bug you actually hit with **PDF templates that use placeholders** (`{{PLACEHOLDER}}`) — almost every template has a merged header row

### ✗ Bad

```javascript
const range = sheet.getDataRange();
const values = range.getValues();
// ...modify values...
range.setValues(values); // 💥 if merged cells are present
```

### ✓ Good — per-cell setValue only where something changed

```javascript
const range = sheet.getDataRange();
const values = range.getValues();
for (let r = 0; r < values.length; r++) {
  for (let c = 0; c < values[r].length; c++) {
    const orig = values[r][c];
    // ...compute next...
    if (next !== orig) {
      try {
        sheet.getRange(r + 1, c + 1).setValue(next);
      } catch (e) {
        Logger.log('skip r=' + (r + 1) + ' c=' + (c + 1) + ': ' + e.message);
      }
    }
  }
}
```

**Trade-off:** per-cell writes are slow (1 round-trip per cell) — fine for PDF templates where only a few dozen cells change, but **never use them on data tables with thousands of cells** (hits the 6-minute limit)

### ✓ Better for large ranges — check merged ranges first, then batch-write only the safe zones

```javascript
function hasMergedCells_(range) {
  return range.getMergedRanges().length > 0;
}

const range = sheet.getDataRange();
if (!hasMergedCells_(range)) {
  range.setValues(values);          // no merges → batch write, fastest
} else {
  // merges exist (usually the top header rows of a template) → batch write only the data part
  const dataRange = sheet.getRange(headerRows + 1, 1, values.length - headerRows, values[0].length);
  if (!hasMergedCells_(dataRange)) {
    dataRange.setValues(values.slice(headerRows));
  } else {
    // merges scattered everywhere → fall back to per-cell writes for changed cells only (see above)
  }
}
```

---

## Rule #3: append rows in header order — never hardcode column indexes

**Why:** if someone inserts a column in the middle of the table, position-based indexes shift → data breaks silently

### ✓ Good

```javascript
function appendRowByHeaders_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(h => obj[h] != null ? obj[h] : ''));
}

// Usage
appendRowByHeaders_(sh, {
  RecordID: 'REC001',
  Timestamp: new Date().toISOString(),
  Status: 'pending',
  // not every column is required — missing ones become ''
});
```

---

## Rule #4: column index lookup by header name

```javascript
function colIndex_(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headers.indexOf(headerName);
  if (idx < 0) throw new Error('Column not found: ' + headerName);
  return idx + 1; // 1-based
}

// Update a single column of a single row
sheet.getRange(rowIndex, colIndex_(sheet, 'Status')).setValue('approved');
```

---

## Rule #5: call `SpreadsheetApp.flush()` after a mutation, before re-reading or returning

**Why:** Apps Script batches writes — if you read immediately without flushing, you can get stale values

```javascript
sh.getRange(rowIndex, colIndex_(sh, 'Status')).setValue('approved');
SpreadsheetApp.flush();
// reading now returns the new value
```

---

## Rule #6: handling Date objects — three traps to watch

Dates in GAS break easily because they cross 3 boundaries: **Sheet ↔ GAS server ↔ client browser** — and each boundary has its own gotcha

### #6.1 — `google.script.run` does not serialize `Date` objects → the client receives `{}`

```javascript
// ✗ Bad
function getRecord() {
  return { Timestamp: new Date() }; // client gets an empty {}
}

// ✓ Good — convert to an ISO string before sending to the client
function sanitizeForClient_(obj) {
  const out = {};
  for (const k in obj) {
    if (k === '__rowIndex') continue;
    const v = obj[k];
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = sanitizeForClient_(v);
    else out[k] = v;
  }
  return out;
}
```

### #6.2 — a Sheet cell of Date type comes back as a Date object, not a string

`getDataRange().getValues()` returns the cell type as Sheets stored it — if a user types `28/5/2026`, **Sheets converts it to a Date object** (not the string "28/5/2026")

```javascript
// ✗ Bad — assume string always
const ts = row.Timestamp;
console.log(ts.indexOf('2026')); // 💥 if ts is a Date — .indexOf is not a function

// ✓ Good — normalize every time
function toIsoOrEmpty_(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}
```

### #6.3 — Timezone trap: GAS server vs spreadsheet vs client

3 timezones that can differ:
- **Script timezone** — set in `appsscript.json` (`"timeZone": "Asia/Bangkok"`)
- **Spreadsheet timezone** — File → Settings → Time zone (may differ from the script's!)
- **Client browser** — the user's TZ

```javascript
// ✗ Bad — toLocaleDateString() uses the server TZ, not the user's
const display = new Date().toLocaleDateString('th-TH');

// ✓ Good — force the TZ you want
const display = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
// → "28/05/2026 14:30"

// ✓ Good — send ISO to the client and let the client format it (per locale)
return { ts: new Date().toISOString() }; // ISO = UTC
```

### #6.4 — store timestamps in the sheet as ISO strings, not Date type

**Why:** a Date type cell is rendered according to the **spreadsheet timezone** + the cell's display format — if an admin changes the spreadsheet TZ, the value shifts

```javascript
// ✗ Risky — store a Date object
appendRowByHeaders_(sh, { Timestamp: new Date() });
// Sheet renders in the spreadsheet TZ — change the TZ → value shifts

// ✓ Robust — store an ISO string (TZ-aware, never shifts)
appendRowByHeaders_(sh, { Timestamp: new Date().toISOString() });
// "2026-05-28T07:30:00.000Z" — fixed value, independent of the sheet TZ
```

But you must set the **column format to Plain text** first — otherwise Sheets may auto-parse the ISO string into a Date

### #6.5 — parse user input that may be a date in several formats

```javascript
function parseThaiDate_(input) {
  if (input instanceof Date) return input;
  const s = String(input || '').trim();
  if (!s) return null;

  // ISO: 2026-05-28T... or 2026-05-28
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);

  // dd/MM/yyyy or dd/MM/yy (Buddhist Era years also work)
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    y = parseInt(y);
    if (y > 2400) y -= 543;          // Buddhist Era → Gregorian
    else if (y < 100) y += 2000;     // 2-digit year
    return new Date(y, parseInt(mo) - 1, parseInt(d));
  }
  return null;
}
```

---

## Rule #6.6: force numeric fields with leading zeros to be text — prevent zero loss

**Real bug:** storing phone number `0812345678` in a Sheet → becomes `812345678` (the leading 0 disappears) because Sheets auto-parses it as a number

Fields to watch:
- phone numbers (`08x-xxx-xxxx`)
- 13-digit national ID numbers (may start with 0 in some cases)
- postal codes (`10110` is fine but `01234` → `1234`)
- bank account numbers
- PO / invoice numbers with a prefix (`PO0001`, `INV0042`)
- teacher/student IDs (`T0001`, `S0042`)
- numeric RecordIDs (we have seen `0001` turn into `1`)

### Approach 1: set column format = Plain text first (recommended)

```javascript
function ensureTextColumn_(sheet, headerName) {
  const col = colIndex_(sheet, headerName);
  const lastRow = Math.max(sheet.getMaxRows(), 1000);
  sheet.getRange(1, col, lastRow, 1).setNumberFormat('@');
}

// call inside ensureSchema()
function ensureSchema() {
  const sh = ss.getSheetByName('Users');
  ensureColumn_(sh, 'Phone');
  ensureColumn_(sh, 'NationalId');
  ensureColumn_(sh, 'EmployeeCode');

  ensureTextColumn_(sh, 'Phone');         // 📌
  ensureTextColumn_(sh, 'NationalId');    // 📌
  ensureTextColumn_(sh, 'EmployeeCode');  // 📌
}
```

`setNumberFormat('@')` = `@` is the text format code — numbers are stored as plain strings, never parsed

### Approach 2: prefix the value with `'` (apostrophe)

```javascript
// ✗ Bad
sh.getRange(row, col).setValue('0812345678'); // still auto-parsed → 812345678

// ✓ Good — leading apostrophe forces the sheet to store text
sh.getRange(row, col).setValue("'" + phone);  // stores "0812345678" correctly
// the sheet does not display the apostrophe (it is an escape character)
```

**Caveat:** if you use `appendRow([...])` or `setValues([[...]])` with several values at once — you must add the apostrophe to every cell that should be text

### Approach 3: helper for append that forces text on specified fields

```javascript
const TEXT_FIELDS = ['Phone', 'NationalId', 'EmployeeCode', 'StudentId', 'PostalCode'];

function appendRowSafe_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => {
    const v = obj[h];
    if (v == null) return '';
    // store numeric fields that may have leading zeros as text
    if (TEXT_FIELDS.includes(h) && /^\d/.test(String(v))) {
      return "'" + String(v);
    }
    return v;
  });
  sheet.appendRow(row);
}
```

### ✓ Defense in depth — use both column format + apostrophe

```javascript
// 1. ensureSchema sets column format = '@'
ensureTextColumn_(sh, 'Phone');

// 2. helper adds the apostrophe on write
appendRowSafe_(sh, { Phone: payload.phone });

// 3. validate input on the server
if (!/^0\d{8,9}$/.test(payload.phone)) throw new Error('Invalid phone number');
```

### ⚠️ Pitfall: a format set later does not apply retroactively

If the sheet already holds data and the format is `Automatic`, the number `0812345678` has already been parsed into `812345678`
Calling `setNumberFormat('@')` afterwards **will not bring the leading zero back** — the cell already holds the number 812345678

**Do:**
```javascript
// migration: put the 0 back on phones that lost it
function migratePhoneFormat_(sh) {
  ensureTextColumn_(sh, 'Phone');
  const col = colIndex_(sh, 'Phone');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const range = sh.getRange(2, col, lastRow - 1, 1);
  const values = range.getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (typeof v === 'number' || /^\d+$/.test(String(v))) {
      const s = String(v);
      if (s.length === 9) { // 9 digits = probably lost the leading 0
        values[i][0] = "'0" + s;
        changed = true;
      }
    }
  }
  if (changed) range.setValues(values);
}
```

### ⚠️ Pitfall: setValues with an array is auto-parsed too

```javascript
// ✗ Bad — "0812345678" in an array is parsed into 812345678 before the write
sh.getRange(2, 1, 1, 2).setValues([['0812345678', '0123456789012']]);

// ✓ Good — apostrophe on every cell
sh.getRange(2, 1, 1, 2).setValues([["'0812345678", "'0123456789012"]]);
```

---

## Rule #7: numeric columns displayed as % — store as string, not number

**Why:** if the column format = `0%` and you write the number `100`, Sheets converts it to `10000%`
If the format = `0"%"` (text suffix), writing `100` gives `100%`

**The safe route:** write the string `"100.00"` + set the column format to `Plain text` or `0.00"%"`

---

## Rule #8: recompute on the server — never trust values from the client

**Real bug we hit:** the client computed `(pass/total)*100 = 500%` (because total changed while filling the form) and the server stored it as-is

### ✓ Good

```javascript
function saveRecord(callerUserId, payload) {
  const total = parseInt(payload.totalStudents) || 0;
  let pass = parseInt(payload.passCount) || 0;
  if (pass > total) pass = total; // clamp
  const fail = Math.max(0, total - pass);
  const passPct = total > 0 ? ((pass / total) * 100).toFixed(2) : '0.00';
  // use the recomputed value, not payload.passPercent
}
```
