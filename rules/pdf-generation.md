# PDF Generation

Generating PDFs from a Google Sheet template — techniques that actually hold up in production

**Table of contents** (long file — jump straight to the rule that matches your task):

| Rule | Topic |
|---|---|
| #1 | placeholder pattern `{{KEY}}` in the template sheet |
| #2 | copy template → temp sheet → export → delete temp |
| #3 | export PDF via UrlFetch + OAuth token |
| #4 | insertImage anchor = always top-left — compute the offset yourself |
| #5 | preserve the image aspect ratio — never stretch |
| #6 | trim the white border off the image before upload (signature canvas) |
| #7 | cache the PDF — trash the old file before creating a new one |
| #8 | business rule guard before generating |
| #9 | locale-aware date formatting — one helper everywhere |
| #10 | get-or-generate pattern in separate endpoints |
| #11 | PDF export URL parameters — reference table |
| #12 | folder structure — store PDFs per owner |
| #13 | PDF filename — use RecordID, not the display name |

## Rule #1: use the `{{KEY}}` placeholder pattern in the template sheet

**Why:** the template can be built comfortably through the Sheets UI (formatting, fonts, alignment) without writing any layout code

```javascript
const FIELD_TO_PLACEHOLDER = {
  TeacherName: 'TEACHER_NAME',
  SubjectName: 'SUBJECT_NAME',
  // ...
};

function fillPlaceholders_(tempSheet, mapping) {
  const range = tempSheet.getDataRange();
  const values = range.getValues();
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const orig = values[r][c];
      if (typeof orig !== 'string' || orig.indexOf('{{') < 0) continue;
      let next = orig;
      for (const k in mapping) {
        if (next.indexOf('{{' + k + '}}') >= 0) {
          next = next.split('{{' + k + '}}').join(String(mapping[k] == null ? '' : mapping[k]));
        }
      }
      if (next !== orig) {
        try {
          tempSheet.getRange(r + 1, c + 1).setValue(next);
        } catch (e) {
          Logger.log('skip r=' + (r + 1) + ' c=' + (c + 1) + ': ' + e.message);
        }
      }
    }
  }
}
```

