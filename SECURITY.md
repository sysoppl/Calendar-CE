# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

Report it privately through GitHub instead: **Security → Report a vulnerability** on this repository
(GitHub's private vulnerability reporting). Include what you found, how to reproduce it, and what an attacker could
do with it.

You'll get an answer within a few days. Once a fix is ready it's released, and you're credited in the release notes
unless you'd rather not be.

## Scope

This repository is the self-hostable Community Edition: the web app, its Node server with the DAV proxy, and the
Android app. Reports about these are in scope, for example:

- script injection or a way around the Content-Security-Policy
- the DAV proxy reaching hosts or networks it shouldn't, or leaking credentials
- CalDAV credentials stored or sent where they shouldn't be
- the end-to-end encryption in `src/lib/crypto/` (see `docs/ENCRYPTION.md`), which the hosted edition uses

The hosted E2EE Calendar at calendar.patryk.pro is a separate service and isn't part of this repository. Please
report anything about it the same private way, and don't test it in ways that could affect other people's
accounts or data.

## Supported versions

Only the latest release on `main` gets security fixes.
