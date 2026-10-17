# Drive Operations

**Table of contents:**

| Rule | Topic |
|---|---|
| #1 | store folder IDs in the Config sheet |
| #2 | lazy creation — create folders automatically |
| #3 | return signature/avatar images to the client as base64 dataURL |
| #4, #4.1 | sharing ANYONE_WITH_LINK + the domain-policy-block case |
| #5 | delete the old file before uploading a new one |
| #6 | validate the dataURL server-side |
| #7 | keep each user's folders separate |
| #8 | DriveApp scope: `drive`, not `drive.file` |

## Rule #1: store folder IDs in the Config sheet — never hardcode

**Why:** hardcode them in the script and every folder move forces a fresh redeploy — edit the Config sheet instead and it takes effect immediately + anyone with wiki/admin sheet access can see it

### ✓ Good — Config sheet pattern

```
Config sheet:
| Key                  | Value                   |
| TEACHERS_FOLDER_ID   | 1AbC...XYZ              |
| SIGNATURES_FOLDER_ID | 1DeF...UVW              |
| PDF_TEMPLATE_GID     | 96558638                |
```

```javascript
function getConfig_(key) {
  const cache = CacheService.getScriptCache();
  const ck = 'cfg_' + key;
  const cached = cache.get(ck);
  if (cached) return cached;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = ss.getSheetByName('Config').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      const v = String(data[i][1]);
      try { cache.put(ck, v, 3600); } catch (e) {}
      return v;
    }
  }
  return '';
}
```

---

## Rule #2: lazy creation — create the folder automatically if it does not exist

**Why:** a fresh clone of the project should not require an admin to set it up by hand

```javascript
function ensureSchema() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheet_(ss, 'Config', ['Key', 'Value']);
  ensureConfigEntry_(ss, 'TEACHERS_FOLDER_ID', () => createDriveFolderIfMissing_('TPM_Teachers'));
  ensureConfigEntry_(ss, 'SIGNATURES_FOLDER_ID', () => createDriveFolderIfMissing_('TPM_Signatures'));
}

function ensureConfigEntry_(ss, key, valueFn) {
  const sh = ss.getSheetByName('Config');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key && data[i][1] !== '' && data[i][1] != null) return data[i][1];
  }
  const v = valueFn();
  sh.appendRow([key, v]);
  SpreadsheetApp.flush();
  return v;
}

function createDriveFolderIfMissing_(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next().getId();
  return DriveApp.createFolder(name).getId();
}
```

---

## Rule #3: return signature/avatar images as base64 dataURL — do not use Drive thumbnail URLs

**Real bug:** the signature preview in the web app does not render (broken image icon)

**Cause:** Drive URLs (`drive.google.com/uc?id=...` or `lh3.googleusercontent.com/...`) require an OAuth cookie — loaded in an `<img>` of a web app deployed with `executeAs: USER_DEPLOYING` they get blocked by CORS or return 403 (because the end user is not signed in to Google in that tab, or has no access to the Drive)

### ✗ Bad — let the client load the URL directly

```javascript
// Server
return { ok: true, signatureUrl: 'https://drive.google.com/uc?id=' + fileId };

// Client
<img src="https://drive.google.com/uc?id=..."> // 💥 broken
```

### ✓ Good — the server fetches the blob and returns a dataURL

```javascript
// Server
function getMySignatureDataUrl(callerUserId) {
  try {
    const caller = requireUser_(callerUserId);
    if (!caller.SignatureFileId) return { ok: true, dataUrl: '' };
    const file = DriveApp.getFileById(caller.SignatureFileId);
    const blob = file.getBlob();
    const mime = blob.getContentType() || 'image/png';
    const b64 = Utilities.base64Encode(blob.getBytes());
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + b64 };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Client
const res = await rpc('getMySignatureDataUrl', this.user.userId);
if (res.ok && res.dataUrl) {
  this.sigCurrentUrl = res.dataUrl; // use with <img :src="sigCurrentUrl">
}
```

