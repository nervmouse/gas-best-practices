# External Frontend (GitHub Pages / Netlify / Vercel) + GAS Backend

**Table of contents** (long file — jump straight to the rule that matches your task):

| Rule | Topic |
|---|---|
| Context | why the frontend must be separated from GAS + architecture |
| #1 | POST `text/plain` to avoid the CORS preflight |
| #2 | deploy `Execute as: Me` + `Anyone (even anonymous)` |
| #3 | send an auth token in the payload on every request |
| #4 | camera capture pattern |
| #5 | compress the image before sending |
| #6 | never put secrets in frontend code |
| #7 | handle the GAS URL redirect |
| #8, #8.1 | deploy URL format + multi-account fix (`?authuser=`) |
| #9 | GitHub Pages setup |
| #10 | PWA installable + offline cache |
| #11 | error handling including CORS / network |
| #12 | when to use HtmlService vs an external frontend |
| #13 | log GAS-side string mismatch |

## Context: why the frontend must be separated from GAS

A GAS web app runs inside a sandboxed iframe on `*.googleusercontent.com` — Google blocks many APIs that a normal website can use:

| API | Status in the GAS iframe |
|---|---|
| `getUserMedia()` (camera/mic) | ❌ blocked (Permissions Policy block) |
| `navigator.geolocation` | ⚠️ asks for permission and sometimes still fails |
| `navigator.clipboard.writeText` | ⚠️ requires a user gesture, sometimes fails |
| `IndexedDB`, `localStorage` | ⚠️ available but scoped to the iframe origin (does not persist across deploys) |
| `Notification API` (push) | ❌ blocked |
| `Service Worker` (PWA, offline) | ❌ blocked |
| File System Access API | ❌ blocked |
| WebRTC | ❌ blocked |
| Custom domain | ❌ not possible |
| Service Workers / PWA installable | ❌ not possible |
| Good Open Graph / SEO | ❌ (the iframe wrapper hides most of it) |

**Workaround:** move the frontend to **GitHub Pages / Netlify / Vercel**, a normal origin — full capabilities like any regular website + call GAS as an API backend through `fetch`

---

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  GitHub Pages           │         │  GAS Web App             │
│  https://user.github.io │  fetch  │  /macros/s/<id>/exec     │
│                         │ ──────► │                          │
│  - index.html           │         │  doGet() / doPost()      │
│  - camera capture ✓     │  JSON   │  → Sheet / Drive / etc.  │
│  - PWA / SW ✓           │ ◄────── │                          │
│  - full Web APIs ✓      │         │                          │
└─────────────────────────┘         └──────────────────────────┘
```

---

## Rule #1: GAS endpoint — accept POST `text/plain` to avoid the CORS preflight

**Important:** GAS **does not answer `OPTIONS` preflight** — if the client sends `Content-Type: application/json` the browser sends a preflight first → fail

### ✓ Good — use `text/plain` (simple request, no preflight)

```javascript
// Server (Code.gs)
const RPC_ALLOWED = ['login', 'saveRecord', 'uploadImage', 'getRecords'];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const { fn, args } = payload;
    if (!RPC_ALLOWED.includes(fn)) {
      return jsonOut_({ ok: false, message: 'forbidden function: ' + fn });
    }
    const result = globalThis[fn].apply(null, args || []);
    return jsonOut_(result);
  } catch (err) {
    Logger.log('[doPost] EXCEPTION ' + (err.stack || err));
    return jsonOut_({ ok: false, message: err.message });
  }
}

