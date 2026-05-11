# Releasing

How to cut a new release of `claude-code-session-viewer`. The first time you
publish, work through the **One-time setup** section; afterwards every release
is just the **Cutting a release** steps.

## One-time setup

### 1. npm account

Sign up at <https://www.npmjs.com/signup>, then on this machine:

```bash
npm login
# → opens browser, do device auth
npm whoami     # should print your username
```

If you want two-factor auth on publish (recommended), enable it on npm:
<https://docs.npmjs.com/configuring-two-factor-authentication>.

### 2. GitHub auth (already done if `gh auth status` works)

```bash
gh auth login
# Choose: GitHub.com → HTTPS → Authenticate Git with credentials
#         → Login with a web browser → paste the one-time code
gh auth status     # should print your account
```

### 3. Sanity-check the package once

```bash
npm run build           # also runs scripts/scrub-build.js
npm pack --dry-run | tail -20   # what would be uploaded
node scripts/check-no-leaks.js  # confirm no /home/<user> leaks
```

## Automated path (recommended)

Once `NPM_TOKEN` is configured as a repo secret (see below), every push of a
`v*` tag triggers `.github/workflows/release.yml`:

```bash
$EDITOR CHANGELOG.md                              # move [Unreleased] → [X.Y.Z]
git commit -am "docs: changelog for vX.Y.Z"
npm version <patch|minor|major> -m "chore: release v%s"
git push --follow-tags                            # the tag push fires CI
```

CI then runs `npm ci` → build + scrub → leak check → `npm publish --access
public --provenance` → `gh release create`. Provenance gives the npm package
page a "verified" badge linking back to the source commit + workflow run.

Watch the run at `https://github.com/eric050828/claude-code-session-viewer/actions`.
On failure, no publish happens and no tag-side effects need cleaning.

### One-time setup for CI

1. Generate a Classic **Automation** token at
   <https://www.npmjs.com/settings/eric050828/tokens> (Automation type
   bypasses 2FA by design — that's the only kind CI can use today).
2. Add it as a secret named `NPM_TOKEN`:
   `Settings → Secrets and variables → Actions → New repository secret`.
3. Done. The workflow uses `secrets.NPM_TOKEN` automatically.

## Cutting a release manually

> Replace `<level>` with `patch`, `minor`, or `major` per semver. `npm version`
> does the version bump, commit, and tag in one shot.

```bash
# 1. Start from a clean working tree on master
git status                              # must be clean
git pull --ff-only                      # be up to date

# 2. Update CHANGELOG.md — move the [Unreleased] items into a new
#    [X.Y.Z] — YYYY-MM-DD section, update the link refs at the bottom.
$EDITOR CHANGELOG.md
git add CHANGELOG.md && git commit -m "docs: changelog for vX.Y.Z"

# 3. Bump version + tag (also commits package.json/package-lock.json)
npm version <level> -m "chore: release v%s"
#   creates commit "chore: release vX.Y.Z" and tag vX.Y.Z

# 4. Dry-run publish to make sure it would succeed
npm publish --dry-run

# 5. Real publish — runs prepublishOnly = build + check-no-leaks first
npm publish --access public
# (--access public is only required the very first time for an unscoped name)

# 6. Push the commit and the tag
git push origin master
git push origin --tags

# 7. Create the GitHub release from the tag, pulling notes from CHANGELOG
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-file <(awk '/^## \[X\.Y\.Z\]/,/^## \[/' CHANGELOG.md | sed '$d')
```

### One-shot script

The `release` script in `package.json` chains the build + dry-run for you:

```bash
npm run release:dry        # validate everything
npm version patch -m "chore: release v%s"
npm publish --access public
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

## Coming from PyPI? Quick rosetta

| PyPI                          | npm                             |
| ----------------------------- | ------------------------------- |
| `setup.py` / `pyproject.toml` | `package.json`                  |
| `bumpversion patch`           | `npm version patch`             |
| `python -m build`             | `npm run build`                 |
| `twine upload dist/*`         | `npm publish`                   |
| `twine upload --repository testpypi` | `npm publish --dry-run`  |
| `~/.pypirc`                   | `~/.npmrc` (created by `npm login`) |

Differences worth knowing:

- `npm version` automatically commits and tags. PyPI workflows usually do
  this manually.
- `npm publish` does **not** push your git changes — you still need
  `git push --follow-tags` afterwards.
- `prepublishOnly` runs locally before upload (here: build + leak guard).
  Equivalent to `before_publish` hooks in some PyPI tooling.
- The "tarball" you upload to npm is created on the fly from `package.json`'s
  `files` field — there is no `dist/` directory to clean up.

## Yanking a bad release

```bash
npm deprecate claude-code-session-viewer@X.Y.Z "Reason — use X.Y.Z+1"
# or, within 72 hours of publish:
npm unpublish claude-code-session-viewer@X.Y.Z
```

After 72 hours npm refuses unpublish; deprecate is the only option.
