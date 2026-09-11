# Validation

Validated locally through 2026-09-12 with Node 22.23.1, Pi 0.85.1, Codex CLI 0.153.2, and Claude Code 2.1.263.

## Automated coverage

`npm test`: **51 tests passed**, including real Pi SDK sessions against a local scripted provider. The integration test exports a profile, imports it into a second store, runs it there, and verifies that starting configuration fingerprints match across storage paths with the same provider endpoint. It also executes imported extension code and an extension-defined model provider. A separate real-session test verifies `/share-start`, skill/tool/token collection, `/share-stop`, and that subsequent unmeasured activity does not change the saved record.

The v0.2 team tests start real HTTP registries and multiple local clients. They exercise CLI onboarding, profile publication and namespaced installation, token expiry/revocation, actor and scope enforcement, transaction rollback for rejected batches, strict rejection of trace fields, paginated incremental sync, offline retry, concurrent sync exclusion, registry reopening, and independent/conflicting assessments across devices. Version 1 file imports and version 2 score-history exchange are both covered. All team scenarios use generated fixture data and disposable credentials; no real team data is uploaded.

The v0.3 account tests cover protected first-admin setup and concurrent claims, session cookie attributes, Origin/CSRF enforcement, invitation identity and role binding, duplicate/replayed/revoked/expired links, last-admin protection, account disabling, device approval and polling, individual credential revocation, password reset and host-local recovery, persistent auth rate limits, and v0.2 database migration. A real CLI process completes browser-approved device pairing against the HTTP API. Another test revokes a session while its write body is still arriving and verifies the write is rejected.

Dashboard API tests check authentication, live/demo separation, setup inspection without embedded file bodies, human assessment history, and credential-free connection instructions. The built application and its script asset are served with the expected security headers. `npm run check` passes for both the Node service and the React dashboard; the production Vite build passes. A subsequent requested browser walkthrough exercised account setup, invitations, login, device approval/revocation, setup inspection/copying, activity, comparisons, assessments, filters, and password recovery. WebMCP registration, valid navigation/summary calls, invalid inputs, and logout cleanup were also verified in the supporting in-app browser. See [BROWSER-QA.md](BROWSER-QA.md) for the installed Pi CLI run, observed results, and fixes.

Other checks cover credential/session exclusion, content tampering, path traversal, symlinks, executable script permissions, project package overrides, strict metadata validation, duplicate/conflicting imports, unknown costs, failed/successful skill reads, exact committed Git blobs, changed-context rejection, and missing-model failures.

Scripted provider results validate the plumbing; they are not evidence of model quality.

## Shared skills and native harness validation — v0.4

Ten additional tests cover standalone skill publication, immutable versions, optimistic conflicts, supporting files and executable bits, compatibility enforcement, safe install destinations, version receipts, verified setup pins, and native configuration capture/materialization. Credential files, environment values, traces, memories, and project task instructions are excluded. Native setup and skill endpoints require authentication; catalogue metadata does not include skill contents. Existing Pi profiles and databases remain readable.

A real installed skill with malformed YAML revealed a capture failure. Native setup capture now preserves such skills as unpinned native resources, with a requirement to review their metadata. A regression test verifies unchanged supporting files and continued credential/receipt enforcement.

Native telemetry tests verify field selection, duplicate export handling, token/cache accounting, provider attribution, unavailable coverage, unverified completion, and metadata-only team sync. The local endpoint rejects browser-origin requests, unauthenticated writes, and trace exports. A regression test covers Codex's separate timing and usage events for one response.

`node scripts/verify-native.mjs codex` and `node scripts/verify-native.mjs claude-code` both passed against the installed CLIs. Each used disposable configuration, dummy credentials, and a scripted loopback model, with no paid model requests. Each recorded exactly one model call, 12 input tokens, and 2 output tokens. Claude emitted an estimated cost; Codex pricing remained unavailable. Raw payloads were not retained. These smoke checks do not validate every native tool/skill event or an actual provider invoice.

The browser walkthrough covered the shared skill card/drawer, harness-specific install command selection, native setup filtering/inspection, and capture/publish guidance. One example skill is pinned into three clearly named QA setups in `.demo/dashboard`; source fixtures are in `.demo/library-qa`. No new live measurements were fabricated. See [SKILLS-AND-HARNESSES.md](SKILLS-AND-HARNESSES.md) for operational instructions and limitations.