function doGet(e) {
  // health check / handshake
  return jsonOut_({ ok: true, service: 'TPM API', version: APP_VERSION });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

```javascript
// Client (GitHub Pages)
const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';

async function rpc(fn, ...args) {
  const t0 = Date.now();
  console.log('→ RPC', fn, args);
  const res = await fetch(GAS_URL, {
    method: 'POST',
    // ⚠️ never use application/json — it triggers a preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn, args }),
    redirect: 'follow', // GAS redirects on the first call
  });
  const data = await res.json();
  console.log('← RPC', fn, (Date.now() - t0) + 'ms', data);
  return data;
}
```

---

## Rule #2: deploy `Execute as: Me` + `Anyone (even anonymous)`

Otherwise the browser fetch gets Google's HTML login page instead of JSON.

**Deploy settings:**
- **Execute the app as:** Me (`your@gmail.com`)
- **Who has access:** Anyone

**Security implication:** every request runs with the owner's permissions → every mutation must be guarded by a token/role check inside the server function (see `rules/security.md`)

---

## Rule #3: every request must send an auth token in the payload

The GAS endpoint is public → anyone can hit it → **you must verify the session on every call**

```javascript
// Client — keep the token after login
let SESSION_TOKEN = localStorage.getItem('token') || '';

async function rpc(fn, ...args) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn, args, token: SESSION_TOKEN }),
  });
  return res.json();
}

async function login(username, password) {
  const res = await rpc('login', username, password);
  if (res.ok) {
    SESSION_TOKEN = res.token;
    localStorage.setItem('token', res.token);
  }
  return res;
}
```

```javascript
// Server — verify on every function except login
function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  const { fn, args, token } = payload;

  const PUBLIC_FNS = ['login'];
  let caller = null;
  if (!PUBLIC_FNS.includes(fn)) {
    caller = requireSession_(token); // throws if the token is invalid/expired
  }

  // pass caller as the first arg instead of userId
  const result = globalThis[fn].apply(null, caller ? [caller, ...args] : args);
  return jsonOut_(result);
}
```

---

## Rule #4: camera capture pattern (the use case this rule solves)

### Client — GitHub Pages

```html
<!-- use <input type="file" capture> — opens the OS camera without getUserMedia -->
<input type="file" accept="image/*" capture="environment" id="camera">

<!-- or getUserMedia, which works fine on a normal origin -->
<video id="preview" autoplay playsinline></video>
<button onclick="capture()">📷 Capture</button>
<canvas id="canvas" hidden></canvas>
```

```javascript
// Option A: getUserMedia (camera inside the page, no app switching)
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' }, // rear camera
    audio: false,
  });
  document.getElementById('preview').srcObject = stream;
}

async function capture() {
  const video = document.getElementById('preview');
  const canvas = document.getElementById('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  // send to GAS
  const res = await rpc('uploadImage', dataUrl, { caption: 'front yard' });
  if (res.ok) alert('Upload succeeded');
}

// Option B: <input type="file" capture> — simpler, uses the OS camera
document.getElementById('camera').onchange = async (e) => {
  const file = e.target.files[0];
  const dataUrl = await fileToDataUrl(file);
  // compress before sending (Rule #5)
  const compressed = await compressImage(dataUrl, 1280);
  await rpc('uploadImage', compressed, { caption: 'front yard' });
};

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}
```

### Server — receive base64, store in Drive

```javascript
function uploadImage(caller, dataUrl, meta) {
  Logger.log('[uploadImage] in user=' + caller.UserID + ' size=' + (dataUrl || '').length);
  try {
    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) throw new Error('invalid image data');
    const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) throw new Error('invalid base64 format');
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > 5 * 1024 * 1024) throw new Error('image larger than 5MB');

    const blob = Utilities.newBlob(bytes, m[1], 'photo_' + Date.now() + '.jpg');
    const folder = DriveApp.getFolderById(getConfig_('UPLOADS_FOLDER_ID'));
    const file = folder.createFile(blob);
    // never use ANYONE_WITH_LINK under a strict Workspace policy (rule drive-ops #4.1)
    Logger.log('[uploadImage] out ok fileId=' + file.getId());
    return { ok: true, fileId: file.getId() };
  } catch (err) {
    Logger.log('[uploadImage] out ERR ' + err.message);
    return { ok: false, message: err.message };
  }
}
```

---

## Rule #5: compress the image before sending — the RPC payload limit is ~50MB but the network is slow

```javascript
async function compressImage(dataUrl, maxWidth = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}
```

Typical size: a 12MP iPhone camera photo is ~3-5MB → compressed to 1280px it comes down to 200-400KB

---

## Rule #6: never put secrets / API keys in frontend code

**Why:** GitHub Pages = a public repo → everyone can read the source

```javascript
// ✗ Bad — leak
const API_KEY = 'AIzaSyB...';

// ✓ Good — the secret lives in GAS (ScriptProperties)
async function callExternal() {
  // GAS acts as the proxy — it calls the external API with its own key
  return await rpc('proxyToLineApi', { to: userId, message: 'hi' });
}
```

---

## Rule #7: handle the redirect — the GAS URL redirects on the first call

The first time, GAS issues a 302 redirect to `script.googleusercontent.com/...` — `fetch` must use `redirect: 'follow'` (the browser default, but state it explicitly)

```javascript
const res = await fetch(GAS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(payload),
  redirect: 'follow', // be explicit
});
```

Problem: some CORS proxies (if you use one) do not follow redirects → deploy GAS via a new deployment URL (the one ending in `/exec`), not the test URL (`/dev`)

---

## Rule #8: the deploy URL format that works with fetch

| URL | Usable with fetch from an external origin? |
|---|---|
| `/macros/s/<id>/exec` | ✅ works (production deployment) |
| `/macros/s/<id>/dev` | ❌ requires Google login + not stable |

**Tip:** every time you change the code you must **redeploy as a new version** (menu Deploy → Manage deployments → Edit → New version) — otherwise the `/exec` URL still runs the old code

---

## Rule #8.1: multi-account login — append `/u/0/` or `?authuser=` to prevent "unable to open this file right now"

**Real bug:** a user signed into several Google accounts on one machine (e.g. personal + work + school) opens the GAS link and sees:

> **Sorry, unable to open this file right now**
> Please check the address and try again

**Cause:** Google does not know which account to use — the first account (the default `/u/0/`) may not be the one with access to the web app (if it is deployed as `Anyone within domain` or `Anyone with Google account`)

### ✓ Fix for users

Append to the `/exec` URL:

| Format | Use when |
|---|---|
| `.../exec/usp=sharing` | the usual case — Google picks the account |
| `.../exec?authuser=0` | force the default account (the first one signed in) |
| `.../exec?authuser=1` | the 2nd account |
| `.../exec?authuser=user@gmail.com` | explicit email — the clearest option |
| `https://script.google.com/u/1/macros/s/<id>/exec` | inline `/u/<index>/` in the path |

**Recommended:** send links as `?authuser=<email>` to users who have registered.

```
https://script.google.com/macros/s/AKfycb.../exec?authuser=teacher@school.ac.th
```

### ✓ Fix for developers — generate links with authuser embedded

If your system knows the user email (after login) — build the link with authuser attached every time you send it:

```javascript
// Server (GAS)
function getDeployedUrl_(forUserEmail) {
  const base = ScriptApp.getService().getUrl(); // .../exec
  if (forUserEmail) {
    return base + '?authuser=' + encodeURIComponent(forUserEmail);
  }
  return base;
}

// use in notifications sent to users
function sendApprovalNotification_(email, recordId) {
  const url = getDeployedUrl_(email) + '&action=approve&id=' + recordId;
  MailApp.sendEmail({
    to: email,
    subject: 'Approval request pending',
    htmlBody: `<a href="${url}">Open to approve</a>`,
  });
}
```

### ✓ Fix for users who already hit the error

If clicking the link in LINE/email now shows an error:

1. **Easiest** — copy the URL → open a fresh Incognito window → sign in to the target account → paste
2. **Same browser** — `chrome://settings/people` or the profile icon at the top right → switch the target account to default → retry
3. **Add `/u/<index>/`** to the URL — index 0 = the first account signed in, 1 = the second, ...
4. **Set `?authuser=<email>`** at the end of the URL — the surest fix because it names the email directly

### Page UX hint — show guidance when a user hits the error

If a user pastes a malformed URL → the server returns an HTML guide instead of a blank error:

```html
<!-- error-account.html (GitHub Pages frontend) -->
<div>
  <h2>Cannot open</h2>
  <p>Try one of these:</p>
  <ol>
    <li>Click <a id="link-authuser">this link</a> (it attaches the account automatically)</li>
    <li>Or open <kbd>Ctrl+Shift+N</kbd> (Incognito) and open the URL again</li>
    <li>Or switch to the <em>your@school.ac.th</em> account in the Google account menu at the top right</li>
  </ol>
</div>
<script>
  const userEmail = prompt('Email you use in this system:');
  if (userEmail) {
    document.getElementById('link-authuser').href = APP_GAS_URL + '?authuser=' + encodeURIComponent(userEmail);
  }
</script>
```

---

## Rule #9: GitHub Pages setup

```
your-repo/
├── index.html
├── css/
├── js/
├── manifest.json     ← PWA manifest works
└── sw.js             ← Service Worker works
```

Settings → Pages → Source: `main` branch / `(root)` or `/docs`

The URL becomes `https://<user>.github.io/<repo>/`

**Custom domain:** add a CNAME file + DNS → you get `https://yourdomain.com/`

---

## Rule #10: PWA installable + offline cache (a bonus you can use today)

```javascript
// sw.js
const CACHE = 'app-v1';
const STATIC = ['/', '/index.html', '/css/app.css', '/js/app.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
});

self.addEventListener('fetch', (e) => {
  // never cache GAS API calls
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
```

```html
<!-- index.html -->
<link rel="manifest" href="/manifest.json">
<script>
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
</script>
```

Users tap "Add to Home Screen" → the app sits on the home screen like a native app

---

## Rule #11: error handling including CORS / network errors

```javascript
async function rpc(fn, ...args) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args, token: SESSION_TOKEN }),
    });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      // got HTML back = GAS login page = wrong deploy setting
      throw new Error('GAS endpoint misconfigured (returned HTML instead of JSON) — check Execute as / Who has access');
    }
    return JSON.parse(text);
  } catch (err) {
    console.error('✗ RPC', fn, err);
    // network error / parse error / CORS
    return { ok: false, message: 'Could not reach the server: ' + err.message };
  }
}
```

---

## Rule #12: comparison — when to use GAS HtmlService vs an external frontend

| Need | HtmlService (built-in) | GitHub Pages + GAS API |
|---|---|---|
| Quick prototype | ✅ very easy | ❌ heavy setup |
| Camera / mic | ❌ blocked | ✅ |
| Service Worker / PWA | ❌ | ✅ |
| Custom domain | ❌ | ✅ |
| SEO / Open Graph | ❌ | ✅ |
| No separate hosting | ✅ | ❌ |
| No CORS handling | ✅ (in-iframe) | ⚠️ needs the text/plain trick |
| Auth via native Google | ✅ | ❌ build it yourself (token) |
| Free tier limit | GAS quota | GH Pages 100GB/mo bandwidth |

**Heuristic:** internal tool for a 10-person team → HtmlService; camera use or scale → external frontend

---

## Rule #13: log GAS-side — a received request can still be a string mismatch

In `doPost(e)`, `e.postData.contents` is the string the client sent — log it and check before parsing.

```javascript
function doPost(e) {
  Logger.log('[doPost] in size=' + (e.postData?.contents || '').length +
             ' type=' + (e.postData?.type || 'none'));
  // ...
}
```

If `type` is `application/x-www-form-urlencoded` instead of `text/plain` — the client sent it the wrong way (it is probably using FormData)