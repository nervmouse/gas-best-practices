/**
 * Records.js — CRUD over RPC with a Result envelope + Lock
 * Patterns: rules/web-app-rpc.md, rules/lock-service.md, rules/error-handling.md
 */

function listRecords(token) {
  try {
    const caller = requireSession_(token);
    let rows = readSheet_(getSs_().getSheetByName('Records'));
    if (caller.Role !== 'admin') {
      rows = rows.filter(r => String(r.OwnerUserID) === String(caller.UserID));
    }
    return { ok: true, data: rows.map(sanitizeForClient_) }; // Date → ISO before leaving the server
  } catch (err) {
    Logger.log('[listRecords] EXCEPTION: ' + (err.stack || err));
    return { ok: false, message: err.message };
  }
}

function saveRecord(token, payload) {
  const lock = LockService.getScriptLock(); // a mutation users can collide on — rules/lock-service.md
  try {
    if (!lock.tryLock(10000)) return { ok: false, message: 'The system is busy, please try again' };
    const caller = requireSession_(token);

    // validate at the boundary — rules/security.md Rule #5
    if (!payload || typeof payload !== 'object') throw new Error('Invalid data');
    const title = String(payload.title || '').trim();
    if (!title) throw new Error('Please enter a title');
    if (title.length > 200) throw new Error('Title must be 200 characters or fewer');
    const phone = String(payload.phone || '').trim();
    if (phone && !/^0\d{8,9}$/.test(phone)) throw new Error('Invalid phone number');

    const sh = getSs_().getSheetByName('Records');
    appendRowByHeaders_(sh, {
      RecordID: 'REC' + Date.now(),
      Title: title,
      Phone: phone ? "'" + phone : '', // apostrophe protects the leading zero — spreadsheet-ops #6.6
      OwnerUserID: caller.UserID,
      CreatedAt: new Date().toISOString(), // ISO string, not a Date object — spreadsheet-ops #6.4
    });
    SpreadsheetApp.flush();
    Logger.log('[saveRecord] OK user=' + caller.UserID + ' title=' + title);
    return { ok: true, message: 'Saved successfully' };
  } catch (err) {
    Logger.log('[saveRecord] EXCEPTION: ' + (err.stack || err));
    return { ok: false, message: err.message };
  } finally {
    lock.releaseLock(); // always in finally — rules/lock-service.md Rule #4
  }
}