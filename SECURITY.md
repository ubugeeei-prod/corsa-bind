# Security Policy

## Supported Versions

See [docs/support_policy.md](./docs/support_policy.md) for the full support
matrix and compatibility policy.

In short:

- `main` receives fixes first
- the latest supported `0.x` release line is the intended external support target
- older tags should not be assumed to receive security fixes

## Reporting a Vulnerability

Please report vulnerabilities privately before public disclosure.

- Prefer a private GitHub security advisory if it is available for the repository.
- Otherwise, contact the maintainers directly and avoid opening a public issue with exploit details.

Please include:

- affected crate or package
- affected operating system and architecture
- reproduction steps
- whether the issue depends on a specific pinned Corsa upstream commit

## Hardening Principles

The project treats the following as security-relevant reliability controls:

- exact upstream pin verification for `ref/typescript-go`
- bounded transport queues and request timeouts
- subprocess cleanup and forced reap on shutdown
- explicit opt-in for upstream endpoints with known instability
