# gas-best-practices

> Agent skill — Google Apps Script best practices distilled from real production bugs.
>
> Use it with Claude Code, OpenCode, Cursor, Codex, or any other agent so it follows
> production-tested patterns when writing or reviewing GAS code.

Distilled from bugs that actually shipped to production: merged-cell write failures,
signature images that rendered as broken icons in PDFs, optimistic locks that wiped
179 bookings, and a 6-minute batch job that died halfway with half the data written.

---

## 📦 Installation

### Option 1 — `npx skills` (works with 75+ agents, recommended)

The [skills](https://github.com/vercel-labs/skills) CLI detects your installed agents
and links the skill into each one.

```bash
# preview what will be installed
npx skills add nervmouse/gas-best-practices --list

# install to every detected agent
npx skills add nervmouse/gas-best-practices -y

# install to a specific agent, globally (available in all projects)
npx skills add nervmouse/gas-best-practices -a claude-code -g -y
npx skills add nervmouse/gas-best-practices -a opencode -g -y

# copy the files instead of symlinking (needed on Windows without Developer Mode)
npx skills add nervmouse/gas-best-practices -a claude-code --copy
```

Installed paths per agent:

| Agent | `--agent` | Project path | Global path |
|---|---|---|---|
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.agents/skills/` |
| Cline | `cline` | `.agents/skills/` | `~/.agents/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |
| Continue | `continue` | `.continue/skills/` | `~/.continue/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |

> **Requires Node.js >= 22.20.0.** The `skills` CLI declares that engine requirement;
> on Node 20 it fails with `SyntaxError: node:util does not provide an export named 'styleText'`.
> On Node 20, use Option 2 or 3 instead.

Update or remove it later:

```bash
npx skills list                    # list installed skills
npx skills update gas-best-practices -y
npx skills remove gas-best-practices -y
```

### Option 2 — Claude Code one-liner

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/nervmouse/gas-best-practices/main/install.sh | bash
```

Windows PowerShell:

```powershell
iwr -useb https://raw.githubusercontent.com/nervmouse/gas-best-practices/main/install.ps1 | iex
```

### Option 3 — Manual git clone (any OS, any agent)

```bash
git clone https://github.com/nervmouse/gas-best-practices ~/.claude/skills/gas-best-practices
```

Windows, where `~` is not expanded:

```powershell
git clone https://github.com/nervmouse/gas-best-practices "$HOME\.claude\skills\gas-best-practices"
```

### Verify installation

```bash
ls ~/.claude/skills/gas-best-practices
# should show: SKILL.md, rules/, README.md, ...
```

Then **restart your agent** to load the skill. It auto-triggers when:

- Your project contains `.clasp.json` or `appsscript.json`
- You edit `.gs` or `.js` files in a clasp project
- You mention "Google Apps Script", "GAS", or "clasp" in a prompt

### Check status

```bash
bash ~/.claude/skills/gas-best-practices/check.sh        # macOS / Linux
& "$HOME\.claude\skills\gas-best-practices\check.ps1"     # Windows PowerShell
```

Shows the current version, rule count, and whether updates are available.

### Update to latest

```bash
bash ~/.claude/skills/gas-best-practices/update.sh        # macOS / Linux
& "$HOME\.claude\skills\gas-best-practices\update.ps1"     # Windows PowerShell
```

Or manually, for a manual clone:

```bash
cd ~/.claude/skills/gas-best-practices && git pull
```

After updating — **restart your agent** to load the new version.

### Uninstall

```bash
rm -rf ~/.claude/skills/gas-best-practices                          # macOS / Linux
Remove-Item -Recurse -Force "$HOME\.claude\skills\gas-best-practices"   # Windows PowerShell
```

Or, if installed with the `skills` CLI:

```bash
npx skills remove gas-best-practices -y
```

---

## 🔍 Test that it works

Open a GAS project and ask your agent:

> "Review Code.gs for me"

The agent should cite patterns from this skill — for example recommending a `Result`
envelope, `LockService`, or `Logger.log` at RPC boundaries.

---

## 🤖 Using it with other AI tools

The rules in `rules/` are plain markdown, so they work with any tool. `npx skills`
(the install above) covers 75+ agents automatically. The rest of this section covers
tools that do not read skills at all.

### Cursor / Windsurf / Cline (legacy rule files)

```bash
curl -O https://raw.githubusercontent.com/nervmouse/gas-best-practices/main/.cursorrules
```

Then commit the repo (or a copy of `rules/`) next to your project so the agent can
read `rules/*.md`.

### ChatGPT / Claude.ai web / Gemini chat

Use **`PROMPT.md`**, which bundles every rule into a single file:

1. Download: <https://raw.githubusercontent.com/nervmouse/gas-best-practices/main/PROMPT.md>
2. Copy the whole file
3. Paste it into:
   - **ChatGPT Custom GPT** → Instructions field
   - **ChatGPT Project** → Project knowledge
   - **Claude.ai Project** → Project knowledge / custom instructions
   - **Gemini Gem** → Instructions

It is roughly 5,100 lines (~172 KB) — small enough for the context window of every
current mainstream model.

> `PROMPT.md` is generated automatically by `build.sh` — edit `rules/*.md` and re-run
> `./build.sh`. CI fails the PR if it is out of sync.

### GitHub Copilot

Copilot does not read external rule files, but it does read `.github/copilot-instructions.md`:

```bash
mkdir -p .github
curl -o .github/copilot-instructions.md \
  https://raw.githubusercontent.com/nervmouse/gas-best-practices/main/AGENTS.md
```

### Aider

```bash
aider --read /path/to/gas-best-practices/AGENTS.md \
      --read /path/to/gas-best-practices/rules/spreadsheet-ops.md
```

### Continue.dev

In `.continue/config.json`:

```json
{
  "contextProviders": [
    {
      "name": "file",
      "params": {
        "filePath": "/path/to/gas-best-practices/PROMPT.md"
      }
    }
  ]
}
```

### Which file to use with which tool

| AI tool | File to use |
|---|---|
| **Any skills agent** (recommended) | `npx skills add nervmouse/gas-best-practices` |
| **Claude Code** | `SKILL.md` (auto-loaded from `~/.claude/skills/`) |
| **OpenCode** / **Gemini Code Assist** | `AGENTS.md` (read automatically) |
| Cursor (legacy) | `.cursorrules` |
| Windsurf (legacy) | `.windsurfrules` |
| Cline (legacy) | `.clinerules` |
| GitHub Copilot | copy `AGENTS.md` → `.github/copilot-instructions.md` |
| Aider | `--read AGENTS.md --read rules/*.md` |
| Continue.dev | `PROMPT.md` in config |
| ChatGPT / Claude.ai web / Gemini chat | paste `PROMPT.md` into custom instructions / project knowledge |

## Contents

| Rule file | What it covers |
|---|---|
| [project-structure.md](rules/project-structure.md) | clasp, appsscript.json, file split, naming |
| [spreadsheet-ops.md](rules/spreadsheet-ops.md) | bulk read/write, merged-cell gotcha, column index, % handling |
| [web-app-rpc.md](rules/web-app-rpc.md) | `google.script.run`, Result envelope, bundling, optimistic updates |
| [htmlservice-frontend.md](rules/htmlservice-frontend.md) | viewport meta, `createHtmlOutputFromFile`, partial include, template syntax, mobile debug |
| [external-frontend.md](rules/external-frontend.md) | GitHub Pages/Netlify + GAS API, camera capture, CORS workaround (text/plain), session token, PWA |
| [pdf-generation.md](rules/pdf-generation.md) | template placeholders, signature anchor, image trim, business guard |
| [drive-ops.md](rules/drive-ops.md) | Config sheet, lazy folder creation, **signature preview via base64**, sharing |
| [lock-service.md](rules/lock-service.md) | concurrency control, timeout choice, finally release |
| [cache-service.md](rules/cache-service.md) | TTL strategy, invalidation, size limits, cache key bound to the code version |
| [data-integrity.md](rules/data-integrity.md) | mandatory `rev`, circuit breaker against bulk deletes, no client overwrite of server fields, verify identity rather than totals |
| [dynamic-dropdowns.md](rules/dynamic-dropdowns.md) | year/month/enum dropdowns that are not hardcoded, datalist pattern |
| [security.md](rules/security.md) | requireUser/Role, session tokens, password hashing, OAuth scope |
| [schema-migrations.md](rules/schema-migrations.md) | idempotent ensureSchema, column add, version tracking |
| [error-handling.md](rules/error-handling.md) | Result envelope, user-facing message in the user's language, translate GAS errors, retry |
| [onopen-menu.md](rules/onopen-menu.md) | custom menu, separators, toast vs alert, sub-menu |
| [testing-debugging.md](rules/testing-debugging.md) | Logger.log pattern, e2e via doPost, timing, quota |
| [logging-boundaries.md](rules/logging-boundaries.md) | log at the RPC boundary (client + server), mask sensitive values, copy-debug-info UX, version stamp |
| [triggers.md](rules/triggers.md) | time-driven / installable triggers, duplicate-trigger prevention, onFormSubmit (namedValues), trigger authorization |
| [urlfetch-external-api.md](rules/urlfetch-external-api.md) | muteHttpExceptions, retry+backoff, fetchAll, LINE Messaging API, quota |
| [deployment-versioning.md](rules/deployment-versioning.md) | /dev vs /exec, clasp deploy -i, rollback, .claspignore, version stamp |
| [long-running-jobs.md](rules/long-running-jobs.md) | getting past the 6-minute limit — checkpoint + continuation trigger, submit+poll |
| [email-notifications.md](rules/email-notifications.md) | MailApp vs GmailApp, quota email, throttled error alert |
| [properties-service.md](rules/properties-service.md) | Script/User/Document properties, criteria for Properties vs Config sheet |

## Real bugs these rules prevent

- 🐛 **"Service error: Spreadsheet"** during `range.setValues()` on a template that has merged cells → [spreadsheet-ops.md](rules/spreadsheet-ops.md)
- 🐛 **PassPercent = 500%** because the client computed it wrong and the server trusted it verbatim → [spreadsheet-ops.md](rules/spreadsheet-ops.md) Rule #8
- 🐛 **Signature preview renders as a broken image** because a Drive URL was used directly instead of being converted to base64 → [drive-ops.md](rules/drive-ops.md) Rule #3
- 🐛 **Signature overlaps other rows in the PDF** because the image still had whitespace and no anchor offset was set → [pdf-generation.md](rules/pdf-generation.md) Rule #4, #6
- 🐛 **Year dropdown expires in 2026** because 2024-2026 was hardcoded → [dynamic-dropdowns.md](rules/dynamic-dropdowns.md)
- 🐛 **Lock stuck for 6 minutes** because `finally { releaseLock() }` was forgotten → [lock-service.md](rules/lock-service.md) Rule #4
- 🐛 **Two people generate a PDF at once → temp sheet name collision** → [lock-service.md](rules/lock-service.md)
- 🐛 **"Permission denied: DriveApp"** on a school/agency Google Workspace account because `setSharing(ANYONE_WITH_LINK)` is blocked by domain policy → [drive-ops.md](rules/drive-ops.md) Rule #4.1
- 🐛 **Web app is not responsive on mobile** because the AI put the viewport meta tag in the `.gs` file instead of the `.html` → [htmlservice-frontend.md](rules/htmlservice-frontend.md) Rule #1
- 🐛 **Phone number `0812345678` becomes `812345678`** because Sheets auto-parses it as a number — requires `setNumberFormat('@')` or a `'` prefix → [spreadsheet-ops.md](rules/spreadsheet-ops.md) Rule #6.6
- 🐛 **A `Date` object sent from the server arrives at the client as `{}`** because `google.script.run` does not serialize Date → [spreadsheet-ops.md](rules/spreadsheet-ops.md) Rule #6.1
- 🐛 **`getUserMedia` does not work in a web app** because the GAS iframe blocks it — the frontend has to move to GitHub Pages → [external-frontend.md](rules/external-frontend.md)
- 🐛 **CORS error when fetching a GAS endpoint** because it sends `Content-Type: application/json` (which triggers a preflight) — must use `text/plain` → [external-frontend.md](rules/external-frontend.md) Rule #1
- 🐛 **"Sorry, cannot open this file right now"** when the machine has multiple Google accounts — fix with `?authuser=` or `/u/<n>/` → [external-frontend.md](rules/external-frontend.md) Rule #8.1
- 🐛 **Daily report sent 3 times** because setup was run several times → 3 stacked triggers → [triggers.md](rules/triggers.md) Rule #1
- 🐛 **`clasp push` succeeded but `/exec` still serves the old code** because a deployment pins a version — requires `clasp deploy -i` → [deployment-versioning.md](rules/deployment-versioning.md) Rule #1-#2
- 🐛 **A batch job died at the 6-minute mark with half the data written** because there was no checkpoint + continuation trigger → [long-running-jobs.md](rules/long-running-jobs.md) Rule #2
- 🐛 **An optimistic lock let a stale tab wipe 179 bookings** over three weeks because the `rev` gate was bypassable → [data-integrity.md](rules/data-integrity.md)

## Repository structure

```
gas-best-practices/
├── SKILL.md             # entry point read by skills agents (has frontmatter)
├── AGENTS.md            # entry point for non-skills AI tools
├── README.md            # GitHub front page
├── CHANGELOG.md         # version history
├── CONTRIBUTING.md      # how to add a rule
├── LICENSE              # MIT
├── install.sh           # one-liner setup for Claude Code
├── install.ps1
├── build.sh             # generates PROMPT.md + syncs .clinerules/.windsurfrules
├── rules/               # rules split by topic — every file is standalone (23 files)
│   ├── project-structure.md
│   ├── spreadsheet-ops.md
│   └── ...
├── evals/               # test prompts for measuring the skill
│   └── evals.json
└── examples/            # example code that actually uses the rules
    └── web-app-skeleton/   # login + RPC + Lock in 5 files
```

## Contributing

PRs welcome! After editing `rules/*.md` or `.cursorrules`, run `./build.sh` to
regenerate `PROMPT.md` / `.clinerules` / `.windsurfrules` before committing
(CI checks that they are in sync). This repository is English-only — see
[CONTRIBUTING.md](CONTRIBUTING.md). Each rule follows this template:

```markdown
# <Topic>

## Rule #N: <one short sentence stating the rule>

**Why:** <reason — a real bug you have actually hit>

### ✗ Bad
\`\`\`javascript
// code that breaks
\`\`\`

### ✓ Good
\`\`\`javascript
// the pattern that actually works
\`\`\`

**Edge case:** <exception, if any>
```

## License

MIT