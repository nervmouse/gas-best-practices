# Security

## Rule #1: Every server function the client can call needs `requireUser_` + `requireRole_`

**Why:** a web app deployed with `executeAs: USER_DEPLOYING` runs with the owner's rights — Google gives you no per-request auth from the user's side

### ✓ Good — guard every function

```javascript
function deleteRecord(callerUserId, recordId) {
  // Reference the record by RecordID, not by the row number sent from the client — rows shift all the time
  // (if someone deleted an earlier row → that same row number now points to a different record = wrong row deleted)
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) throw new Error('System is busy, please try again');
    const caller = requireUser_(callerUserId);
    if (!recordId || typeof recordId !== 'string') throw new Error('Record not found');

    const record = readSheet_(sheet).find(r => String(r.RecordID) === recordId);
    if (!record) throw new Error('Record not found');

    // a teacher can delete only their own records
    if (caller.Role === 'teacher' && String(record.TeacherUserID) !== String(caller.UserID)) {
      throw new Error('No permission to delete');
    }
    // admin/supervisor can delete anything

    sheet.deleteRow(record.__rowIndex); // row index from the fresh read, taken under the lock
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function requireUser_(callerUserId) {
  if (!callerUserId) throw new Error('Not logged in');
  const user = findUserById_(callerUserId);
  if (!user) throw new Error('User not found');
  if (user.Active === false || user.Active === 'false') throw new Error('Account is disabled');
  return user;
}

function requireRole_(user, allowedRoles) {
  if (!Array.isArray(allowedRoles)) allowedRoles = [allowedRoles];
  if (!allowedRoles.includes(user.Role)) throw new Error('No permission');
}
```

---

## Rule #2: Accept that `callerUserId` can be faked — for high-stakes work use a session token

**Limit of the token-as-userId pattern:** the client stores the userId in localStorage — anyone can edit it and drop in an admin's userId

### For internal / low-stakes work → OK

### For sensitive work → use a session token + expiry

```javascript
// Login: the server creates the token and stores it in the Session sheet with userId + expiry
function login(username, password) {
  const user = verifyPassword_(username, password);
  if (!user) return { ok: false, message: 'Wrong username/password' };

  const token = Utilities.getUuid();
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hr
  appendRowByHeaders_(getSessionSheet_(), {
    Token: token,
    UserID: user.UserID,
    ExpiresAt: expiresAt,
    CreatedAt: new Date().toISOString(),
  });
  return { ok: true, token: token, userId: user.UserID, role: user.Role };
}

// every server function takes a token instead of a userId
function requireSession_(token) {
  if (!token) throw new Error('Not logged in');
  const sessions = readSheet_(getSessionSheet_());
  const s = sessions.find(r => r.Token === token);
  if (!s) throw new Error('Session expired');
  if (Number(s.ExpiresAt) < Date.now()) throw new Error('Session expired');
  return findUserById_(s.UserID);
}
```

Trade-off: one extra sheet write per login + you must purge expired sessions with a trigger

---

## Rule #3: Store passwords/PINs as salted + peppered hashes — never iterate HMAC thousands of times

**Why:** GAS has no `crypto.subtle`, and `Utilities.computeHmacSha256Signature` is slow (several milliseconds per call) — 10,000 PBKDF2-style rounds leaves the PIN confirm button stuck on "Checking…" for almost a minute (seen for real in an expense-tracking app), and for a 4–6 digit PIN extra rounds buy nothing once someone has the hash (they can try every value in seconds anyway). What actually helps is a **pepper that is not in the sheet** and **limiting the number of failed attempts**

### ✗ Bad — stretching in GAS

```javascript
function hashPassword_(password, salt) {
  let bytes = Utilities.newBlob(password).getBytes();
  const saltBytes = Utilities.newBlob(salt).getBytes();
  for (let i = 0; i < 10000; i++) {            // ✗ nearly a minute per single login
    bytes = Utilities.computeHmacSha256Signature(bytes, saltBytes);
  }
  return Utilities.base64Encode(bytes);
}
```

### ✓ Good — one HMAC call: key = pepper in Script Properties, data = salt + password

