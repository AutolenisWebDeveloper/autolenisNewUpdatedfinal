# Superpowers Plugin Self-Test

Automated verification of whether the vendored **superpowers** plugin loaded at runtime
in this Claude Code session.

- **Date:** 2026-08-19
- **Repo:** autoleniswebdeveloper/autolenisnewupdatedfinal
- **Session:** 1d6a54ea-89e4-5f56-90e9-c8fb479d818d
- **Claude Code CLI:** `2.1.235 (Claude Code)` (env `CLAUDE_CODE_VERSION=2.1.42`)
- **Environment:** `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE=cloud_default` (hosted / remote container)

---

## 1. SessionStart injection — did context include a "You have superpowers." block?

**Result: NO — not present.**

The session context contains the standard Claude Code system prompt, the repo `CLAUDE.md`,
and the usual harness system-reminders. No block beginning with "You have superpowers."
(the string the superpowers SessionStart hook injects) appears anywhere in the received context.

## 2. Skill tool availability — any `superpowers:*` entries?

**Result: none visible.**

The available-skills system-reminder lists `autolenis-*` skills, `impeccable`, `task-observer`,
`pdf`, `design`, `dataviz`, `artifact-*`, and other built-ins. There are **no** `superpowers:*`
namespaced entries, and none of the individual superpowers skill names
(`brainstorming`, `systematic-debugging`, `test-driven-development`, etc.) appear in the listing
either.

## 3. Invoke a skill — `Skill(skill="superpowers:brainstorming")`

**Result: FAILED (both attempts).**

- `Skill(skill="superpowers:brainstorming")` → error, verbatim: `Unknown skill: superpowers:brainstorming`
- Fallback `Skill(skill="brainstorming")` → error, verbatim: `Unknown skill: brainstorming`

No SKILL.md loaded; the skill is not registered with the Skill tool in this session.

## 4. Files on disk

**Result: ALL PRESENT.**

`.claude/plugins/superpowers-marketplace/.claude-plugin/marketplace.json`
```
-rw-r--r-- 1 root root 736 Aug 19 17:19 marketplace.json
```
Declares marketplace `superpowers-marketplace` → plugin `superpowers` **v6.3.0** (author Jesse Vincent).

`.claude/plugins/superpowers-marketplace/superpowers/skills` — **14 skill dirs** (as expected):
```
brainstorming                 receiving-code-review        using-git-worktrees
dispatching-parallel-agents   requesting-code-review       using-superpowers
executing-plans               subagent-driven-development  verification-before-completion
finishing-a-development-branch systematic-debugging        writing-plans
                              test-driven-development       writing-skills
```

`.claude/settings.json` values:
```json
"extraKnownMarketplaces": {
  "superpowers-marketplace": {
    "source": { "source": "directory", "path": ".claude/plugins/superpowers-marketplace" }
  }
},
"enabledPlugins": {
  "superpowers@superpowers-marketplace": true
}
```

## 5. Git branch sanity — `git log --oneline -3`

**Result: commit present.**

```
988ffa0 Merge pull request #313 from AutolenisWebDeveloper/claude/install-superpowers-plugin-by6g1f
cbf8d47 Vendor superpowers plugin as a local marketplace
49fc268 Merge pull request #312 from AutolenisWebDeveloper/claude/y2-request-time-coverage-gate
```

The **"Vendor superpowers plugin as a local marketplace"** commit (`cbf8d47`) is present on this
checkout, along with its merge (PR #313).

---

## Verdict

The plugin is fully **vendored on disk and enabled in `.claude/settings.json`** (correct
marketplace source, `enabledPlugins` true, 14 skills, v6.3.0), but at **runtime it did not
activate**: no SessionStart "You have superpowers." injection, no `superpowers:*` skills exposed to
the Skill tool, and direct invocation fails with `Unknown skill`. This matches the `CLAUDE.md` note
that the hosted Claude Code environment does not activate the superpowers marketplace. The gap is
between "committed + enabled in config" and "loaded by the runtime" — the config is correct; the
hosted runtime is not honoring the local `directory`-source marketplace/plugin.

**VERDICT: superpowers loaded = NO** — vendored and enabled in config, but not activated by the
hosted Claude Code `2.1.235` (`cloud_default`) runtime (no SessionStart injection, no skills
registered, invocation returns `Unknown skill`).
