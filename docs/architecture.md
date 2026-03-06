# Architecture

Sidelink has four major runtime surfaces:

- Express server (`src/server`)
- React client (`src/client`)
- Electron desktop shell (`src/desktop`)
- SwiftUI iOS helper (`ios-helper/SidelinkHelper`)

## Server Layers

- Routes: HTTP endpoints and auth checks
- Services: business logic (auth, devices, Apple, signing, install, scheduler)
- Pipeline: install state machine with SSE progress
- State: SQLite schema, migrations, and durable records
- Utilities: crypto, error types, redaction, command wrappers

## Install Pipeline

1. Validate input and IPA metadata
2. Authenticate Apple session
3. Provision app ID/profile/cert
4. Sign IPA
5. Install to device
6. Register installed app for lifecycle tracking

## Helper Pairing

- Desktop generates short-lived 6-digit pairing code
- iOS helper submits code to `/api/system/pair`
- Server validates, issues helper token, and expires code

## Security Model

- Session-based dashboard auth
- Rate-limited mutation routes
- Typed request validation
- Secrets encrypted at rest
- Log and error redaction for credentials/tokens

For deep implementation details, see root `ARCHITECTURE.md`.
