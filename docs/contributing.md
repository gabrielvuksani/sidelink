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
