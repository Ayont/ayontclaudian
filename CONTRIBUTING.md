# Contributing / Release Runbook

## ⚠️ Remotes — read this first

```
ayont     https://github.com/Ayont/ayontclaudian.git   ← push and release HERE
origin    https://github.com/Ayont/claudian.git        ← a DIFFERENT, older fork
upstream  https://github.com/YishenTu/claudian.git     ← the project this forked from
```

**`origin` is not the release target.** A bare `git push` goes to the wrong
repository, and `gh release create` without `--repo` resolves against `origin` and
fails with a misleading *"workflow scope may be required"* 404 — the token is fine,
the repo is wrong.

Always be explicit:

```bash
git push ayont main
gh release create <version> --repo Ayont/ayontclaudian ...
```

## Release process

Every step matters; the version must be consistent across three files or Obsidian
and BRAT disagree about what is installed.

```bash
# 1. Gate — all four must pass before anything else
npm run typecheck && npm run lint && npm run test && npm run build
#    lint must report 0 ERRORS. ~12 pre-existing warnings are expected — they are
#    all actionable. `obsidianmd/ui/sentence-case` is off on purpose (it enforces
#    English sentence case against a German UI); see eslint.config.mjs.

# 2. Bump. `npm version` runs scripts/sync-version.js, which propagates the
#    version into manifest.json and versions.json and stages them.
npm version minor --no-git-tag-version   # or patch / major

# 3. Rebuild so main.js carries the new version
npm run build

# 4. Deploy into the local vault to smoke-test
DEST="/path/to/vault/.obsidian/plugins/realclaudian"
cp main.js styles.css manifest.json "$DEST/"
#    Then reload the plugin in Obsidian (Community plugins → toggle off/on).

# 5. Commit + push to the RIGHT remote
git add -A
git commit -m "feat: ..."     # Conventional Commits
git push ayont main

# 6. GitHub release. Tag = bare version, NO leading `v`
#    (Obsidian/BRAT convention; a stray legacy `v5.0.0` tag exists — ignore it).
gh release create 5.91.0 main.js manifest.json styles.css \
  --repo Ayont/ayontclaudian \
  --title "5.91.0 — ..." \
  --notes "..."          # release notes are written in German
```

**Assets must be exactly these three:** `main.js`, `manifest.json`, `styles.css`.
BRAT downloads them by name.

### Tag creation: pick one path

`.github/workflows/release.yml` triggers on any tag push and creates a release with
auto-generated notes. `gh release create` creates the tag itself. Running both for
one version produces a duplicate/competing release.

**The documented path is `gh release create`** (it lets you write German release
notes and attach the built assets). Do not also push the tag separately.

### Environment note

Node lives at `~/.local/bin/node`, which some non-interactive shells do not have on
`PATH`. If `npm` is not found, prefix with:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## After the release

Update the changelog callout at the top of the project note
(`02-Projekte/ayontclaudian/ayontclaudian.md` in the maintainer's vault). The
detailed German changelog lives there, not in `CHANGELOG.md`.

## Code conventions

See [`CLAUDE.md`](CLAUDE.md) — in particular the **Traps** section, and the rule
that user-facing strings are German while all code is English.

Before opening a PR or committing:

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` — 0 errors
- [ ] `npm run test` — full suite green
- [ ] `npm run build` succeeds
- [ ] New behavior has a test in the mirrored `tests/` path
- [ ] Any provider capability claim (context window, effort level, CLI flag) was
      verified against the real binary or the bundled SDK typings — not assumed
