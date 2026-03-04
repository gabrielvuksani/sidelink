# Upgrade Roadmap — Productization to Production-Grade Sideload Manager

## Product direction

- Convert from demo artifact into a real product baseline
- Keep strict compliance stance (no jailbreak, no enterprise abuse, no piracy)
- Prioritize:
  1) premium UX
  2) helper-app auto-install integration
  3) 48h Wi‑Fi-preferred auto-refresh engine

## Final product name target

**Sidelink**

(Will be applied across package/app/docs/UI labels with backward-compatible aliases where practical.)

---

## Phase 1 — Productization + compatibility foundation

### Work

- Rename core branding to Sidelink:
  - package name, desktop product name, app title, docs headings
- Introduce new env namespace: `SIDELINK_*`
- Preserve backward compatibility by honoring legacy `ALTSTORE_*` env vars as fallbacks
- Rename default DB/cookie identifiers to Sidelink equivalents with legacy fallback

### Acceptance criteria

- No primary user-facing “AltStore Demo” branding remains
- Existing users with legacy env still run without breakage
- README commands/documentation reflect new naming

### Verification

```bash
npm run lint
npm test
npm run build
```

---

## Phase 2 — Backend model upgrades (scheduler + helper support)

### Work

- Extend domain types and SQLite persistence for:
  - per-install auto-refresh state (next attempt, last attempt, failure reason, retry count)
  - install category/source metadata (user app vs helper app)
  - transport/network context for refresh decisions
- Add safe schema migrations for existing DBs
- Add helper orchestration metadata endpoints

### Acceptance criteria

- Existing DB can be opened and migrated without destructive reset
- New fields persist across restart
- Dashboard APIs expose all scheduler state needed by premium UI

### Verification

```bash
npm test -- tests/persistence.test.ts
npm test -- tests/smoke.test.ts
```

---

## Phase 3 — Auto-refresh engine overhaul (48h + Wi‑Fi preference)

### Work

- Implement robust refresh planner:
  - trigger window starts at 48h before expiry
  - prefer Wi‑Fi transport when available
  - fallback strategy when Wi‑Fi unavailable
  - exponential retry/backoff with actionable reasons
- Persist attempt lifecycle fields
- Expand scheduler logs with clear failure causes and next-attempt timestamps

### Acceptance criteria

- Auto-refresh attempts are autonomous (no manual button needed)
- Wi‑Fi preference is deterministic and testable
- Failures produce retries with backoff and visible reasons

### Verification

```bash
npm test -- tests/scheduler.test.ts
npm test -- tests/persistence.test.ts
```

---

## Phase 4 — Helper app project (SwiftUI) + integration path

### Work

- Add in-repo SwiftUI project (`ios-helper/`) with:
  - installed app status + next refresh window
  - connectivity + refresh health panel
  - trigger refresh action via helper endpoint
- Add helper build/export scripts
- Detect local Xcode tooling readiness; graceful fallback when unavailable
- Integrate install pipeline with helper-first/ensure strategy:
  - helper auto-ensure during IPA install flow
  - skip with explicit unblock guidance when helper IPA unavailable

### Acceptance criteria

- Helper source project compiles in proper macOS/Xcode environment
- Pipeline attempts helper ensure automatically
- Missing toolchain path is handled gracefully (no silent failure)
- README includes exact unblock steps for local build/export

### Verification

```bash
npm test -- tests/real-worker.test.ts
npm test -- tests/smoke.test.ts
npm run lint
```

(Helper build itself is additionally verified in environments with Xcode installed.)

---

## Phase 5 — Premium UI/UX overhaul (fully wired)

### Work

- Replace current UI with a premium responsive control center:
  - lifecycle KPI dashboard
  - pipeline stage visualization
  - command audit explorer
  - settings + safety panel
  - auth/session + onboarding guidance
- Ensure every widget maps to real API state (no placeholders)
- Add richer error states and recovery cues

### Acceptance criteria

- Significantly improved visual quality and information architecture
- Command audits browsable per job from UI
- Scheduler, helper, and mode/safety state visible at a glance
- All interactive controls operate against live backend endpoints

### Verification

```bash
npm run build
npm test -- tests/smoke.test.ts
```

---

## Phase 6 — Quality hardening + documentation reality matrix

### Work

- Expand tests for:
  - auth/session hardening behavior
  - scheduler Wi‑Fi/backoff logic
  - helper auto-install orchestration
  - guarded real worker path
- Update README + ARCHITECTURE:
  - exact commands
  - desktop/web run paths
  - what is fully real vs platform-constrained
  - helper build/export and fallback behavior

### Acceptance criteria

- Lint/test/build all pass
- Docs match implementation exactly (no aspirational claims)
- Remaining limitations are explicit and actionable

### Verification

```bash
npm run lint
npm test
npm run build
npm run desktop:package
```

(Desktop dev launch command will also be validated in environment-appropriate mode.)

---

## Delivery discipline

Implementation loop policy:

1. Implement a coherent vertical slice
2. Run targeted verification
3. Fix regressions immediately
4. Continue next slice without pausing at cosmetic milestones

Stop only on:
- all feasible roadmap items complete, or
- hard platform/tool constraints with explicit unblock instructions documented.