## Live model smoke test

Two seeded review profiles ran against the same small Git fixture using the locally configured `openai-codex/gpt-5.6-terra` model, with medium thinking. The fixture changed a percentage calculation from `price * (1 - percent / 100)` to `price * (1 - percent)`.

| Profile | Status | Turns | Tool calls | Skills observed | Input tokens including cache | Output tokens | Estimated USD | Duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | completed | 3 | 5 | 1 | 5,184 | 338 | 0.011659 | 13.6 s |
| callers | completed | 5 | 10 | 1 | 9,639 | 418 | 0.016000 | 20.2 s |

Both reviews identified the percentage normalization defect and the incorrect result for `discount(100, 20)`. Human outcome fields remain unscored. The fixture is too small to judge which setup is better. Costs are Pi usage estimates, not measured subscription charges.

The comparison used profile tool defaults and fresh in-memory sessions. Both runs retained the same frozen input hash:

```text
3acbb921c3a3d6504eb6082b6497986db8ef74454951419f2e3abbba89207833
```

Local artifacts, excluded from Git:

- Comparison: `.demo/live-store/work/comparisons/3171bcae-cd47-4b25-91c4-f5dc6482f00d/report.md`
- Baseline review: `.demo/live-store/work/runs/35db412b-ede2-4281-bb66-77bd251d0390/review.md`
- Callers review: `.demo/live-store/work/runs/fd86e92c-fdc8-47fb-8386-217d6b1789b5/review.md`

The user's current Pi configuration was also captured locally as `makina-current` without copying credentials. The live comparison used the two seeded profiles, not an actual colleague's configuration. Team profile exchange still needs a real colleague's export for that evaluation.

## Connected native CLI checks — 2026-09-11

The user requested connecting and testing both local native harnesses. Their separate device requests were approved through the dashboard under the existing QA admin account, and both CLIs verified their own connections. Each ran a real signed-in review of an isolated toy fixture with the same shared skill. Claude Code recorded 2 tool calls, 2 model calls, and USD 0.2827705 estimated usage; Codex recorded 3 tool calls and 3 model calls, with pricing unavailable. Both found the seeded percentage defect. Both native configuration files retained their original hashes. Only the two new usage records were uploaded; full setup snapshots and review text remain local. The populated Activity page and both connected device labels were verified in the browser. Local evidence and continuation commands are in `.demo/native-connection/README.md`.

## Audit remediation — 2026-09-12

The final service/dashboard type checks and production build pass. The 51-test suite adds 14 regression/integration cases to the previous 37 tests. New coverage includes all generated capability prefixes, metadata scanning, owner/admin withdrawal and embedded-skill blocking, purge retention, safe file inspection, same-identity reconnect with preserved state, full-period totals beyond 2,000 records, complete experiment groups, independent skill history filters, named trial ownership/revision/context/evaluation rules, periodic checkpoints/dead-process recovery, source drift (including reusable prompt files), proxy handling, quotas, deployment preflight, and real CLI trial preparation.

The 2,506-run fixture uses 2,505 runs in the current period plus a related experiment run outside it. It validates exact totals, activity pagination without overlap, and complete experiments. It does not establish a production capacity limit.

`registry doctor` passed local database integrity, private permissions, built assets, and schema checks. It correctly warns that this loopback installation has no trusted proxy configured and that remote TLS/routing/backup-restore verification is manual. A private consistent backup of `.demo/dashboard` was saved under `.demo/backups/before-audit-fixes-20260911-235518` before the first upgraded startup.

Browser verification exercised revision reloads, file/history diffs including added and removed files, native history selection, the former hidden-filter bug, mixed/native context labels, device status, admin operations, and mobile layouts at 390×844. Named trial creation, rejection of adoption without evidence, a persisted insufficient-evidence conclusion, and corresponding admin events were verified in an isolated database copy on port 4317. Its server was stopped after QA. No test trials, withdrawals, role changes, or additional measured runs were added to the working registry. No paid model calls were needed for this remediation pass.
