# CacheService — Reduce Sheet Round-Trips

## Rule #1: Cache queries that are read often and change rarely

Example: fetching the user profile from the Users sheet on every RPC call — wastes 200ms per call

### ✓ Good

```javascript
function findUserById_(userId) {
  const cache = CacheService.getScriptCache();
  const ck = 'user_' + userId;
  const cached = cache.get(ck);
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('Users');
  const user = readSheet_(sh).find(r => String(r.UserID) === String(userId));
  if (user) {
    try { cache.put(ck, JSON.stringify(user), 600); } catch (e) {} // 10 min
  }
  return user;
}
```

---

## Rule #2: Invalidate the cache every time the data changes

```javascript
function invalidateUserCache_(userId) {
  try { CacheService.getScriptCache().remove('user_' + userId); } catch (e) {}
}

function changeMyPassword(callerUserId, oldPwd, newPwd) {
  // ... update sheet ...
  invalidateUserCache_(callerUserId); // 💡
  return { ok: true };
}
```

**Pattern:** every write that touches a row → remove the cache key — forget it and you will spend 30 minutes debugging "why isn't the UI updating"

---

## Rule #3: TTL depends on the nature of the data

| Type | TTL | Reason |
|---|---|---|
| User profile, role | 600s (10 min) | changes rarely, tolerates stale data |
| Config (folder ID, settings) | 3600s (1 hr) | practically never changes |
| Aggregate count (totals, approval queue) | 60s | users expect to see fresh numbers |
| Sensitive (auth token) | 300s | safer + fewer queries |

`CacheService.getScriptCache()` has a max TTL of 21600s (6 hr) — pass a larger value and it does not error, it is capped at 21600

---

## Rule #4: Prefix cache keys to prevent collisions

```javascript
const CK = {
  user: (id) => 'user_' + id,
  config: (key) => 'cfg_' + key,
  recordCount: (folderId) => 'reccnt_' + folderId,
};
```

---

## Rule #5: ScriptCache has a 100KB size limit per key

If the payload is large → split it, or cache only the ID list and fetch the full records one at a time when needed

```javascript
// ✗ Bad — caches the whole array of records, which may be hundreds of rows
cache.put('all_records', JSON.stringify(allRecords)); // may exceed 100KB

// ✓ Good — cache only the list of IDs, read full records from the sheet on use
cache.put('record_ids_pending', JSON.stringify(ids));
```

---

## Rule #6: Wrap `cache.put()` in try/catch — a failure is not critical

```javascript
try {
  cache.put(ck, JSON.stringify(v), 600);
} catch (e) {
  // payload too large, quota full — ignore, not on the critical path
}
```

---

## Rule #7: CacheService vs PropertiesService

| | CacheService | PropertiesService |
|---|---|---|
| TTL | Has one (max 6 hr) | None (permanent) |
| Size | 100KB/key, 24MB total | 9KB/key, 500KB total |
| Use for | query cache, stale reads are OK | flags, config that must persist |
| Performance | fast (in-memory) | slower (persistent) |

**Never use PropertiesService as a cache** — it is a DB, not a cache; there is no TTL

---

## Rule #8: Bind the cache key to the **code version**, not just the data revision

**Why:** the cache key is `'all_' + rev_()` and then you deploy new code that changes the *shape* of the payload — `rev` never moves because the data did not change. The result: the web app keeps eating the old payload out of cache for another 6 hours. You measure the optimisation at `-0.2%` and sit there wondering why it did not get faster

```javascript
// ✗ Bad — new code deployed but the old cache is still being served
var ck = 'all_' + rev_();

// ✓ Good — bump this number every time the payload structure changes
var ALL_CACHE_VERSION = 6;
var ck = 'all_v' + ALL_CACHE_VERSION + '_' + rev_();
```

**Edge case:** a forgotten `ALL_CACHE_VERSION` bump fails completely silently — put it in your deploy checklist next to the version stamp ([deployment-versioning.md](deployment-versioning.md))
