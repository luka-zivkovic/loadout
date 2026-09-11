# Browser and installed Pi QA — 2026-09-09

## Native harness library follow-up — 2026-09-11

The v0.4 dashboard was checked in the in-app browser against `.demo/dashboard`. The new skill library, compatibility badges, version references, three setup adoptions, skill instruction preview, and install-harness selector rendered correctly. Selecting Codex changed the displayed install command to `--harness codex`; the copy control reported success, although the automation clipboard read returned empty, so clipboard contents were not independently verified in this pass.

The setup harness filter isolated the Codex example. Its drawer displayed native settings, the pinned skill, new-directory materialization, and local telemetry instructions. The share-setup dialog changed capture instructions to Claude Code when selected. Filtering activity to Codex showed no measurements, as expected; the new examples did not generate live usage. The sharing disclosure covered native configurations, skill contents, identifiers and usage, and the exclusion of traces/task content. No browser console warnings or errors were reported during the walkthrough.

One example skill and three example setups are stored under the existing QA admin in the local preview registry. Their source fixtures are in `.demo/library-qa`. These are interface examples, not actual colleague setups. Installed CLI telemetry smoke checks and the **36 passing automated tests** are described in [VALIDATION.md](VALIDATION.md).

## Original Pi walkthrough

The local application was exercised through its actual browser forms, controls, and clipboard actions. Pi was invoked as an installed CLI subprocess, using the existing `~/.pi/agent` settings and signed-in `openai-codex/gpt-5.6-terra` model with medium thinking. The test used Pi **0.85.1**, installed at `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`; there was no global `pi` command on the shell PATH. A separate Pita installation at 0.84.2 was discovered but was not used for this run.

The preview registry is `.demo/dashboard`, and all test stores, accounts, code, and results are under `.demo/ui-flow`. The fixture is a tiny, deliberately broken percentage calculation. The second account simulates a teammate; this is not an evaluation of a real colleague's setup. No invitations were sent to anyone.

## Flows exercised

| Flow | Observed result |
| --- | --- |
| First-admin setup | The old installation link was expired and rejected. A fresh host-issued link created the QA admin through the browser. |
| Last-admin protection | Attempting to demote the only admin showed “Keep at least one active admin.” |
| Invitation | Admin created and copied a member invitation; the signed-out recipient chose a name/password and joined with member permissions. |
| Invitation replay | Reopening the consumed invitation was rejected. The repaired error screen offers a working return link. |
| Harness instructions | Browser clipboard copy succeeded; instructions contained no access credential. |
| Installed Pi registration | Pi itself launched the local `team login` command, streamed its code, waited for browser approval, and verified its team status. |
| Sign-in continuation | The second device's approval URL preserved its code through the login screen. |
| Normal Pi measurement | `/share-start qa-pr-review`, the `qa-review` skill, and `/share-stop` produced a completed metadata record through the installed CLI's RPC mode. |
| Configuration sharing | Captured the current model/settings plus the fixture skill, explicitly published them, and inspected the exact revision in the dashboard. |
| Second-device import | Copied the pinned pull command from the UI and installed the shared revision under a local alias in the other test store. |
| Frozen comparison | Ran the imported setup and a second test profile against the same packet; both completed and the dashboard showed the shared context fingerprint. |
| Mixed contexts | Selecting an interactive run and a frozen run displayed the interactive-context limitation and differing tool policies. |
| Analytics | The browser displayed all three live reviews, matching tool, skill, token, and cost counters; live/demo and date filters worked. |
| Assessment | Entered a test assessment of the known seeded defect through the form; it appeared with the correct reviewer and synced to both stores. |
| Device revocation | Revoking the second device in the UI immediately made its CLI `team status` fail with revoked-credential status. |
| Password recovery | Admin generated a reset link, the test member changed its password through the browser, the previous password failed, and the new one signed in. Its device credential was also revoked. |
| WebMCP | Both declared tools registered. Summary read returned visible filters/totals; valid navigation changed the view; invalid navigation and unexpected summary fields were rejected. Tools disappeared after logout. |
| Browser health | The populated overview was visually inspected; no browser warnings/errors were reported at the final check. |

The assessment is test data entered to verify the UI and synchronization, not an independent human quality rating.

## Live measurements

| Run | Source | Duration | Model calls | Tool calls | Observed skill | Estimated USD |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `qa-installed-pi` | Installed Pi CLI + extension | 11.1s | 3 | 8 | `qa-review` | 0.0120904 |
| `qa-my-review` | Imported configuration, frozen packet | 15.5s | 4 | 8 | `qa-review` | 0.0150832 |
| `qa-colleague-review` | Second test configuration, same packet | 17.7s | 4 | 8 | `review` | 0.0157472 |