```javascript
// the pepper is created once at setup (inside LockService so two people creating it at once don't overwrite each other) — it lives in Script Properties
// only, never in the sheet: someone who gets the whole spreadsheet still cannot guess the hash
function pepper_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty('AUTH_PEPPER');
  if (p) return p;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    p = props.getProperty('AUTH_PEPPER');
    if (!p) {
      p = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('AUTH_PEPPER', p);
    }
    return p;
  } finally {
    lock.releaseLock();
  }
}

function hashPassword_(password, salt) {
  const sig = Utilities.computeHmacSha256Signature(salt + ':' + password, pepper_());
  return Utilities.base64Encode(sig);               // ✓ one call, sub-millisecond
}

function generateSalt_() {
  return Utilities.getUuid();
}

// On create user
const salt = generateSalt_();
const hash = hashPassword_(password, salt);
// store: PasswordHash, PasswordSalt

// On login
const expected = hashPassword_(inputPassword, user.PasswordSalt);
if (expected !== user.PasswordHash) throw new Error('Wrong password');
```

**Must be paired with:** limit the number of failed attempts — count per user in CacheService (e.g. 5 misses in 15 minutes → reject until the window expires), because with a short PIN this is the real defense, not hash slowness

- If you genuinely need stretching (long admin passwords), cap it at 100–300 rounds and measure the real time in GAS first
- Never store PINs/passwords as plain text, and never keep the pepper in a sheet or in the code

---

## Rule #4: oauthScopes in appsscript.json — request only what you use

**Why:** requesting more than necessary → scary prompts at authorize time + failed audits in enterprise

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",          // read/write Sheets
    "https://www.googleapis.com/auth/drive",                 // for DriveApp (createFile/createFolder etc.) — DriveApp does not accept drive.file
    "https://www.googleapis.com/auth/script.external_request",  // UrlFetch
    "https://www.googleapis.com/auth/userinfo.email"         // read the user email
  ]
}
```

**Scope hierarchy (narrow → broad):**
- `drive.file` — only files the script created / files the user picked with a picker — **cannot be used with `DriveApp`**, only when you call the Drive REST API yourself (`UrlFetchApp` + `ScriptApp.getOAuthToken()`), with Advanced Drive Service, or with Google Picker
- `drive.readonly` — read the whole Drive ← use when `DriveApp` only reads (`getFileById`, `getFolderById`)
- `drive` — full access ← **required every time `DriveApp` writes** (`createFile`, `createFolder`, `Folder.createFile`, `setSharing`, `setTrashed`)

**DriveApp vs `drive.file` (seen for real):** declare `drive.file`, then call `DriveApp.createFolder()` → runtime error `The permissions specified are insufficient to call DriveApp.createFolder; the required permission is https://www.googleapis.com/auth/drive` (in English: "The script does not have permission to perform that action. Required permissions: https://www.googleapis.com/auth/drive") — the `DriveApp` reference lists only `auth/drive` as the scope for `createFile` / `createFolder`. If you use `DriveApp` to write files, just declare `drive`; don't guess `drive.file` because it looks narrower

---

## Rule #5: Validate input at the boundary — never trust the payload

```javascript
function saveRecord(callerUserId, payload) {
  // type + presence checks
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
  if (!payload.folderId || typeof payload.folderId !== 'string') throw new Error('Missing folderId');
  const total = parseInt(payload.totalStudents);
  if (isNaN(total) || total < 0 || total > 1000) throw new Error('Invalid student count');

  // string length cap (guards against 1MB strings)
  if (String(payload.topic || '').length > 500) throw new Error('Topic is longer than 500 characters');

  // ... mutation ...
}
```

---

## Rule #6: Never echo input back into HTML unescaped

If you use `HtmlService.createTemplate()`:

### ✗ Bad

```html
<div><?= unsafeUserInput ?></div>  <!-- XSS -->
```

### ✓ Good

```html
<div><?!= encodeHtml(safeValue) ?></div>
```

Or render everything on the client (Alpine/Vue) and have the server return JSON only — then XSS depends on the client framework (Alpine's `x-text` escapes automatically)

---

## Rule #7: Never commit OAuth tokens / API keys in source

`.clasprc.json` — it lives in the home dir and is gitignored, but people still export it into the repo
API keys (LINE, OpenAI, etc.) → put them in **PropertiesService.getScriptProperties()** or a Config sheet that is not shared

```javascript
function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
}
```

Set it via the Apps Script editor: **Project Settings → Script properties → Add property**

---

## Rule #8: Log access to sensitive operations

```javascript
function deleteUser(callerUserId, targetUserId) {
  const caller = requireUser_(callerUserId);
  requireRole_(caller, ['admin']);
  // ...
  appendRowByHeaders_(getAuditSheet_(), {
    Timestamp: new Date().toISOString(),
    Actor: caller.UserID,
    Action: 'deleteUser',
    Target: targetUserId,
    IP: '-', // GAS has no request IP
  });
}
```