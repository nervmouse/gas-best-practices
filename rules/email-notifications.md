# Email & Notifications

## Rule #1: Use `MailApp` for send-only — `GmailApp` only when you must read/manage the inbox

**Why:** `GmailApp` requests the `.../auth/gmail` scope (read-write-delete over the whole mailbox) — a scary authorize screen and hard to audit, while `MailApp` only asks for `.../auth/script.send_mail` (send only)

```javascript
// ✓ Send a notification — MailApp is enough
MailApp.sendEmail({
  to: 'admin@school.ac.th',
  subject: '[Grading System] 3 records are waiting for approval',
  htmlBody: '<p>You can review them at <a href="' + APP_URL + '">the Grading System</a></p>',
});
```

---

## Rule #2: Check quota before sending a batch — consumer accounts get only 100/day

| Account | Email/day |
|---|---|
| gmail.com | 100 |
| Google Workspace | 1,500 |

**Why:** a system that sends one email per record hits the quota before you even reach a hundred users — over quota `sendEmail` throws and the rest of the job dies with it

```javascript
function sendBatchNotify_(recipients, subject, htmlBody) {
  const remaining = MailApp.getRemainingDailyQuota();
  if (recipients.length > remaining) {
    Logger.log('[mail] quota not enough: need ' + recipients.length + ' have ' + remaining);
    return { ok: false, message: 'Not enough email quota today (' + remaining + ' left)' };
  }
  // Put all recipients in a single bcc = counts against quota once
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), bcc: recipients.join(','), subject: subject, htmlBody: htmlBody });
  return { ok: true };
}
```

**Quota-saving trick:** many recipients with identical content → put them all in one `bcc` email / only send separately when the content genuinely differs

---

## Rule #3: Email content in the user's language — short subject with a system prefix + an htmlBody that reads well on mobile

**Why:** most recipients open email on a phone, and automated system mail gets skimmed past easily — a `[SystemName]` prefix makes it filterable/searchable

```javascript
function notifyRecordApproved_(user, record) {
  MailApp.sendEmail({
    to: user.Email,
    subject: '[Grading System] Approved — ' + record.RecordID,
    htmlBody:
      '<div style="font-family:sans-serif;max-width:480px">' +
      '<p>Hello ' + escapeHtml_(user.DisplayName) + '</p>' +
      '<p>Record <b>' + escapeHtml_(record.RecordID) + '</b> has been approved</p>' +
      '<p><a href="' + APP_URL + '?record=' + encodeURIComponent(record.RecordID) + '">Open the record</a></p>' +
      '<hr><p style="color:#888;font-size:12px">Automated email — no reply needed</p>' +
      '</div>',
  });
}
```

Values from the user/sheet inserted into htmlBody must be escaped (prevents HTML injection — same rule as `rules/security.md` Rule #6)

---

## Rule #4: Error notifications must be throttled — stop flooding the admin's inbox

**Why:** a trigger that runs every 5 minutes and keeps failing = 288 error emails/day — quota gone and the admin stops reading (an ignored notification is no notification)

### ✓ Good — notify about the same issue at most once per hour, via cache

```javascript
function notifyAdminOnce_(jobName, err) {
  const cache = CacheService.getScriptCache();
  const key = 'errnotify_' + jobName;
  if (cache.get(key)) return; // already notified this hour
  cache.put(key, '1', 3600);
  try {
    MailApp.sendEmail({
      to: getConfig_('ADMIN_EMAIL'),
      subject: '[Grading System] ⚠️ ' + jobName + ' failed',
      body: 'Error: ' + (err && err.message) + '\n\nStack:\n' + (err && err.stack) +
            '\n\nSee the log: Apps Script editor → Executions',
    });
  } catch (mailErr) {
    Logger.log('[notifyAdminOnce] cannot send mail: ' + mailErr.message);
  }
}
```

- Keep the admin email in the Config sheet (`ADMIN_EMAIL`) — changing the person responsible needs no code edit
- Sending an error email needs its own try/catch — never let the notification break the main job

---

## Rule #5: To send as a system name, not a person — use the `name` option (the alias must be configured in Gmail first)

```javascript
MailApp.sendEmail({
  to: user.Email,
  subject: '...',
  htmlBody: '...',
  name: 'Grading System',             // show a system name as the sender (the address is still the deployer's)
  noReply: true,                     // Workspace only — send from no-reply@domain
});
```

**Limitation:** email always goes out from the account that installed the trigger / deployed (see `rules/triggers.md` Rule #2) — an organisation-wide system should be deployed with a central account, not the developer's personal account
