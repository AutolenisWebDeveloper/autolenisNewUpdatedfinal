# Vendored: Superpowers plugin

This directory is a **local Claude Code plugin marketplace** committed into the repo so the
`superpowers` plugin resolves from disk. The hosted Claude Code environment does not fetch the
upstream GitHub marketplace, and `/plugin` is unavailable there, so the plugin was declared in
`.claude/settings.json` but never actually loaded (see the availability caveat in the repo
`CLAUDE.md`). Vendoring it fixes that.

## Source / provenance

| | |
| --- | --- |
| Upstream plugin | https://github.com/obra/superpowers |
| Upstream marketplace | https://github.com/obra/superpowers-marketplace |
| Version | v6.3.0 |
| Commit | b36e0829c6d0140e93cfef2ca599b1b07d4a7797 |
| License | MIT (see `superpowers/LICENSE`) |

## What was vendored

Only the runtime-essential parts of the plugin are included:

- `superpowers/.claude-plugin/plugin.json` — plugin manifest
- `superpowers/skills/` — all 14 skills (auto-discovered by Claude Code)
- `superpowers/hooks/` — the `SessionStart` hook that injects the `using-superpowers` skill
- `superpowers/README.md`, `superpowers/LICENSE`, `superpowers/package.json`

Dropped (not needed at runtime): `.git`, the other editor packagings
(`.codex-plugin`, `.cursor-plugin`, `.devin-plugin`, `.hermes-plugin`, `.kimi-plugin`, `.opencode`,
`.pi`, `.agents`), `tests/`, `docs/`, `assets/`, root dev `scripts/`, and `RELEASE-NOTES.md`.

## How it is wired

`.claude/settings.json` registers this directory as a marketplace and enables the plugin:

```json
"extraKnownMarketplaces": {
  "superpowers-marketplace": {
    "source": { "source": "directory", "path": ".claude/plugins/superpowers-marketplace" }
  }
},
"enabledPlugins": { "superpowers@superpowers-marketplace": true }
```

Claude Code copies the plugin into its per-user cache and sets `${CLAUDE_PLUGIN_ROOT}`; the
`SessionStart` hook and the 14 skills then load natively. The skills appear via the `Skill` tool
namespaced as `superpowers:<skill-name>`.

## Updating

To bump the vendored version:

```bash
git clone --depth 1 https://github.com/obra/superpowers.git /tmp/sp
rm -rf .claude/plugins/superpowers-marketplace/superpowers
mkdir -p .claude/plugins/superpowers-marketplace/superpowers
cp -R /tmp/sp/.claude-plugin /tmp/sp/skills /tmp/sp/hooks \
      /tmp/sp/LICENSE /tmp/sp/README.md /tmp/sp/package.json \
      .claude/plugins/superpowers-marketplace/superpowers/
rm -f .claude/plugins/superpowers-marketplace/superpowers/.claude-plugin/marketplace.json
# then update the version fields in marketplace.json and this file
```

## Note on precedence (AutoLenis)

Several superpowers skills overlap in intent with this repo's own architecture skills
(`systematic-debugging` vs `autolenis-debugging`, `test-driven-development` /
`verification-before-completion` vs `autolenis-testing-quality-gates` /
`autolenis-code-verification` / `autolenis-production-readiness`). Per the repo `CLAUDE.md`
source-of-truth hierarchy, the **`autolenis-*` project skills remain authoritative** for AutoLenis
business rules, architecture, and the mandatory verification pipeline. Superpowers provides
general-purpose technique; it does not override the AutoLenis pipeline.