**Pros:**
- No CORS issues — the dataURL is embedded in the page
- No need to share the file (it stays private)
- Works on a web app in every deployment mode

**Cons:**
- base64 is ~33% larger than binary — fine for small images (signature, avatar, logo), not for multi-MB photos
- if you need to show hundreds of images at once → cache the dataURL client-side or use the next approach

---

## Rule #4: for large images / many images — share ANYONE_WITH_LINK + use a direct URL

```javascript
// Server — set sharing after creating the file
const file = folder.createFile(blob);
try {
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
} catch (e) {
  // domain policy block — the file is still saved, just not publicly linkable
  Logger.log('[saveImage] setSharing failed (likely domain policy): ' + e.message);
}

// return the thumbnail URL
return {
  ok: true,
  thumbUrl: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w400',
  // or the full URL
  viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
  downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
};
```

**Trade-off:** anyone-with-link means the content is no longer secret — usable for non-sensitive user-generated content (product photos, cover images); never use it for personal documents

---

## Rule #4.1: `setSharing(ANYONE_WITH_LINK)` breaks on a school/organization Google Workspace

**Real bug (case study):** the original code runs fine on personal Gmail → deployed to a teacher whose deploy account is `@school.ac.th` and it throws:

```
Exception: Permission denied: DriveApp
```

**Cause:** the Google Workspace admin of the org (school, government agency, large company) set a "**Block external sharing**" or "**Restrict to domain only**" policy — `ANYONE_WITH_LINK` counts as external, so it gets blocked → DriveApp throws immediately

Users see the error when they press save; the app breaks across the board because the exception bubbles up out of the function

### ✗ Bad — assume sharing works + a throw blocks the whole function

```javascript
function uploadImageAndSave(...) {
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // 💥 throw
  saveRowToSheet(file.getId(), file.getUrl()); // never reached
}
```

### ✓ Good — wrap `setSharing` in try/catch + degrade gracefully

```javascript
function uploadImageAndSave(callerUserId, base64, meta) {
  try {
    const file = folder.createFile(blob);

    // try public sharing — if it fails that is fine, the file still exists
    let publicUrl = '';
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      publicUrl = 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w400';
    } catch (sharingErr) {
      Logger.log('[upload] setSharing blocked by domain policy: ' + sharingErr.message);
      // fallback: return the file ID and let the client fetch it over the base64 RPC instead
    }

    saveRowToSheet(file.getId(), publicUrl);
    return { ok: true, fileId: file.getId(), publicUrl: publicUrl };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
```

### ✓ Better — know at deploy time that the domain blocks public sharing → design without it at all

