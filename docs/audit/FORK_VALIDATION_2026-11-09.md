# CyberStrike fork: validation baseline and safety gates

**Audit date:** 2026-11-09  
**Repository:** `ryansctt1994-sudo/CyberStrike`  
**Base branch:** `main`  
**Frozen baseline SHA:** `a36d9d52875c10293f6bbbf279b6d0fdce6cdded`  
**Upstream:** `CyberStrikeus/CyberStrike` (independent repository and change stream)  
**Disposition:** HOLD — do not claim build or runtime safety until CI executes and evidence is retained.

## Observed facts (not extrapolated conclusions)

- The fork's default branch is `main`; upstream-oriented workflows targeted `dev`.
- At the start of this audit, the fork returned **zero recorded GitHub Actions runs**. This is not a passing or failing test result.
- Root `bun test` is intentionally a failing guard; `bunfig.toml` also excludes root test discovery.
- The root package specifies `bun@1.3.9`, and packages provide their own scripts.
- The parent repository has advanced substantially beyond this fork. A fork-to-upstream compare reported **3,565 upstream commits** after the fork base on the audit date. This is *not* evidence of runtime compatibility.
- A comment-triggered workflow did not constrain invocation to trusted commenters before this patch.
- The issue-opened duplicate assistant runs a remote install script and invokes a configured AI provider. This patch keeps that upstream automation disabled in the fork.

## Proposed repairs and their boundaries

1. Enable test and typecheck triggers on fork `main`, while retaining upstream `dev` coverage.
2. Enable CodeQL on pull requests into `main` (the push trigger already included it).
3. Make the Bun workspace install explicitly lockfile-frozen on CI.
4. Restrict the comment agent to GitHub comment authors with `OWNER`, `MEMBER`, or `COLLABORATOR` association. This is an invocation gate, **not** a sandbox for the model or action dependency.
5. Disable the upstream-specific automated issue assistant in this fork by repository identity.
6. Correct `AGENTS.md` fork branch guidance.

## Suggested verification commands

Run only in a disposable, network-restricted environment with no production tokens and no external targets.
Review shell scripts, packages and dependency hooks before installation. Do **not** invoke the offensive CLI or third-party installer as part of CI verification.

```sh
bun --version                        # expect 1.3.9
bun install --frozen-lockfile
bun turbo test                       # correct workspace test entry point
bun typecheck                        # root delegates to Turborepo
bun --cwd packages/cyberstrike run build
bun --cwd packages/app run build
```

These commands are a procedure, **not an assertion that they have passed**. The UI end-to-end tests are a separate gate; see `packages/app/package.json` and `playwright.config.ts`.

## Evidence acceptance checklist

- [ ] PR workflow runs exist for commit SHA and are associated with this branch.
- [ ] Install job used the frozen lockfile and exact Bun version.
- [ ] Unit tests pass with job IDs and logs retained.
- [ ] Typecheck passes with job IDs and logs retained.
- [ ] CodeQL completes for JavaScript/TypeScript and Python; investigate exclusions.
- [ ] Build passes in a disposable runner with artifact hashes and logs retained.
- [ ] Independently test comment authorization, including untrusted `NONE` or `CONTRIBUTOR` identities.
- [ ] Review `CyberStrikeus/CyberStrike/github@latest` pinning and any `curl | bash` steps before enabling credentials.
- [ ] Audit credentials, networking, tool permissions, and consent boundaries before runtime tests.
- [ ] Independently reconcile upstream changes; do not automatically merge thousands of commits into a stale fork.

## Does not establish

No successful build, test-suite result, model capability, exploit success, runtime safety, signing implementation, security guarantee, or independent reproduction is asserted by this document. Passing lint/CI alone cannot substantiate operational security.


## Nov 9–10 follow-up: executable mock-event authorization

The original static-only comment authorization check has been **superseded** by a separate, credential-free Node preflight. The fork's agent workflow is now explicitly **disabled** unless the repository identity equals the upstream project `CyberStrikeus/CyberStrike`. No fork comment, including a trusted collaborator's comment, should enter the credentialed agent job as currently configured.

Files:
- `.github/scripts/agent-gate.mjs` — pure authorization predicate and fail-closed event-file CLI.
- `.github/scripts/agent-gate.test.mjs` — 23 executed local Node tests, including mock CLI calls and negative mutation controls.
- `.github/workflows/agent-gate-test.yml` — standalone no-model-secret PR check.
- `docs/audit/COMMENT_GATE_LOCAL_RESULTS_2026-11-09.json` — machine-readable execution claim, file SHA-256 hashes, and limits.

**Observed local execution:** 23/23 tests passed under Node v22.16.0. These results were produced in the assistant's local disposable environment, not GitHub Actions and not by an independent reviewer.

**Still blocked:** GitHub Actions execution evidence; real GitHub webhook authorization semantics; the unpinned `CyberStrikeus/CyberStrike/github@latest` dependency; the remote installer; permission boundary verification; Bun application build/tests and CodeQL.

The upstream action's README documents `MOCK_TOKEN` and an AI-provider key alongside `MOCK_EVENT`: its upstream development harness is **not** credential-free. The new local preflight does not execute that action, does not require a GitHub PAT or provider key, and does not contact external targets.
