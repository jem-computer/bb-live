# Contributing

Use Node.js 22.19+ in the 22.x line, or Node.js 24.x/26.x, npm, and BB 0.43.1 with Plugin SDK 0.4.87. The plugin uses experimental SDK surfaces, so update the SDK pin and BB build version together when changing compatibility.

```sh
git clone https://github.com/jem-computer/bb-live.git
cd bb-live
npm ci
npm run check
bb plugin install .
```

`bb plugin dev` rebuilds and reloads an installed development checkout. Use BB Live's secret settings for API credentials. Automated tests use the SDK fake host and fake media; no OpenAI key is needed for the checks.

Run `npm run check` before opening a pull request. Explain the resulting behavior and what you verified. Keep VERIFICATION.md honest about mocked coverage versus real voice and device testing. Keep local screenshots, logs, databases, and recordings out of commits; the ignored `artifacts/` directory is for local evidence.

## Git distribution

This repository is one plugin, with its manifest in `package.json`. No collection manifest, npm publication, or marketplace registration is needed for direct GitHub installation. BB installs production dependencies and builds the declared TypeScript entry points. Runtime dependencies belong in `dependencies`; BB's runtime shims and development tools belong in `devDependencies`.

Before a release, verify the Git install build in a temporary checkout with `npm ci --omit=dev --omit=optional` followed by `bb plugin build`. This catches dependencies accidentally available only in a developer's node_modules. CI performs this check.

For a versioned release, update `package.json` and `package-lock.json`, run the checks and a full-history secret scan, then tag the audited commit `vX.Y.Z`. Never move a published release tag: BB records its commit and rejects retagging. Users can install a published version range with:

```sh
bb plugin install git:https://github.com/jem-computer/bb-live.git@^0.1.0
bb plugin outdated
bb plugin update bb-live
```

The range requires an existing matching release tag. The README's default-branch install works before the first tagged release. A BB Community listing can be submitted separately once the plugin is ready for wider discovery; `PLUGIN_OVERVIEW.md` is its listing copy.

## Secret checks

Install [Gitleaks](https://github.com/gitleaks/gitleaks), then run:

```sh
gitleaks dir . --redact=100
gitleaks git . --log-opts=--all --redact=100
git diff --cached --stat
```

Inspect the staged files as well. Gitleaks does not read text inside screenshots or establish that arbitrary workspace names and transcripts are safe to share. Use clearly artificial credentials in tests and do not add broad scanner exclusions to silence a finding.