If you know every target user is in the same domain (a school, a company) → **never use `ANYONE_WITH_LINK` in the first place**. Use base64 dataURL over RPC (Rule #3) or share inside the domain only:

```javascript
// Share only within the domain — normally allowed by policy
file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
```

or share with specific users:

```javascript
file.addViewer('supervisor@school.ac.th');
```

### Decision tree

```
Must the image be shown in the web app?
├── Yes + every user is in the same domain
│   └── Use base64 dataURL over RPC (Rule #3) — no sharing at all
├── Yes + multiple/external domains + image is not sensitive
│   └── Try ANYONE_WITH_LINK + try/catch fallback
├── Yes + image is sensitive
│   └── base64 dataURL + check permissions on every RPC call
└── No — just store it in Drive
    └── createFile and done — no setSharing needed
```

### How to detect the policy up front

There is no GAS API that queries the policy directly — practical options:
1. **Deploy and test with a test account in the target domain** to see whether `setSharing` throws
2. **Store a flag in the Config sheet** `ALLOW_PUBLIC_SHARING = true/false` — let the admin toggle it to match reality
3. **try/catch + memoize** — if the first attempt fails, remember it in CacheService for a whole day instead of retrying

```javascript
function canPublicShare_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('can_public_share');
  if (cached !== null) return cached === '1';

  try {
    // test with a dummy file
    const testFile = DriveApp.createFile('___test_share___', '');
    testFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    testFile.setTrashed(true);
    cache.put('can_public_share', '1', 86400); // 24 hr
    return true;
  } catch (e) {
    cache.put('can_public_share', '0', 86400);
    return false;
  }
}
```

---

## Rule #5: delete the old file before uploading a new one — keeps Drive tidy

```javascript
function saveMySignature(callerUserId, base64DataUrl) {
  const caller = requireUser_(callerUserId);
  // ... validate ...

  // delete the old one first
  if (caller.SignatureFileId) {
    try {
      DriveApp.getFileById(caller.SignatureFileId).setTrashed(true);
    } catch (e) {}
  }

  // create the new one
  const folder = DriveApp.getFolderById(getConfig_('SIGNATURES_FOLDER_ID'));
  const file = folder.createFile(blob);
  // update the ID in the sheet
  sheet.getRange(rowIndex, sigCol).setValue(file.getId());
}
```

**Use `setTrashed(true)` on its own, not a `.setTrashed(true).getId()` chain** — this has caused real bugs, because the method returns a File, not void

---

## Rule #6: validate the dataURL server-side before decoding base64

```javascript
function saveImage_(base64DataUrl, folderId, filename) {
  if (!base64DataUrl || base64DataUrl.indexOf('data:image/') !== 0) {
    throw new Error('invalid image data');
  }
  const m = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error('invalid base64 format');
  const mime = m[1];
  const bytes = Utilities.base64Decode(m[2]);

  // max size 5MB
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('image larger than 5MB');
  }

  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'bin';
  const blob = Utilities.newBlob(bytes, mime, filename + '.' + ext);
  return DriveApp.getFolderById(folderId).createFile(blob);
}
```

---

## Rule #7: keep each user's folders separate — not one big pile

Inside the TEACHERS folder:
```
TEACHERS/
├── teacher1@email.com/
│   ├── REC001.pdf
│   └── Thai-Grade1/
│       └── ...
└── teacher2@email.com/
    └── ...
```

```javascript
function ensureTeacherParentFolder_(username) {
  const parentId = getConfig_('TEACHERS_FOLDER_ID');
  const parent = DriveApp.getFolderById(parentId);
  const existing = parent.getFoldersByName(username);
  if (existing.hasNext()) return existing.next().getId();
  return parent.createFolder(username).getId();
}
```

Benefit: browsing Drive becomes self-explanatory + you can share one person's folder with an accountant/HR

---

## Rule #8: DriveApp scope — use `drive`, not `drive.file`

**Real bug:** an app that takes photos and stores them in Drive declared the narrowest scopes possible, following the "request only what you use" principle:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file"
]
```

The moment a photo is saved, `DriveApp.createFolder()` (Rule #2) fails immediately:

```
The declared scopes are not sufficient to call DriveApp.createFolder. The required scope is https://www.googleapis.com/auth/drive
```

**Why:** `drive.file` limits access to files the app created itself, but `DriveApp` does not support that scope at all — the `DriveApp` reference lists `https://www.googleapis.com/auth/drive` as the scope for both `createFile` and `createFolder`, with no alternative

### ✓ Good

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
]
```

| What you use DriveApp for | scope |
|---|---|
| Write: `createFile`, `createFolder`, `Folder.createFile`, `setSharing`, `setTrashed` | `drive` |
| Read only: `getFileById`, `getFolderById`, `getBlob` | `drive.readonly` |

- During authorization Google warns that the app can reach all of Drive — that is a limitation of `DriveApp`, not a mistake in your code
- If you really need `drive.file`, do not use `DriveApp` — call the Drive REST API yourself (`UrlFetchApp` + `ScriptApp.getOAuthToken()` + scope `script.external_request`) or use the Advanced Drive Service, which requires enabling extra APIs
- Adding a scope later = the owner has to re-authorize once before other users can use that feature