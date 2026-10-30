# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/giladfeldman/betterosf/security/advisories/new)
for this repository.

Include what you found, how to reproduce it, and which version (the running version is shown in
the badge at the bottom-right of the app and at `/api/health`).

## Scope

In scope: the BetterOSF application in this repository and its deployment at
<https://betterosf.vercel.app> (authentication and session handling, the OSF and Zenodo token
handling, the delete and backup paths, and the export and transfer tools).

Out of scope: the Open Science Framework, Zenodo, Vercel and other third-party services
themselves; report those to their operators.

## Secrets

This repository contains no credentials. Anyone running their own deployment must register their
own OAuth applications and keep all keys in environment variables (see `.env.example`).
