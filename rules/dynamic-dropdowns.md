# Dynamic Dropdowns (options that should never be hardcoded)

## Rule: date/year dropdowns — never hardcode them in HTML

**Why:** code that hardcodes `<option value="2024">2024</option>` goes "stale" the moment time passes — a user in 2027 opens the page, sees the old years, and is confused immediately

### ✗ Bad — fixed list

```html
<select x-model="recordForm.year">
  <option value="2567">2567</option>
  <option value="2568">2568</option>
  <option value="2569">2569</option>
</select>
```

### ✓ Good — generate from the current year + merge in the values present in the sheet

```javascript
// inside Alpine data() / state
get yearOptions() {
  // current year + 2 previous + 2 next (Buddhist Era)
  const currentBE = new Date().getFullYear() + 543;
  const generated = [];
  for (let y = currentBE - 2; y <= currentBE + 2; y++) generated.push(y);

  // merge in years that already appear in records (in case a record is older than -2 years)
  const fromData = [...new Set(this.records.map(r => Number(r.Year)).filter(Boolean))];

  // merge + sort desc (newest first) + unique
  return [...new Set([...generated, ...fromData])].sort((a, b) => b - a);
}
```

```html
<select x-model="recordForm.year">
  <template x-for="y in yearOptions" :key="y">
    <option :value="y" x-text="y"></option>
  </template>
</select>
```

---

## Rule: default value = the current year

```javascript
// when initialising the form
recordForm: {
  year: new Date().getFullYear() + 543, // Buddhist Era
  term: this.guessCurrentTerm(),
  // ...
},

guessCurrentTerm() {
  const m = new Date().getMonth() + 1; // 1-12
  // term 1: May-Sep (5-9), term 2: Oct-Mar
  return (m >= 5 && m <= 9) ? 1 : 2;
}
```

---

## Rule: enum dropdowns built from real data — pull them from the sheet

Example: a "class level" dropdown (P.1, P.2, M.3, ...) — pull from the records that actually exist + add an input field for "a value not yet present"

```javascript
get classLevelOptions() {
  const fromData = [...new Set(this.records.map(r => r.ClassLevel).filter(Boolean))];
  const defaults = ['P.1', 'P.2', 'P.3', 'P.4', 'P.5', 'P.6', 'M.1', 'M.2', 'M.3'];
  return [...new Set([...defaults, ...fromData])].sort();
}
```

Or if you want maximum flexibility — use `<input list="...">` (datalist) instead of a select:

```html
<input list="classLevels" x-model="recordForm.classLevel" placeholder="e.g. P.1">
<datalist id="classLevels">
  <template x-for="c in classLevelOptions" :key="c">
    <option :value="c"></option>
  </template>
</datalist>
```

The user can type a brand new value and still gets autocomplete for values that already exist

---

## Rule: months — use Intl.DateTimeFormat, do not hardcode

```javascript
get monthOptions() {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(2000, m, 1);
    months.push({
      value: m + 1,
      label: d.toLocaleString('th-TH', { month: 'long' }) // long month name, localised
    });
  }
  return months;
}
```

---

## Rule: time slots — generate them by step

```javascript
get timeSlots() {
  const slots = [];
  for (let h = 8; h <= 17; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      slots.push(`${hh}:${mm}`);
    }
  }
  return slots;
}
```

---

## Rule: dropdowns that depend on the user role — filter on the client + double-check on the server

```javascript
get folderOptions() {
  if (this.user.role === 'admin') return this.folders;
  return this.folders.filter(f => f.OwnerUserID === this.user.userId);
}
```

**The server must enforce it too — never trust the client filter** (see `rules/security.md`)

---

## Rule: refresh the option list after creating a new row

```javascript
async doCreateRecord() {
  const res = await rpc('saveRecord', this.user.userId, this.recordForm);
  if (res.ok) {
    this.records.push(res.record);
    // the computed properties yearOptions/classLevelOptions recompute on their own — nothing to trigger
  }
}
```

Use Vue/Alpine computed → reactivity is automatic
