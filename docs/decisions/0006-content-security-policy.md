# 6. A Content-Security-Policy without nonces

**Status:** accepted

## Context

The strictest CSP uses a per-request nonce for scripts. Nonces require every page to render dynamically, which gives up the prerendered static shell that Next.js Cache Components provides.

## Decision

Ship a static CSP from `next.config.ts`: `default-src 'self'`, no third-party script, frame, object, or form targets, `frame-ancestors 'none'`, and `script-src 'self' 'unsafe-inline'`.

## Consequences

- Pages keep their static shells.
- Inline script injection is not blocked by the CSP. The application's defences against XSS are React's escaping and never rendering user-supplied HTML; the CSP limits what injected markup could load or post to.
- A deployment with stricter requirements can move to nonces by generating the header in `src/proxy.ts`, accepting dynamic rendering.
