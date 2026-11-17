# 1. First-party session authentication

**Status:** accepted

## Context

The brief suggested Auth.js. For this application that meant choosing between Auth.js v4, whose credentials provider only supports stateless JWT sessions, and v5, which was still in beta at the time of writing. The application needs email-and-password sign-in, sessions that can be revoked per device, and organization roles. No library provides the last of those; it would be custom code either way.

## Decision

Implement sessions directly, following the well-documented opaque-token pattern:

- 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie
- SHA-256 of the token stored in a `Session` row
- argon2id for passwords, through a maintained native binding

The module is about 250 lines (`src/server/auth`) and uses only vetted primitives. No cryptography is invented.

## Consequences

- Sign-out, password change, and "sign out other devices" take effect immediately, which the tests assert.
- Handlers read the cookie header themselves, so they can be integration-tested without a server.
- OAuth, SSO, and MFA are not available. Adding OAuth would mean an `Account` table and a callback route, or adopting a library at that point.
