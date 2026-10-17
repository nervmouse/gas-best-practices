# Web App RPC Pattern

A GAS web app calls server functions from the client via `google.script.run` — these are the patterns that scale

## Rule #1: every server function returns a `Result<T>` envelope — never throw

**Why:** if the server throws, the client only gets a raw `error.message` — and if the error happens deep in the stack, the message may be "Exception: Service error: Spreadsheet" (the user has no idea what that means)

### ✓ Good — envelope pattern

```javascript
function saveRecord(callerUserId, payload) {
  try {
    const caller = requireUser_(callerUserId);
    requireRole_(caller, ['teacher']);
    // ... mutation ...
    return { ok: true, recordId: recordId, message: 'Saved successfully' };
  } catch (err) {
    Logger.log('[saveRecord] ' + (err.stack || err));
    return { ok: false, message: err.message || String(err) };
  }
}
```

---

## Rule #2: client wrapper — promisify `google.script.run`

```javascript
function rpc(name, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [name](...args);
  });
}

// Usage
const res = await rpc('saveRecord', this.user.userId, payload);
if (res.ok) {
  Swal.fire('Success', res.message, 'success');
} else {
  Swal.fire('Error', res.message, 'error');
}
```

---

## Rule #3: identify the caller through a `callerUserId` parameter, not `Session.getActiveUser()`

**Why:** with a web app deployed as `executeAs: USER_DEPLOYING`, `Session.getActiveUser()` equals the deployment owner on every request — not the user who clicked the button

### ✓ Good — token-based caller

```javascript
// Client stores userId after login (localStorage is fine when stakes are low)
const res = await rpc('saveRecord', this.user.userId, payload);

// Server: validate callerUserId in every function
function requireUser_(callerUserId) {
  if (!callerUserId) throw new Error('Not logged in');
  const user = findUserById_(callerUserId);
  if (!user) throw new Error('User not found');
  if (user.Active === false || user.Active === 'false') throw new Error('Account is disabled');
  return user;
}

function requireRole_(user, allowedRoles) {
  if (!allowedRoles.includes(user.Role)) throw new Error('Permission denied');
}
```

**Limitation:** `callerUserId` is set on the client, so anyone can forge another user's ID — for work that needs real security you must store a session token + verify it (see `rules/security.md`)

---

## Rule #4: guard against oversized HTML payloads — RPC limit is 50MB

If you need to upload images/large files:
- images → base64 dataURL up to 5MB is normally enough
- large files → upload to Drive first, then send only the `fileId` to the server

### ✓ Good

```javascript
// Client: compress the image before sending
function compressImage(dataUrl, maxWidth = 1200) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, 1);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}
```

---

## Rule #5: bundle the initial load — one function call, many payloads

**Why:** every RPC = a ~300ms round-trip — 5 calls at boot = 1.5s

### ✗ Bad

```javascript
const me = await rpc('getMe', uid);
const folders = await rpc('listFolders', uid);
const records = await rpc('listRecords', uid);
const users = await rpc('listUsers', uid);
```

### ✓ Good

```javascript
// Server
function loadInitialBundle(callerUserId) {
  try {
    const caller = requireUser_(callerUserId);
    return {
      ok: true,
      me: sanitizeForClient_(caller),
      folders: listFolders_(caller),
      records: listRecords_(caller),
      users: caller.Role === 'admin' ? listUsers_() : [],
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Client
const bundle = await rpc('loadInitialBundle', this.user.userId);
```

---

## Rule #6: optimistic update — do not wait for the server just to render

```javascript
async doSaveReview() {
  const optimisticStatus = this.modal.reviewStatus;
  this.modal.record.AcademicStatus = optimisticStatus; // update the UI immediately
  try {
    const res = await rpc('updateRecordStatus', uid, rowIndex, optimisticStatus, comment);
    if (!res.ok) {
      // rollback
      Swal.fire('Error', res.message, 'error');
      this.refresh(false);
    }
  } catch (e) {
    this.refresh(false);
  }
}
```

---

## Rule #7: loading overlay for operations > 1 second

Use SweetAlert2 or an overlay element:

```javascript
async doGeneratePdf() {
  Swal.fire({
    title: 'Generating PDF...',
    html: 'Please wait a moment',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });
  try {
    const res = await rpc('generatePdfForRecord', uid, rowIndex);
    if (res.ok) {
      Swal.close();
      window.open(res.pdfUrl, '_blank');
    } else {
      Swal.fire('Error', res.message, 'error');
    }
  } catch (e) {
    Swal.fire('Error', 'Failed to generate PDF', 'error');
  }
}
```
