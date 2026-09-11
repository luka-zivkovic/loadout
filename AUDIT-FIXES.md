# Loadout audit fixes

Implemented against the findings in [AUDIT.md](AUDIT.md). The audit remains a historical record of the previous build.

| Finding | Resolution |
| --- | --- |
| 1. No withdrawal | Owner/admin revision withdrawal in API, CLI, and UI; direct-fetch enforcement; change-feed tombstones; blocked skill dependencies; local execution/install checks; explicit retention and purge. |
| 2. Incomplete trial journey | Named same-harness/workflow trials, pinned revision picker/history, inspection, tailored local handoff, Pi packet preparation and execution, native configuration exports/collector handoff, synced results, assessments, and an explicit decision. |
| 3. Hidden skill filter | Skill usage queries have their own stated all-harness period/mode scope. Catalogue and activity filters no longer leak into that history. Filters are URL-backed. |
| 4. Connection/sync ambiguity | Separate authorization, sync receipt, configuration drift, and collector reports. Same-identity renewal preserves remote cursors/publication state. Capture-source checks report changes without publishing them. |
| 5. Missed capability formats | Shared scanner covers every issued Loadout secret prefix in bundled files and metadata. Synthetic regressions cover each format. |
| 6. Incomplete inspection | Safe text/binary previews, executable markers, revision history, setting/workflow diffs, and added/removed/modified file contents. Publish instructions include local content review and an exact reviewed-revision guard. |
| 7. Wrong native context explanation | Comparison rows distinguish frozen Pi packets, Pi starting branches, and unmeasured native context. Named Pi runs enforce owner, pinned revisions, read-only runner, equal context, and mode. |
| 8. Broken detail links | Exact revision, run, named trial, and experiment URLs; reload/back navigation preserves selection. Overview links open the selected revision. |
| 9. Capped totals/expensive catalogues | Database aggregates cover the full period; activity pages contain 100 rows; complete experiment queries; metadata catalogue cache; scoped assessment reads and query indexes. |

The UI keeps the Doom palette and native service icons. Overview leads with shared revisions and follow-up work, redundant catalogue content is removed, comparison evidence is aligned in a table, device instructions open on demand, invitation handles are suggested, form labels/descriptions are associated explicitly, and metadata/focus/mobile layouts are clearer. The daily chart also has a table alternative.

Operational follow-ups include administrative events, member device visibility, configurable payload/run quotas, explicit withdrawal retention/purge, trusted proxy IP handling, a read-only deployment preflight, and periodic native telemetry checkpoints with interrupted-process recovery. See [OPERATIONS.md](OPERATIONS.md).

## Evidence

- `npm run check` validates service and dashboard types.
- `npm test` builds the application and passes 51 tests, including real Pi sessions against a scripted local provider.
- New regressions cover withdrawal/embedded dependencies/purge, secrets, file previews and traversal, same-identity renewal, source drift/privacy, interrupted counters, trial evidence/ownership/context, quotas, proxy headers, deployment preflight, and real CLI local trial preparation.
- A 2,506-run fixture checks complete period aggregates, non-overlapping activity pages, and full experiments crossing the period boundary. This checks correctness at the old truncation threshold, not production-scale capacity.
- Browser QA covers live data, exact revision reload/history/diff, the hidden-filter regression, comparison preparation, native prerequisites, complete synced experiments, device/operations views, invitation handle assistance, and 390px browsing/inspection.
- A private consistent backup was taken before upgrading the existing local registry. Existing local devices, accounts, published revisions, and measurements were retained.

## Deliberate boundaries

Native observations still cannot attest equal task context or effective runtime configuration. Pi isolation does not sandbox trusted extensions or external integrations. Credential scanning remains best-effort. Withdrawal cannot recall downloaded copies; purge does not erase backups or SQLite free pages. Setup publication remains explicit. The service still trusts member-reported measurements and is designed for a single-process team installation. SSO/MFA, automatic email, and a full accessibility/security certification are outside this remediation pass.
