# Contributing

## Development Setup

```bash
npm install
npm run lint
npm test
npm run build
```

## Branch Strategy

- `main` is the release branch
- Feature work should be small and reviewable
- Keep commits scoped to one concern
- Published semver tags are immutable; release follow-up fixes go to `main` and ship in the next version

## Coding Standards

- TypeScript strict mode compatibility
- No secret logging
- Prefer typed errors and explicit guards
- Keep UI responsive on small screens

## Before Opening PR

1. Run lint, tests, and build.
2. Confirm no debug artifacts are committed.
3. Update docs and changelog if user-facing behavior changed.
4. Include manual test notes for iOS-helper or desktop flows.

## Docs Publishing

The repository already includes a GitHub Pages deployment workflow at `.github/workflows/docs.yml`.

To enable it:

1. Open repository Settings.
2. Go to Pages.
3. Set `Build and deployment > Source` to `GitHub Actions`.
4. Push to `main` and verify the `Docs` workflow succeeds.

Local docs validation commands:

```bash
npm run docs:build
npm run docs:preview
```

## Release Discipline

1. Cut release tags only from a clean local `main` that matches `origin/main`.
2. Treat `v*` tags as publish records, not moving targets.
3. If GitHub Actions or Pages needs a post-release fix, merge it to `main` and include it in the next semver release rather than force-updating the existing tag.
