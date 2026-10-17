# Contributing

Thanks for wanting to contribute! The best new rules come from real bugs — if you have ever spent longer debugging GAS than it should have taken, that is exactly the material a good rule is made of.

## How to add a new rule

1. Create a new file at `rules/<topic>.md`, or add a rule to an existing file
2. Follow this template:

```markdown
## Rule #N: <one short sentence stating the rule>

**Why:** <reason — a real bug / pitfall / quota limit>

### ✗ Bad

\`\`\`javascript
// code that breaks, with a comment pointing at what breaks
\`\`\`

### ✓ Good

\`\`\`javascript
// the pattern that actually works
\`\`\`

**Edge case:** <exception / trade-off / when not to apply — if any>
```

3. Update the `README.md` table + the `SKILL.md` mapping if you add a file
4. Open a PR describing:
   - The context where you hit the bug (production / dev / scale of the job)
   - The actual error message, if you have it
   - Links to the relevant Google documentation

## Rule-writing principles

- **Specific beats general** — "do not call `setValues` on a sheet with merged cells" is better than "be careful with setValues"
- **Explain why, not just how** — the reason is what stops the agent from re-introducing the bug
- **Ship both bad and good code** — it should be copy-pasteable as-is
- **Put trigger keywords in the `description`** of the SKILL.md frontmatter so the agent can find the skill

## Rules that should NOT be added

- General JavaScript rules (no `var`, use `===`) — they are not GAS-specific
- Rules that contradict Google's official docs without evidence
- Rules based on personal preference — there must be a technical or user-facing reason

## Language

This repository is written in **English only**. Rules, examples, and comments must be
written in English, and user-facing message strings in examples must be English as well.
The underlying principle the rules teach — *match the message to the user's language* —
still applies to the code an agent generates for a non-English product; only this
repository's own content is English-only.

## License

Merged PRs fall under the same MIT license as the repository.