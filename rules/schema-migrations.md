# Schema Migrations — Adding tables/columns without breaking existing data

## Rule #1: idempotent `ensureSchema()` — must be safe no matter how many times it runs

**Why:** cloning the project → setup has to run; a new deploy → new columns have to be added; an existing user opening it → nothing old must break

### ✓ Good — declarative schema + ensure helpers

```javascript
const SHEET_NAMES = {
  CONFIG: 'Config',
  USERS: 'Users',
  RECORDS: 'Records',
  FOLDERS: 'Folders',
  AUDIT: 'Audit',
};

const SCHEMA = {
  Config: ['Key', 'Value'],
  Users: ['UserID', 'Username', 'DisplayName', 'Role', 'PasswordHash', 'PasswordSalt', 'Active', 'SignatureFileId', 'CreatedAt'],
  Records: ['RecordID', 'Timestamp', 'FolderID', 'TeacherUserID', 'Term', 'Year', /* ... */],
  Folders: ['FolderID', 'TeacherName', 'Subject', 'ClassLevel', 'Timestamp', 'OwnerUserID'],
  Audit: ['Timestamp', 'Actor', 'Action', 'Target', 'Detail'],
};

function ensureSchema() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  for (const name in SCHEMA) {
    ensureSheet_(ss, name, SCHEMA[name]);
  }
  ensureConfigEntry_(ss, 'TEACHERS_FOLDER_ID', () => createDriveFolderIfMissing_('TPM_Teachers'));
  ensureConfigEntry_(ss, 'SIGNATURES_FOLDER_ID', () => createDriveFolderIfMissing_('TPM_Signatures'));
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#d81b60').setFontColor('white');
    sh.setFrozenRows(1);
  } else {
    // append any missing columns at the end of the table
    for (const h of headers) ensureColumn_(sh, h);
  }
  return sh;
}

function ensureColumn_(sheet, headerName) {
  const lastCol = sheet.getLastColumn() || 1;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (headers.indexOf(headerName) >= 0) return;
  sheet.getRange(1, lastCol + 1).setValue(headerName)
    .setFontWeight('bold').setBackground('#d81b60').setFontColor('white');
}
```

---

## Rule #2: cache `ensureSchema()` per execution — never run it twice inside one function

```javascript
let _schemaEnsured = false;

function ensureSchemaCached_() {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  ensureSchema();
}

// call this at the entry point of every function that touches a sheet
function saveRecord(callerUserId, payload) {
  ensureSchemaCached_();
  // ...
}
```

**Why:** `ensureSchema()` reads sheets many times — running it on every RPC call costs ~500ms each time

---

## Rule #3: New column — a default value for old rows

After `ensureColumn_` adds a column, old rows end up holding `''` (empty string)

If the default must not be empty:

```javascript
function migrateActiveColumn_(sheet) {
  const col = colIndex_(sheet, 'Active');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, col, lastRow - 1, 1);
  const values = range.getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] == null) {
      values[i][0] = true; // default Active = true
      changed = true;
    }
  }
  if (changed) range.setValues(values);
}
```

Run it inside `ensureSchema()` once per deploy (track it with the Config flag `MIGRATION_V2_DONE`)

---

## Rule #4: never rename a column in place — add the new one + copy + drop the old one later

```javascript
function migrateRenameUsernameToEmail_(sheet) {
  // Step 1 (deploy A): add the Email column, copy it from Username
  ensureColumn_(sheet, 'Email');
  const usernameCol = colIndex_(sheet, 'Username');
  const emailCol = colIndex_(sheet, 'Email');
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const values = sheet.getRange(2, usernameCol, lastRow - 1, 1).getValues();
    sheet.getRange(2, emailCol, lastRow - 1, 1).setValues(values);
  }
  // Step 2 (deploy B, once the code no longer reads Username): drop Username
  // never drop it in the same deploy as Step 1
}
```

---

## Rule #5: track the migration version in the Config sheet

```
Config:
| Key                | Value     |
| SCHEMA_VERSION     | 5         |
```

```javascript
function ensureSchema() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const current = Number(getConfig_('SCHEMA_VERSION') || '0');

  if (current < 1) { migrateV1_(ss); setConfig_('SCHEMA_VERSION', '1'); }
  if (current < 2) { migrateV2_(ss); setConfig_('SCHEMA_VERSION', '2'); }
  if (current < 3) { migrateV3_(ss); setConfig_('SCHEMA_VERSION', '3'); }
  // append new migrations at the end — never edit an existing one
}
```

---

## Rule #6: Template files (PdfTemplate, samples, etc.) — create them from code when missing

```javascript
function ensurePdfTemplate_(ss) {
  let tpl = ss.getSheetByName('PdfTemplate');
  if (tpl) return tpl;
  tpl = ss.insertSheet('PdfTemplate');
  tpl.getRange('A1').setValue('Post-teaching record');
  tpl.getRange('A2').setValue('{{TERM_LABEL}}');
  // ...
  return tpl;
}
```

Or ship a document the admin imports through a menu:

```javascript
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚙️ Admin')
    .addItem('Import default PdfTemplate', 'importDefaultTemplate')
    .addToUi();
}
```

---

## Rule #7: log each migration as an Audit row

```javascript
function migrateV2_(ss) {
  // ... do migration ...
  appendRowByHeaders_(ss.getSheetByName('Audit'), {
    Timestamp: new Date().toISOString(),
    Actor: 'system',
    Action: 'migrate',
    Target: 'v2',
    Detail: 'Added Active column to Users',
  });
}
```

Makes post-deploy debugging easy — "where did this column come from?"