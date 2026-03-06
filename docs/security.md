# Security

## Principles

- Local-first storage and execution
- Explicit user-triggered mutation actions
- Defense in depth: validation, rate limits, redaction

## Request Hardening

- Typed validators for mutation endpoints
- Auth middleware and session checks
- Rate-limited sensitive routes with retry hints

## Data Protection

- Password hashing with strong KDF
- Secret encryption at rest
- Controlled token issuance for helper workflows

## Logging

- Structured logs with category codes
- Redaction for credentials, keys, and tokens

## Operational Safety

- Real execution gates to avoid accidental destructive actions
- Install pipeline state machine with explicit failure reasons
- Recovery and retry telemetry for refresh/install jobs