Total measured review usage: **3 completed runs, 24 tool calls, 3 skill observations, USD 0.0429208 estimated**. These totals cover the measured review workflows, not the earlier unmeasured onboarding prompt or this Codex task. Usage estimates are not subscription invoices.

Both frozen reviews identified that `discountedTotal(100, 20)` produces `-1900` instead of `80` because `/ 100` was removed. One review recovered from a failed `find` call; that tool error remained visible in its metrics.

Shared packet fingerprint:

```text
f0a58bbb778b0cce1a045aa7c7bb93a5905ff71e34c47c1392633f2bd8920432
```

## Privacy and isolation checks

The installed Pi process used `--no-session`, an isolated `PI_SHARE_HOME`, and the test fixture as its working directory. The user's Pi settings file remained unchanged (its modification time predates this test). Existing model authentication was used normally without displaying or copying credentials into Pi Share.

The exported analytics were inspected for the private prompt sentinel, review prose, fixture filename, and bearer-token format: all were absent. Only setup configuration was explicitly published; no code packet, conversation, or final review entered the registry. Final review text remains in local test artifacts.

Both QA device credentials were revoked by the end of the test. The local browser is left signed in as the QA admin so the result can be inspected. Disposable account credentials are in `.demo/ui-flow/test-accounts.json`, mode `0600`; do not use these test accounts for a real team installation. `npm run dashboard` uses the separate `.registry` directory for a fresh installation.

## Fixes made during the walkthrough

- Expired or consumed invitation/reset links no longer leave a disabled form with no escape. They explain the error and provide a return link to sign-in or the workspace.
- Harness registration instructions now explain how to invoke the repository's CLI with Node when `pi-share` is not on PATH.
- “Recently shared” now sorts by publication time, and overview counters use the correct singular labels.

After these fixes, `npm run check`, the production build, and **all 27 automated tests passed**. The repaired link screen, updated instructions, latest-first setup order, and normal browser flows were rechecked against the rebuilt server.

## Local evidence

All paths below are relative to this repository and ignored by Git:

- `.demo/ui-flow/pi-live.mjs`: installed CLI test driver; RPC events are reduced in memory rather than saved as traces.
- `.demo/ui-flow/local-review.md`: installed Pi's fixture review.
- `.demo/ui-flow/metadata.json` and `metrics-check.json`: first workflow export and exclusion checks.
- `.demo/ui-flow/admin-store/work/comparisons/66bc6d66-e493-411b-8683-1ab0aba3a6a4/report.md`: frozen comparison report.
- `.demo/ui-flow/admin-store/work/runs/5f20ffde-206b-4471-be19-35a602f8cdc5/review.md`: imported setup review.
- `.demo/ui-flow/admin-store/work/runs/17fe9e72-5d73-4eaa-9641-2253043fdb85/review.md`: second setup review.

## Audit-fix walkthrough — 2026-09-12

The rebuilt Loadout app was checked against the existing local registry at port 4318. Its two authorized native devices, six published setups, one skill, five live measurements, and accounts were retained.

- Overview prioritizes exact shared-revision links and follow-up work; duplicate catalogue content was removed.
- Setup detail URLs survive reload. History exposes older revisions, workflow changes render as diffs, and supporting contents are readable without execution. The comparison picker supports available historical native revisions.
- The former hidden-filter path now shows both Claude Code ($0.2828) and Codex (unknown price) in the shared skill’s explicitly scoped activity table.
- The Pi trial wizard exposes changed settings/resources and added/removed file contents. Native selection states that effective configuration and equal context are unverified.
- Full existing experiment results contain both frozen Pi runs. Selecting the two native observations displays unmeasured-context language consistently.
- Device authorization is separate from last successful sync. Existing clients correctly show no sync report until using the upgraded client. Renewal instructions preserve the remote.
- Admin storage/retention controls and member-device views render correctly. A typed fixture email suggests a handle; the invitation was cancelled without creating access.
- An isolated private copy on port 4317 verified named trial creation, tailored handoff, server rejection of adoption without evidence, a persisted insufficient-evidence decision, and the corresponding administrative events. The temporary browser tab and server were closed afterward.
- At 390×844 the catalogue and revision drawer fit the document without horizontal overflow. Comparison tables scroll within their region and expose a mobile scroll hint and keyboard focus target. Temporary viewport overrides were reset.
- Dialog Escape behavior, exact form labels, stable detail navigation, and console errors were checked. This is a focused accessibility pass, not WCAG certification.

See [AUDIT-FIXES.md](AUDIT-FIXES.md) for the implementation mapping and [OPERATIONS.md](OPERATIONS.md) for safe upgrades, withdrawal/purge, and collector/device recovery.
