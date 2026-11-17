# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting for this repository (**Security → Report a vulnerability**). Include what you found, how to reproduce it, and the impact you expect. You should get an acknowledgement within a few days.

This is a personal open-source project with no bug bounty.

## Supported versions

Only the `main` branch receives fixes.

## Scope notes

PulseOps makes outbound HTTP requests to URLs that users supply (monitor checks and webhooks). Reports about bypassing the SSRF guard are especially welcome. The guard's design and its known limits are described in [docs/security.md](docs/security.md); please read the "Known limits" section first, since some gaps are documented rather than unknown.

`MONITOR_ALLOWED_PRIVATE_HOSTS` deliberately opens the guard for the hosts an operator lists. Behaviour that follows from an operator setting it is not a vulnerability.
