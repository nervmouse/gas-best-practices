/**
 * Main.js — bootstrap + schema + shared utilities
 * Patterns: rules/project-structure.md, rules/spreadsheet-ops.md, rules/schema-migrations.md
 */

const APP_VERSION = 'v1-example';
const SPREADSHEET_ID = ''; // put your spreadsheet ID here — or leave empty if the script is bound to a sheet

function getSs_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
}

// ── Web app entry ─────────────────────────────────────────────
function doGet() {
  ensureSchema();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Example Record App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1'); // viewport goes in the .gs via addMetaTag or in the .html — see rules/htmlservice-frontend.md
}

// ── Schema (idempotent — safe to run repeatedly) ──────────────
function ensureSchema() {
  ensureSheet_('Users', ['UserID', 'Username', 'DisplayName', 'Role', 'PasswordHash', 'PasswordSalt', 'Active']);
  ensureSheet_('Sessions', ['Token', 'UserID', 'ExpiresAt', 'CreatedAt']);
  const records = ensureSheet_('Records', ['RecordID', 'Title', 'Phone', 'OwnerUserID', 'CreatedAt']);
  ensureTextColumn_(records, 'Phone'); // stop leading zeros from being stripped — rules/spreadsheet-ops.md Rule #6.6
  ensureSheet_('Config', ['Key', 'Value']);
}

function ensureSheet_(name, headers) {
  const ss = getSs_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }
  const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  headers.forEach(h => {
    if (existing.indexOf(h) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
  return sh;
}

function ensureTextColumn_(sheet, headerName) {
  const col = colIndex_(sheet, headerName);
  sheet.getRange(1, col, Math.max(sheet.getMaxRows(), 1000), 1).setNumberFormat('@');
}

// ── Sheet helpers (rules/spreadsheet-ops.md) ──────────────────
function readSheet_(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues(); // read once — Rule #1
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map((row, i) => {
    const o = {};
    headers.forEach((h, j) => (o[h] = row[j]));
    o.__rowIndex = i + 2;
    return o;
  });
}

function appendRowByHeaders_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(h => (obj[h] != null ? obj[h] : ''))); // map by header, never hardcode the index — Rule #3
}

function colIndex_(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = headers.indexOf(headerName);
  if (idx < 0) throw new Error('Column not found: ' + headerName);
  return idx + 1;
}

function getConfig_(key) {
  const row = readSheet_(getSs_().getSheetByName('Config')).find(r => r.Key === key);
  return row ? String(row.Value) : '';
}

// Date → ISO string before sending to the client — google.script.run cannot serialize Date (Rule #6.1)
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