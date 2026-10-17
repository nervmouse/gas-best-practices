# onOpen Menu — Custom Menus in Sheets

## Rule #1: use `onOpen()` as a simple trigger — no installable trigger needed

```javascript
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🎓 Admin')
    .addItem('▶ Setup project', 'setupSandbox')
    .addItem('📝 Show Config', 'showConfig')
    .addSeparator()
    .addItem('🧹 Clear Output sheet', 'clearOutput')
    .addItem('🧹 Clear Logs sheet', 'clearLogs')
    .addSeparator()
    .addItem('⚙ Re-setup (reset every sheet)', 'setupSandbox')
    .addToUi();
}
```

**Limit of a simple trigger:** you cannot use services that require authorization (UrlFetch, another user's Drive, MailApp)
If you need them → make it an installable trigger that the user authorizes once

---

## Rule #2: group menu items with separators — cluster related functions

```javascript
ui.createMenu('🎓 Sandbox')
  .addItem('▶ Hello World', 'helloWorld')          // starting point
  .addItem('📝 Show Config', 'showConfig')         // read-only
  .addSeparator()
  .addItem('🧹 Clear Output', 'clearOutput')       // delete — has side effects
  .addItem('🧹 Clear Logs', 'clearLogs')
  .addSeparator()
  .addItem('⚙ Re-setup', 'setupSandbox')           // destructive
  .addToUi();
```

Order: **frequently used → rarely used → delete/reset**

---

## Rule #3: destructive action — confirm before running it

```javascript
function setupSandbox() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    'Re-setup project',
    'All data in the Output and Logs sheets will be deleted. Continue?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  // ... do setup ...
}
```

---

## Rule #4: alert only what the user must know — never alert at every step

### ✗ Bad

```javascript
function doStuff() {
  ui.alert('Starting...');     // unnecessary
  step1();
  ui.alert('Step 1 done');     // annoying
  step2();
  ui.alert('Done!');
}
```

### ✓ Good — alert only at the end + use a toast for status

```javascript
function doStuff() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Processing...', '⏳');
  step1();
  step2();
  ss.toast('Done', '✅', 3);
  // use an alert only if the user still has to decide something
}
```

`ss.toast(message, title, seconds)` — bottom-right corner, does not block the UI

---

## Rule #5: if the calling function may have no UI context — wrap the alert in try/catch

```javascript
function setupSandbox() {
  // ... setup ...
  try {
    SpreadsheetApp.getUi().alert('✅ Setup complete!');
  } catch (e) {
    // running via a trigger / clasp run / no UI → skip the alert
    Logger.log('Setup done (no UI).');
  }
}
```

---

## Rule #6: split the menu by role — check the user email

```javascript
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const email = Session.getActiveUser().getEmail();
  const isAdmin = ADMIN_EMAILS.includes(email);

  const menu = ui.createMenu('🎓 Sandbox');
  menu.addItem('▶ Hello World', 'helloWorld');

  if (isAdmin) {
    menu.addSeparator();
    menu.addItem('⚙ Re-setup', 'setupSandbox');
    menu.addItem('🗑 Delete all data', 'deleteAll');
  }

  menu.addToUi();
}
```

**Caveat:** a simple trigger `onOpen` runs with the rights of the user who opened the file — `Session.getActiveUser().getEmail()` returns that user's email

---

## Rule #7: sub-menus for deep menu trees

```javascript
ui.createMenu('🎓 Admin')
  .addItem('🏠 Dashboard', 'showDashboard')
  .addSubMenu(
    ui.createMenu('📊 Reports')
      .addItem('Daily', 'reportDaily')
      .addItem('Weekly', 'reportWeekly')
      .addItem('Monthly', 'reportMonthly')
  )
  .addSubMenu(
    ui.createMenu('⚙ Settings')
      .addItem('Edit config', 'editConfig')
      .addItem('Manage users', 'manageUsers')
  )
  .addToUi();
```

---

## Rule #8: short menu names — emoji + one word

- ✅ `🎓 Sandbox`, `📊 Reports`, `⚙ Settings`
- ❌ `🎓 Sandbox Management Console`, `📊 View All Reports for This Project`

The GAS menu bar is narrow — long names waste space and are hard to read