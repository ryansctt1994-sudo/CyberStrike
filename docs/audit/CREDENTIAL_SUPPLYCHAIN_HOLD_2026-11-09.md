# CS-SH-002 — Credential supply-chain hold and remote-skill containment

**Review date:** 2026-11-09 (America/Chicago)  
**Repository:** `ryansctt1994-sudo/CyberStrike`  
**Base validated commit:** `7632bbfe0a8e8e7a75b9ca2d71afa8110dc512d4`  
**Disposition:** HOLD_CREDENTIALED_AUTOMATION  
**Scope:** defensive CI restrictions, artifact provenance, and remote-skill file handling. No offensive execution.

## Trust boundaries examined

### 1. External GitHub action

The workflow previously used `CyberStrikeus/CyberStrike/github@latest`.
It is now pinned to upstream commit `7ace779e02f3c6bd3eb57e975e5c497499899604`; the fetched `github/action.yml` blob at that commit was `462e096aa08783103a8e86c842cdb48f8f9fd74e`.

**Critical limitation:** this action still invokes `curl -fsSL https://cyberstrike.io/install | bash`. Its own code retrieves a dynamically selected release and executes the downloaded binary. **The action SHA does not pin or verify the installed release.** The fork's agent job is still disabled via repository identity, and the action must not be supplied model or GitHub credentials.

### 2. Credential-bearing workflows

The following inherited jobs are held behind a job-level `github.repository == 'CyberStrikeus/CyberStrike'` check:
`cyberstrike` (preflight + runner), `review`, `pr-management`,
`duplicate-issues`, `beta`, `deploy`, `generate`, `nix-hashes`,
`publish`, `stats`, and `sign-cli`.
This is a fork-level execution hold, not a complete authorization model for upstream or future automated workflows.

### 3. Skill downloader

Previously `packages/cyberstrike/src/skill/discovery.ts` built filesystem paths directly from index-provided skill names and file paths, and extracted remote tar archives using `tar xzf` without verified safe-entry handling.

The patch:
- rejects unsafe skill names and relative file paths before downloading;
- requires same-origin resource URLs and rejects HTTP redirects;
- restricts ordinary remote index fetches to HTTPS, while retaining loopback HTTP for tests;
- places a 4 MiB ceiling on individual skill-file responses;
- refuses symlinked cache entries at checked paths and creates leaf files without following final-component symlinks;
- **disables remote archive ingestion entirely** until a vetted extractor with size, entry, link, path, and integrity enforcement is available.

**Residual limitations:** the cache is not content-addressed; pre-existing regular cached content is not cryptographically revalidated; some path checks remain subject to filesystem races; all remote skill metadata is untrusted; base URL validation is not a complete DNS/SSRF policy; the index response itself is not bounded by this patch. These constraints remain open review items.

### 4. MOCK_TOKEN scope clarification

The upstream `github/index.ts` harness uses `MOCK_EVENT` and a PAT-like `MOCK_TOKEN` with provider credentials. The fork's `.github/scripts/agent-gate.mjs` is a **separate pure authorization preflight**. Its 23 green tests establish rejection behavior for that specific function and GitHub job wiring—not equivalence to the upstream credentialed harness. No upstream agent path has been exercised by those tests.

## Acceptance gates for this PR

- [ ] Workflow hold tests pass in GitHub Actions on this PR head.
- [ ] Bun unit tests and typecheck pass at this head.
- [ ] Both CodeQL language jobs pass; analyze exclusions separately.
- [ ] Malicious skill index/file/archive tests show fail-closed refusals and no outside write.
- [ ] A reviewer confirms required functionality is intentionally disabled, not silently broken.
- [ ] Keep prior validated baseline and this PR separate; do not merge either without review.

## Does not establish

No release binary integrity, verified Ed25519 skill ingestion, safe archive extraction, general SSRF protection, action safety, malicious-actor-resistant provenance, end-to-end penetration testing, signed and reproducible builds, external independent validation, or entitlement to credentialed operation. Green CI is a **necessary, not sufficient**, gate.