**Never use `range.setValues()`** — most templates contain merged cells (see `rules/spreadsheet-ops.md` Rule #2)

---

## Rule #2: copy template → temp sheet → export → delete temp

**Why:** never edit the template in place (it affects other users) — always copy first

```javascript
function generatePdfForRecord(callerUserId, rowIndex) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another PDF is being generated. Please retry');
  let tempSheet = null;
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const tpl = ss.getSheetByName('PdfTemplate');
    if (!tpl) throw new Error('template sheet not found');
    tempSheet = tpl.copyTo(ss);
    tempSheet.setName('__pdf_temp_' + Date.now());
    tempSheet.showSheet();

    fillPlaceholders_(tempSheet, mapping);
    SpreadsheetApp.flush();

    const pdfBlob = exportSheetAsPdf_(ss.getId(), tempSheet.getSheetId(), 'output');
    // ... save blob to Drive ...
    return { ok: true, pdfFileId: file.getId(), pdfUrl: file.getUrl() };
  } catch (err) {
    Logger.log('[PDF] ' + (err.stack || err));
    return { ok: false, message: err.message };
  } finally {
    if (tempSheet) {
      try { SpreadsheetApp.openById(SPREADSHEET_ID).deleteSheet(tempSheet); } catch (e) {}
    }
    lock.releaseLock();
  }
}
```

---

## Rule #3: export PDF via UrlFetch + OAuth token (not DriveApp)

`SpreadsheetApp` has no `exportAsPdf()` — you must fetch the `/export?format=pdf` URL

```javascript
function exportSheetAsPdf_(ssId, gid, filename) {
  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?' + [
    'format=pdf',
    'gid=' + gid,
    'portrait=true',
    'fitw=true',           // fit the content to the page width
    'size=A4',
    'gridlines=false',
    'printtitle=false',
    'sheetnames=false',
    'pagenumbers=false',
    'top_margin=0.5',
    'bottom_margin=0.5',
    'left_margin=0.5',
    'right_margin=0.5',
  ].join('&');
  const token = ScriptApp.getOAuthToken();
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('PDF export failed: HTTP ' + resp.getResponseCode());
  }
  return resp.getBlob().setName(filename + '.pdf');
}
```

**Required scope** (in `appsscript.json`):
```json
"oauthScopes": [
  "https://www.googleapis.com/auth/script.external_request"
]
```

---

## Rule #4: insertImage anchor = always top-left — the cell alignment has no effect

**Real bug:** set horizontal align = right on a cell that holds the image placeholder → the image is still flush left, because the anchor sits at the top-left of the cell

### ✓ Good — compute the offset yourself

```javascript
function insertSignatureAtPlaceholder_(sheet, placeholder, signatureBlob) {
  const pos = findCellByExact_(sheet, placeholder);
  if (!pos) return;

  const cell = sheet.getRange(pos.row, pos.col);
  const hAlign = String(cell.getHorizontalAlignment() || 'left').toLowerCase();
  const vAlign = String(cell.getVerticalAlignment() || 'top').toLowerCase();
  cell.setValue('');

  const img = sheet.insertImage(signatureBlob, pos.col, pos.row);
  const w0 = img.getWidth(), h0 = img.getHeight();
  const MAX = { width: 120, height: 40 };
  const ratio = Math.min(MAX.width / w0, MAX.height / h0, 1);
  const w = Math.round(w0 * ratio);
  const h = Math.round(h0 * ratio);
  img.setWidth(w).setHeight(h);

  const colW = sheet.getColumnWidth(pos.col);
  const rowH = sheet.getRowHeight(pos.row);
  let xOff = 0, yOff = 0;
  if (hAlign === 'right')        xOff = Math.max(0, colW - w);
  else if (hAlign === 'center')  xOff = Math.max(0, Math.round((colW - w) / 2));
  if (vAlign === 'bottom')       yOff = Math.max(0, rowH - h);
  else if (vAlign === 'middle')  yOff = Math.max(0, Math.round((rowH - h) / 2));
  img.setAnchorCellXOffset(xOff).setAnchorCellYOffset(yOff);
}

function findCellByExact_(sheet, needle) {
  const values = sheet.getDataRange().getValues();
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === needle) return { row: r + 1, col: c + 1 };
    }
  }
  return null;
}
```

---

## Rule #5: preserve the image aspect ratio — never stretch

**Why:** a signature stretched from a square into a long horizontal box looks distorted

```javascript
// ✗ Bad
img.setWidth(180).setHeight(50); // stretch fixed

// ✓ Good — fit inside the max box while preserving the ratio
const ratio = Math.min(MAX.width / w0, MAX.height / h0, 1);
img.setWidth(Math.round(w0 * ratio)).setHeight(Math.round(h0 * ratio));
```

---

## Rule #6: trim the white border off the image before upload (signature canvas)

**Why:** if the user signs in the bottom-left corner of a 600×200 canvas but uploads the whole canvas — the image is mostly whitespace, so once inserted into the PDF it covers other rows

### ✓ Good — crop before sending

```javascript
function trimCanvasToInk(srcCanvas, padding = 8) {
  const ctx = srcCanvas.getContext('2d');
  const img = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;
  let minX = srcCanvas.width, minY = srcCanvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < srcCanvas.height; y++) {
    for (let x = 0; x < srcCanvas.width; x++) {
      if (img[(y * srcCanvas.width + x) * 4 + 3] > 0) { // alpha > 0
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // empty canvas
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(srcCanvas.width - 1, maxX + padding);
  maxY = Math.min(srcCanvas.height - 1, maxY + padding);
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.fillStyle = 'white';
  octx.fillRect(0, 0, w, h);
  octx.drawImage(srcCanvas, minX, minY, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}
```

---

## Rule #7: cache the PDF — trash the old file before creating a new one

```javascript
// before generating a new PDF, trash the old file
if (record.PdfFileId) {
  try { DriveApp.getFileById(record.PdfFileId).setTrashed(true); } catch (e) {}
}
```

In the UI, add a "Regenerate" button that asks for confirmation first — in case the template changed, or the record data was updated after approval

---

## Rule #8: business rule guard before generating

```javascript
if (record.AcademicStatus !== 'PASSED' || record.DirectorStatus !== 'PASSED') {
  throw new Error('All approvals must be complete before a PDF can be generated');
}
```

Guard on both layers — server (authoritative) + client (better UX: hide the button entirely so users cannot press it by mistake)

---

## Rule #9: locale-aware date formatting — use the same helper everywhere

**Why:** dates in the Sheet are stored as a `Date` object or an ISO string — embedding them straight into the template produces `Mon May 28 2026 12:34:56 GMT+0700`, which nobody can read

### ✓ Good — one helper for every date placeholder

```javascript
// locale month names — swap in the arrays your users expect
const THAI_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                     'Jul','Aug','Sep','Oct','Nov','Dec'];
const THAI_MONTHS_FULL = ['January','February','March','April','May','June',
                          'July','August','September','October','November','December'];

function formatThaiDate_(input, opts) {
  if (!input) return '';
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = (opts && opts.full) ? THAI_MONTHS_FULL[d.getMonth()] : THAI_MONTHS[d.getMonth()];
  const year = d.getFullYear() + 543; // CE -> BE (Buddhist Era year)
  return day + ' ' + month + ' ' + year;
}

function formatThaiDateTime_(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return formatThaiDate_(d) + ' ' + hh + ':' + mm;
}

// Usage in the mapping
mapping['TEACHER_DATE']  = formatThaiDate_(record.Timestamp);             // "28 May 2569"
mapping['ACADEMIC_DATE'] = formatThaiDate_(record.AcademicApprovedAt);
mapping['CREATED_AT']    = formatThaiDateTime_(record.Timestamp);         // "28 May 2569 14:30"
```

**Edge case:** if the Sheet field is "not approved yet" (an empty value) → the helper returns `''` instead of throwing — the PDF placeholder stays a blank string, which looks clean

**Caveat:** do not use `Utilities.formatDate(date, 'Asia/Bangkok', 'd MMM yyyy')` — the Apps Script locale string emits month names in the script locale, not the one your users read, so keep your own month arrays

---

## Rule #10: cache the PDF — get-or-generate pattern in separate endpoints

**Why:** generating a PDF takes 3-5 seconds — a user reopening the same record should not wait for a regeneration every time

### ✓ Good — 2 separate endpoints

```javascript
// Endpoint #1: read the PDF (use the cache when present)
function getRecordPdfInfo(callerUserId, rowIndex) {
  try {
    const caller = requireUser_(callerUserId);
    const record = readRecord_(rowIndex);
    if (!record) throw new Error('record not found');
    if (caller.Role === 'teacher' && String(record.TeacherUserID) !== String(caller.UserID)) {
      throw new Error('permission denied');
    }

    // ⚡ cache hit — return immediately (no lock, no generation)
    if (record.PdfFileId) {
      return {
        ok: true,
        pdfFileId: record.PdfFileId,
        pdfUrl: record.PdfUrl,
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + record.PdfFileId,
      };
    }

    // guard before falling back
    if (record.AcademicStatus !== 'PASSED' || record.DirectorStatus !== 'PASSED') {
      throw new Error('All approvals must be complete before a PDF can be generated');
    }

    // cache miss — generate a new one (slow path)
    return generatePdfForRecord(callerUserId, rowIndex);
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Endpoint #2: force regeneration (the user clicks the "Regenerate" button)
// -> calls generatePdfForRecord() directly
//   that function trashes the old file first (Rule #7) then generates a new one
```

### ✓ Client-side pattern

```javascript
// "Open PDF" — fast path, load the cache immediately if present
async doOpenPdf() {
  const rec = this.modal.record;
  if (rec.PdfUrl) { window.open(rec.PdfUrl); return; }  // short-circuit on the client too
  const res = await rpc('getRecordPdfInfo', this.user.userId, rec.rowIndex);
  if (res.ok) window.open(res.pdfUrl);
}

// "Regenerate" — slow path, trash the old one and generate a new one
async doRegeneratePdf() {
  const confirm = await Swal.fire({ title: 'Regenerate?', showCancelButton: true });
  if (!confirm.isConfirmed) return;
  const res = await rpc('generatePdfForRecord', this.user.userId, rowIndex);
  if (res.ok) window.open(res.pdfUrl);
}
```

**Trade-off:** the PDF cache can go stale if the record data is edited after approval — fix it by invalidating (clearing `PdfFileId` in the sheet) on important mutations, or let the user press "Regenerate" themselves

---

## Rule #11: PDF export URL parameters — reference table

Every parameter of `/export?format=pdf` affects the resulting PDF layout, and Google does not document all of them in one place — here are the ones you actually use:

| param | common value | notes |
|---|---|---|
| `format` | `pdf` | required |
| `gid` | sheet ID (from `getSheetId()`) | required — omit it and every sheet in the spreadsheet is exported |
| `size` | `A4`, `letter`, `legal`, `0`-`9` | paper |
| `portrait` | `true` / `false` | portrait or landscape |
| `fitw` | `true` / `false` | fit the width — use `true` to stop columns from being cut off |
| `scale` | `1`-`4` | alternative to `fitw` — 1=normal, 4=fit the whole page |
| `gridlines` | `true` / `false` | gridlines (default true — usually not wanted in a PDF) |
| `printtitle` | `true` / `false` | print the spreadsheet name in the header |
| `sheetnames` | `true` / `false` | print the sheet name in the header |
| `pagenumbers` | `true` / `false` | page numbers |
| `top_margin`, `bottom_margin`, `left_margin`, `right_margin` | inches (`0.5`) | margin |
| `horizontal_alignment` | `LEFT`/`CENTER`/`RIGHT` | align the PDF content |
| `vertical_alignment` | `TOP`/`MIDDLE`/`BOTTOM` | |
| `range` | `A1:E20` | export only this range (omit = the whole sheet) |
| `r1`, `c1`, `r2`, `c2` | row/col indices (0-based) | alternative to `range` |
| `ir` | `false` | hide frozen rows when printing |
| `ic` | `false` | hide frozen columns |
| `fzr` | `true` / `false` | repeat frozen rows on every page |
| `fzc` | `true` / `false` | repeat frozen columns on every page |
| `attachment` | `true` / `false` | send the response as an attachment or inline |

### ✓ Recipe you will reuse most

```javascript
// one A4 portrait page, fit-width — e.g. a lesson record
function exportRecord_(ssId, gid, filename) {
  const params = {
    format: 'pdf',
    gid: gid,
    size: 'A4',
    portrait: true,
    fitw: true,
    gridlines: false,
    printtitle: false,
    sheetnames: false,
    pagenumbers: false,
    top_margin: 0.5,
    bottom_margin: 0.5,
    left_margin: 0.5,
    right_margin: 0.5,
  };
  return exportWithParams_(ssId, params, filename);
}

// Statement landscape A4
function exportStatement_(ssId, gid, filename) {
  return exportWithParams_(ssId, {
    format: 'pdf', gid: gid, size: 'A4',
    portrait: false, fitw: true,
    gridlines: false, sheetnames: false, pagenumbers: true,
    top_margin: 0.4, bottom_margin: 0.4, left_margin: 0.4, right_margin: 0.4,
  }, filename);
}

function exportWithParams_(ssId, params, filename) {
  const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?' + qs;
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('PDF export failed: HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
  }
  return resp.getBlob().setName(filename + '.pdf');
}
```

---

## Rule #12: folder structure — store PDFs per owner

**Why:** piling every PDF into one folder → 10,000 files in a single folder makes the Drive UI slow + you cannot share one person's folder with an accountant/HR

### ✓ Good — a 2-level structure

```
PDF_ROOT/
├── teacher1@school.ac.th/
│   ├── Thai-Grade1/         ← one folder per subject/class
│   │   ├── REC1779902539479.pdf
│   │   └── REC1779812345678.pdf
│   └── Math-Grade1/
└── teacher2@school.ac.th/
    └── ...
```

```javascript
function getOrCreateRecordFolder_(teacherUser, record) {
  // Layer 1: the teacher's folder (= username/email)
  const parentId = ensureTeacherParentFolder_(teacherUser.Username);

  // Layer 2: the subject-class folder (stored in record.FolderID, which the user created via "Create folder")
  if (record.FolderID) {
    try { return DriveApp.getFolderById(record.FolderID).getId(); } catch (e) {}
  }
  return parentId; // fallback — put it directly in the parent folder
}

function ensureTeacherParentFolder_(username) {
  const rootId = getConfig_('PDF_ROOT_FOLDER_ID');
  const root = DriveApp.getFolderById(rootId);
  const existing = root.getFoldersByName(username);
  if (existing.hasNext()) return existing.next().getId();
  return root.createFolder(username).getId();
}
```

**Cross-ref:** see `rules/drive-ops.md` Rule #1, #2 for the Config sheet + lazy folder creation

---

## Rule #13: PDF filename — use RecordID, not the display name

### ✗ Bad

```javascript
file.setName(record.SubjectName + '-' + record.ClassLevel + '-' + record.Topic + '.pdf');
// duplicate filenames when "Thai-Grade1-Lesson 1" is taught twice
// + special characters in Topic can break the URL/path
```

### ✓ Good

```javascript
file.setName(record.RecordID + '.pdf'); // "REC1779902539479.pdf"
file.setDescription(record.SubjectName + ' • ' + record.ClassLevel + ' • ' + record.Topic);
// metadata lives in the description — searchable in Drive while the filename stays unique
```

**Why:**
- RecordID is unique → no collisions → no need for `(1)`, `(2)` suffixes
- programmatic — scripts can find and delete files by ID
- backward compatible if the user later changes Topic — the old filename is still found

If you want a friendlier, human-readable name → use `file.setName(record.RecordID + ' - ' + safeFilename_(record.Topic) + '.pdf')`:

```javascript
function safeFilename_(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, '')  // forbidden in Drive
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}
```