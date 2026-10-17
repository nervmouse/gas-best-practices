# Long-running Jobs (exceeding the 6-minute limit)

## Rule #1: A job over ~5 minutes must be designed as batch + resume — never hope it finishes in time

**Why:** GAS cuts an execution at 6 minutes (30 seconds for a custom function) with no warning — a job processing 10,000 rows that "used to finish in time" breaks as soon as the data grows, and breaking halfway = half-written data

**Design principle:** every iteration must be idempotent (re-running the same row does no harm) + store a checkpoint of how far it got

---

## Rule #2: checkpoint pattern — keep the position in Script Properties + set a continuation trigger

### ✓ Good — a skeleton that works for any batch job

```javascript
const TIME_BUDGET_MS = 4.5 * 60 * 1000; // margin against the 6-minute limit

function processAllRecords() {
  const props = PropertiesService.getScriptProperties();
  const start = Date.now();
  let cursor = parseInt(props.getProperty('JOB_CURSOR') || '2'); // first data row

  const sh = SpreadsheetApp.openById(getConfig_('SPREADSHEET_ID')).getSheetByName('Records');
  const lastRow = sh.getLastRow();
  Logger.log('[job] resume at row ' + cursor + ' / ' + lastRow);

  while (cursor <= lastRow) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      props.setProperty('JOB_CURSOR', String(cursor));
      scheduleContinuation_('processAllRecords');
      Logger.log('[job] checkpoint at row ' + cursor + ' — continuing in next run');
      return;
    }
    processOneRow_(sh, cursor); // must be idempotent
    cursor++;
  }

  // job finished — clear state + trigger
  props.deleteProperty('JOB_CURSOR');
  clearContinuation_('processAllRecords');
  Logger.log('[job] done ' + (lastRow - 1) + ' rows');
}

function scheduleContinuation_(handlerName) {
  clearContinuation_(handlerName); // prevent duplicate triggers (see rules/triggers.md Rule #1)
  ScriptApp.newTrigger(handlerName).timeBased().after(60 * 1000).create();
}

function clearContinuation_(handlerName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handlerName)
    .forEach(t => ScriptApp.deleteTrigger(t));
}
```

**3 landmines you must not miss:**
1. **Leave a margin** — cut off at 4.5 minutes, not 5.9 (writing the checkpoint + creating the trigger also take time)
2. **Delete the trigger when done** — otherwise it keeps running empty every minute until the quota is gone
3. **The iteration must be idempotent** — the script may die after processing a row but before writing the checkpoint → that row runs again

---

## Rule #3: Never process inside an RPC the user is waiting on — return "accepted" and work in the background

**Why:** `google.script.run` hits the same 6-minute limit, and the user should not stare at a spinning screen for 5 minutes

### ✓ Good — submit + poll status

```javascript
// RPC: take the command, reply immediately
function startExportJob(callerUserId) {
  const caller = requireUser_(callerUserId);
  PropertiesService.getScriptProperties().setProperties({
    'EXPORT_STATUS': 'running',
    'EXPORT_PROGRESS': '0',
  });
  scheduleContinuation_('runExportJob'); // starts within ~1 minute
  return { ok: true, message: 'Processing started — you will be notified when it is done' };
}

// RPC: the client polls every 5s
function getExportStatus(callerUserId) {
  const p = PropertiesService.getScriptProperties();
  return {
    ok: true,
    status: p.getProperty('EXPORT_STATUS') || 'idle',
    progress: parseInt(p.getProperty('EXPORT_PROGRESS') || '0'),
    fileUrl: p.getProperty('EXPORT_FILE_URL') || null,
  };
}
```

A finished job should also notify another channel (email / LINE — see `rules/email-notifications.md`), in case the user already closed the page

---

## Rule #4: Reduce work per iteration before thinking about batching

**Why:** most jobs that "exceed 6 minutes" are really N+1 round-trips — fix them per `rules/spreadsheet-ops.md` Rule #1 (bulk read) + write in batch and they usually drop well under a minute

Checklist before building a continuation pattern:
- [ ] Did you read the sheet once with `getDataRange().getValues()`?
- [ ] Can you write back in a batch (`setValues` over a range with no merged cells) instead of per cell?
- [ ] Are external fetches using `fetchAll`? (`rules/urlfetch-external-api.md` Rule #3)
- [ ] Is there timing log showing which step is expensive? (`rules/testing-debugging.md` Rule #9)
