# Security policy

## Supported versions

Security fixes ship in a new release of the latest published version of `paracosm`. Older versions are not patched.

## Reporting a vulnerability

Report it privately through GitHub: open the [security advisory form](https://github.com/framerslab/paracosm/security/advisories/new), or email team@frame.dev. Do not open a public issue, pull request or chat message about a vulnerability.

## Response

A maintainer acknowledges a report within 5 business days and sends an assessment and a plan within 14 days.

## Disclosure

A fix ships before details are published, and the reporter is credited unless they decline. At 90 days from the report an advisory is published with the fix or, when no fix exists, with mitigations, unless the reporter and a maintainer agree a later date.

## Scope

In scope: defects in this repository's code, including how the CLI and the dashboard server handle API keys, documents and URLs given to the compiler, scenario files, stored runs and sessions, and the HTTP API with its admin routes and rate limits. Out of scope: a flaw in AgentOS itself, which belongs in the [agentos](https://github.com/framerslab/agentos/security/policy) repository; a flaw that exists only in a third-party provider's service; and a flaw that exists only in a deployment's own configuration. Model output, tool results, documents given to the compiler and fetched web pages are untrusted input.
