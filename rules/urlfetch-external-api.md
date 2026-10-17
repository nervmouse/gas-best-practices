# UrlFetch & External API (LINE, webhook, REST)

## Rule #1: Always `muteHttpExceptions: true` + check the response code yourself

**Why:** the default for `UrlFetchApp.fetch()` is to **throw immediately** when the HTTP status ≥ 400 — you never see the response body that explains why (e.g. the error message from the LINE API), and the throw leaks to the client as a stack trace

### ✗ Bad

```javascript
const res = UrlFetchApp.fetch(url, opts); // 401 → throws, you have no idea the token expired
```

### ✓ Good

```javascript
function fetchJson_(url, opts) {
  opts = opts || {};
  opts.muteHttpExceptions = true;
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    Logger.log('[fetchJson] ' + url + ' → HTTP ' + code + ' body=' + body.slice(0, 500));
    throw new Error('HTTP ' + code);
  }
  return body ? JSON.parse(body) : null;
}
```

---

## Rule #2: Retry + exponential backoff for transient errors (429/5xx)

**Why:** Google / LINE / external APIs transiently return 429 (rate limit) or 500/503 — giving up after one failure kills the entire batch for no reason, but **never retry other 4xx** (400/401/403 = resending fails exactly the same way)

### ✓ Good

```javascript
function fetchWithRetry_(url, opts, maxRetries) {
  maxRetries = maxRetries || 3;
  for (let attempt = 0; ; attempt++) {
    const res = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opts));
    const code = res.getResponseCode();
    const retryable = code === 429 || code >= 500;
    if (!retryable || attempt >= maxRetries) return res;
    Utilities.sleep(Math.pow(2, attempt) * 1000); // 1s, 2s, 4s
    Logger.log('[fetchWithRetry] retry ' + (attempt + 1) + ' after HTTP ' + code);
  }
}
```

**Careful:** `Utilities.sleep` consumes execution time (limit 6 minutes) — for large batches that retry often see `rules/long-running-jobs.md`

---

## Rule #3: For multiple requests use `fetchAll` — not a loop of single fetches

**Why:** `fetch()` in a loop = serial round-trips; `fetchAll()` fires them in parallel in one go, many times faster and counting the same quota

```javascript
const requests = userIds.map(id => ({
  url: 'https://api.example.com/users/' + encodeURIComponent(id),
  muteHttpExceptions: true,
}));
const responses = UrlFetchApp.fetchAll(requests);
responses.forEach((res, i) => {
  if (res.getResponseCode() !== 200) Logger.log('[sync] fail id=' + userIds[i]);
});
```

---

## Rule #4: Keep API keys/tokens in Script Properties — never hardcode them in source

**Why:** source gets committed / shared / pulled with clasp onto other machines — a hardcoded token leaks easily (see `rules/security.md` Rule #7 and the criteria for choosing where to store it in `rules/properties-service.md`)

```javascript
function getLineToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!token) throw new Error('LINE_CHANNEL_TOKEN is not set in Script properties');
  return token;
}
```

---

## Rule #5: LINE Messaging API — a reusable pattern

```javascript
function pushLineMessage_(to, messages) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getLineToken_() },
    payload: JSON.stringify({ to: to, messages: messages }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    // LINE returns JSON explaining why, e.g. invalid user id / more than 5 messages
    Logger.log('[LINE] push fail HTTP ' + code + ' ' + res.getContentText());
    return { ok: false, message: 'Failed to send the LINE message' };
  }
  return { ok: true };
}

// Usage
pushLineMessage_(userId, [{ type: 'text', text: 'Your data has been saved' }]);
```

**Common gotchas:**
- `messages` must be an array of at most 5 items per call
- Sending to many people use `/multicast` (saves quota versus a push loop)
- LINE Notify is retired (March 2025) — new work uses the Messaging API only

---

## Rule #6: Watch quota — URL Fetch 20,000 calls/day (consumer)

| Account | URL Fetch calls/day |
|---|---|
| gmail.com | 20,000 |
| Google Workspace | 100,000 |

- A sync job that calls the API per row → 5,000 rows already burns 1 in 4 of the quota — aggregate requests (the destination API's batch endpoint) or cache the results (`rules/cache-service.md`)
- Once you hit quota `fetch` throws `Service invoked too many times` — catch that error and notify the admin instead of letting the job die silently

---

## Rule #7: The UrlFetch timeout is fixed at ~60 seconds — not configurable

**Why:** GAS has no timeout option — a slower destination API always throws `Timeout`

- Slow endpoint (generating a report on their side) → switch to the async pattern: fire the job → the destination calls back to our `doPost`, or poll the status periodically
- Never put a slow fetch inside an RPC the user is waiting on in the browser — the user sees a 60-second spinner and then a failure
