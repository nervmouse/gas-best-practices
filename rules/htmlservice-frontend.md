# HtmlService & Frontend

## Rule #1: `<meta viewport>` must live in the `<head>` of a `.html` file — never in a `.gs`

**Bug AI assistants love to make:** some AIs that generate a GAS web app put the viewport meta tag in as a string inside a `.gs` file:

### ✗ Bad — inside .gs, does not work

```javascript
// Code.gs
function doGet() {
  const html = '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
               '<div>...</div>';
  return HtmlService.createHtmlOutput(html);
}
```

Or they try to inject it through a function:

```javascript
function getViewport() {
  return '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
}
```

**Why it does not work:**
- `HtmlService` wraps your HTML in an iframe (`googleusercontent.com/...`) — a meta tag sitting in `<body>`, or injected at runtime, is ineffective because browsers only parse the viewport during the initial HTML render
- string concat in `.gs` often escapes incorrectly and mangles the tag
- the iframe parent is the Google Apps Script wrapper — we have no permission to change the parent's viewport

What you see: the web app opens on mobile at a tiny size and you have to pinch-zoom every time

### ✓ Good — in the `<head>` of the `.html` file

```html
<!-- Index.html -->
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My GAS Web App</title>
</head>
<body>
  <!-- ... -->
</body>
</html>
```

```javascript
// Code.gs
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('My GAS Web App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0'); // optional reinforcement
}
```

**Use `HtmlOutput`'s `addMetaTag()`** — Google injects it into the `<head>` of the iframe wrapper too (defense in depth)

---

## Rule #2: a viewport that covers every case

```html
<!-- general -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<!-- block user zoom to stop the UI breaking on input focus in iOS -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">

<!-- PWA-style: covers the notch on iPhone -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

**Caveat of `maximum-scale=1.0`:** it blocks accessibility (visually impaired users cannot zoom) — use it only when genuinely necessary

---

## Rule #3: use `HtmlService.createHtmlOutputFromFile()`, not string concat

### ✗ Bad

```javascript
function doGet() {
  return HtmlService.createHtmlOutput('<html><head>...</head><body>...</body></html>');
}
```

### ✓ Good

```javascript
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('My App')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

Splitting the HTML into its own file gives you syntax highlighting, formatting and version control

---

## Rule #4: `<?!= include('partial') ?>` — split partials into their own files

```javascript
// Code.gs
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

```html
<!-- Index.html -->
<!DOCTYPE html>
<html>
<head>
  <?!= include('styles') ?>
</head>
<body>
  <?!= include('header') ?>
  <main><!-- ... --></main>
  <?!= include('scripts') ?>
</body>
</html>
```

```html
<!-- styles.html -->
<style>
  body { font-family: 'Sarabun', sans-serif; }
</style>
```

```html
<!-- scripts.html -->
<script>
  // Alpine / Vue / vanilla JS
</script>
```

**Caveat for partial files:** no `<!DOCTYPE>` and no `<html>` — snippets only — because they get inlined into the full page

---

## Rule #5: `<?= var ?>` escapes automatically — `<?!= var ?>` does not escape

| Tag | Behavior | Use for |
|---|---|---|
| `<?= ... ?>` | HTML-escapes automatically | user-supplied data (prevents XSS) |
| `<?!= ... ?>` | raw output, no escaping | partial includes, trusted HTML |
| `<? ... ?>` | executes, outputs nothing | loops, if-else |

```html
<!-- Safe -->
<div>Hello, <?= userName ?></div>

<!-- Dangerous if userName contains HTML -->
<div>Hello, <?!= userName ?></div>
```

---

## Rule #6: server functions a template calls at render time — must be deterministic + fast

```javascript
function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.userName = Session.getActiveUser().getEmail();
  t.items = readSheet_(sheet); // careful — a large sheet makes rendering slow
  return t.evaluate().setTitle('App');
}
```

**Trade-off:** server-render = SEO + fast first paint, but it is tied to the session and cannot be cached
**Alternative:** ship the HTML shell first, then fetch data via `google.script.run` client-side (SPA pattern)

---

## Rule #7: `setXFrameOptionsMode(ALLOWALL)` when you must embed in another site

```javascript
HtmlService.createHtmlOutputFromFile('Index')
  .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
```

The default is `DEFAULT` — it blocks embedding → the web app opens only via its direct URL; if you must embed it in Sites/an iframe you need ALLOWALL

---

## Rule #8: never use an inline event handler that calls a server function directly

### ✗ Bad

```html
<button onclick="google.script.run.saveData('hello')">Save</button>
```

### ✓ Good — wrap it in rpc + handle the response

```html
<button onclick="doSave()">Save</button>
<script>
  async function doSave() {
    const res = await rpc('saveData', 'hello');
    if (res.ok) Swal.fire('Success');
    else Swal.fire('Error', res.message, 'error');
  }
</script>
```

See `rules/web-app-rpc.md` Rule #2 for the `rpc()` wrapper

---

## Rule #9: tags people forget

```html
<head>
  <meta charset="UTF-8">                                  <!-- 1. always first -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0">  <!-- 2. responsive -->
  <meta name="theme-color" content="#d81b60">             <!-- 3. PWA bar color on mobile -->
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'>...">  <!-- 4. favicon (data URI prevents a 404) -->
  <title>App Name</title>                                 <!-- 5. tab title -->
</head>
```

The GAS iframe sends no favicon → use a data URI to avoid a 404 in the Network tab

---

## Rule #10: log warnings from client → server (debugging on mobile)

Mobile has no DevTools — send errors back to the server log:

```javascript
// Client
window.addEventListener('error', (e) => {
  google.script.run.logClientError({
    message: e.message,
    source: e.filename,
    line: e.lineno,
    userAgent: navigator.userAgent,
  });
});

// Server
function logClientError(payload) {
  Logger.log('[client error] ' + JSON.stringify(payload));
  // or append to a Logs sheet
}
```

Helps debug bugs that appear on iPhone Safari but not on desktop Chrome
