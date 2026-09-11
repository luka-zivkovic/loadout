# Loadout — product, interface, and implementation audit

**Historical audit:** the findings below describe the pre-remediation build. See [AUDIT-FIXES.md](AUDIT-FIXES.md) for implemented fixes, validation, and remaining boundaries.

Reviewed 11 September 2026 against the current working tree and the local app at `http://127.0.0.1:4318`.

**Verdict:** Loadout is a functional internal prototype with useful sharing primitives. It is still difficult to answer its central product question: “What should I borrow from a teammate, and did it improve my work?” The interface emphasizes stored objects and counters; the journey from discovery to local trial to a useful conclusion needs substantially more work.

The Doom styling gives it a recognizable identity. Another theme change would have less impact than improving hierarchy, connection status, inspection, and the trial workflow.

## Scope and evidence

- Walked Overview, Shared setups, Shared skills, Activity, Comparisons, My devices, and Team & access, including setup/skill details, comparison selection, and the invitation form.
- Inspected desktop layouts and the setup registry at a 390px viewport. The sampled mobile registry did not overflow the document horizontally; the harness tabs scroll within their container.
- Reviewed capture/materialization, shared-file handling, registry/sync, native telemetry, dashboard queries, and authentication/access-control code. Auth setup/reset/revocation behavior was checked through implementation and the existing isolated tests; live accounts were not reset or disabled.
- `npm run check` passed. `npm test` rebuilt the app and passed **37/37 tests**.
- Ran isolated synthetic probes for secret filtering and reconnect behavior. No real credentials were used in those probes, and nothing was published to the live registry.
- Existing data is small: six setups, one standalone skill, five live runs. Performance risks below are inferred from query/code structure, not a load-test result. This is not a formal penetration test or WCAG certification.

Priority here means implementation order: **P1** before a wider team pilot; **P2** important correctness, usability, or operational follow-up. Product gaps are explicitly distinguished from reproduced defects.

## Findings

### 1. P1 — Published content has no withdrawal path

**Confirmed implementation gap.** Publishing a corrected setup changes its head, but old revisions remain retrievable by revision. Skills behave the same way. There is no owner/admin withdrawal operation in the registry API, CLI, or dashboard. Revoking a device or disabling its publisher does not remove the published artifact.

This matters because sharing includes the actual contents of instructions, hooks, skills, and supporting files. If somebody accidentally includes internal notes or a credential that escapes filtering, publishing a clean version does not stop members from fetching the old one.

Add owner/admin withdrawal, enforce it on direct revision fetches, and propagate withdrawal metadata to clients. Show which pinned setups depend on a withdrawn skill. Define a separate retention/purge procedure for the server and backups. Already downloaded copies cannot be recalled; the interface should state that limit.

Evidence: [revision persistence and retrieval](src/registry.ts#L90), [skill retrieval](src/registry.ts#L134), [sharing disclosure](src/sharing.ts#L7).

### 2. P1 — The main discovery → trial → evaluation journey is incomplete

**Product gap.** “Try this whole setup” opens pull/materialize commands with path placeholders. Pi trials need a separately prepared frozen packet. Native telemetry needs a collector, another terminal, a launch environment, shutdown, and a subsequent sync. The dashboard does not track whether the handoff succeeded or bring the user back to the resulting experiment.

A CLI/harness handoff fits this audience. The missing piece is continuity: choosing what to try, knowing what will change, resolving prerequisites, and seeing the result under the same named task.

Build one complete flow first: choose my setup and a colleague’s revision, choose a local task, inspect differences and requirements, generate tailored harness instructions, then show the resulting runs and a structured assessment. Keep repository context and outputs local. For now, explicitly distinguish Pi controlled comparisons from Claude Code/Codex usage observations.

Evidence: [setup trial instructions](web/Library.tsx#L73), [comparison entry point](web/Views.tsx#L554), [native collector lifecycle](src/cli.ts#L230).

### 3. P2 — A hidden filter removes skill activity

**Reproduced UI defect.**

1. On Overview, select Codex under “Activity harness.”
2. Navigate to Shared skills, whose visible compatibility filter says “All harnesses.”
3. Open `qa-shared-review`.
4. Its activity table shows only the Codex observation. The Claude Code observation disappears.
5. Clear the Overview filter and reopen the skill: both observations return, including Claude Code’s $0.2828 estimate.

The global analytics harness state remains active when its control is hidden. The library compatibility filter is separate state, and the detail table consumes the globally filtered records. This produces misleading partial usage history with no visible harness restriction in the drawer.

Give skill analytics an explicit filter scope and show all active restrictions where results appear. Keep catalogue compatibility and measurement filters separate. Encode relevant filters in the URL.

Evidence: [global filter visibility](web/App.tsx#L560), [skill filter state](web/Library.tsx#L90), [skill activity source](web/Library.tsx#L103), [server filtering](src/web-server.ts#L251).

### 4. P2 — “Connected” does not establish sync health, and reconnection is unfinished

**Status-model gap plus reproduced reconnect defect.** Device rows expose credential status, expiry, and last authenticated request. They do not report the last successful measurement sync, collector health, latest local capture, or whether the current local configuration differs from the published revision. A `team status` request can update “Last active.”

Credentials expire after 90 days by default, but `team login` rejects an existing remote name before starting registration. An isolated existing connection file reproduced “Remote name already exists; choose a new name.” The CLI has no renewal operation preserving that remote's sync state. Using a new alias is a workaround, but loses the continuity users expect and diverges from copied commands using the team name.

Show separate states for authorized device, measurement sync, and published configuration. Add reauthentication for the same team/member/remote while preserving cursor and publication state after identity checks. Detect local configuration changes and offer review/publish; do not silently publish them.

Evidence: [last-active updates](src/registry.ts#L79), [credential expiry](src/registry.ts#L58), [reconnect rejection](src/team-client.ts#L60), [device data model](src/web-auth.ts#L640).

### 5. P2 — The credential filter misses Loadout’s own web-token formats

**Reproduced filtering defect; no actual leak observed.** The scanner recognizes the CLI credential prefix `ps_`, but not the generated setup, invitation, reset, session, or device-flow prefixes: `psb_`, `psi_`, `psr_`, `pss_`, and `psd_`.

A synthetic `SKILL.md` containing an example URL with each prefix followed by 64 hexadecimal characters passed both `packFile` and `validateFiles` for all five web-token prefixes. The equivalent `ps_` value was rejected. An accidentally pasted live invitation/reset link can therefore pass this known-credential check when bundled in shared files.

Centralize recognized token formats and cover every issued secret. Add regressions using synthetic values. Continue describing scanning as best-effort: arbitrary task content or personal information in deliberately included files cannot be reliably removed by a token regex.

Evidence: [secret matcher](src/files.ts#L44), [challenge token formats](src/web-auth.ts#L255), [session token](src/web-auth.ts#L185), [device secret](src/web-auth.ts#L544).

### 6. P2 — “Inspectable” setups do not expose all included contents

**Confirmed capability gap.** Setup details display workflow instructions and native settings, but included files are only filenames and hashes. Skill details show `SKILL.md`, but supporting files are also metadata-only. Neither surface offers revision history or a content diff.

Those omitted contents can include instructions, hooks, scripts, and extensions that affect the local run. Users cannot make an informed decision from a revision badge alone. The prominent action arrives before a meaningful review of those resources.

Add a plain-text file browser, previous-revision and selected-setup diffs, and summaries of executable resources, local paths, dependencies, and omitted settings. Make the publishing handoff include an exact manifest/content review before upload. Continue requiring native dependency and project-policy checks locally; “materialized” does not establish that a setup is fully usable on another machine.

Evidence: [setup drawer](web/Library.tsx#L78), [file metadata display](web/Library.tsx#L84), [preview API](src/web-server.ts#L279).

### 7. P2 — Native comparisons use the wrong context explanation

**Reproduced copy/semantics defect.** Selecting the current Claude Code and Codex observations in Activity produces a banner saying their hashes describe “starting session branches.” These native telemetry records actually use a synthetic `unmeasured-context` hash; the cards correctly say “Unmeasured.” The banner is describing Pi interactive sessions and conflicts with the cards.

Represent context provenance explicitly: frozen packet, Pi starting branch, or unmeasured native context. Render comparisons from that provenance. Keep the existing warning that equal hashes do not prove equal task context, and never infer review quality from cost or duration alone.

The wider comparison product also needs a readable summary of what changed: model, instructions, skills, tools, and relevant policy. Current cards mostly compare usage numbers.

Evidence: [native context construction](src/telemetry.ts#L61), [comparison banner](web/Views.tsx#L587).

### 8. P2 — Named setup links do not open the named setup

**Reproduced navigation defect.** Clicking `qa-codex-shared-review` in Overview opens the complete `/setups` catalogue with no setup selected. The user has to find and click the same setup again. Setup and skill detail drawers are local component state, so a copied URL or reload does not preserve the selection either.

Give setups, skills, runs, and experiments stable URLs, including pinned revision where applicable. Preserve the selected item through reload/back navigation. A team sharing product needs reliable links to the exact object being discussed.

Evidence: [Overview click handler](web/App.tsx#L864), [setup selection state](web/Library.tsx#L27), [skill selection state](web/Library.tsx#L90).

### 9. P2 — Dashboard totals and page loading will become problematic with larger histories

**Code-confirmed limits; performance impact not load-tested.** The dashboard returns at most the newest 2,000 records, and the client computes totals from that subset. A truncation notice exists, but the displayed period totals and experiment groups can still be incomplete. The shortest selectable period is seven days, which cannot guarantee falling below the cap.

Each dashboard request also loads all setup/skill heads and validates their full bundled contents, even though the browser receives only catalogue metadata. All assessments are read and parsed before filtering to the displayed run IDs. These operations use synchronous SQLite/validation in the request path.

Use aggregate queries for period totals, pagination for activity, and a dedicated experiment query that retrieves the complete experiment. Store catalogue metadata separately from file blobs, validate artifacts on ingestion, and fetch contents when inspected or pulled. Add indexes for the actual time/mode/harness queries and measure against a realistic team fixture before broadening deployment.

Evidence: [dashboard query and assembly](src/web-server.ts#L249), [setup listing validation](src/registry.ts#L103), [skill listing validation](src/registry.ts#L130).

## Screen-by-screen product and visual critique

| Surface | Current issue | Recommended direction |
| --- | --- | --- |
| Overview | Run counts, tool counts, and spend tell me that activity happened, but give little reason to try a particular setup. The mostly empty timeline occupies valuable space in this small workspace. | Lead with relevant shared changes, pending evaluations, and my connection/configuration status. Keep usage totals secondary, with coverage visible. |
| Shared setups | Stronger visual identity than the other screens, but names, hashes, and counts reveal little about intent or differences. | Show a short purpose, meaningful changes, publisher, tested harness version, and a direct “Compare with mine” handoff. |
| Shared skills | Borrowing one skill is the clearest value proposition. Supporting-file inspection and evidence of usefulness are thin. | Keep this prominent. Add contents, revision history, requirements, and optional structured usefulness feedback without collecting task output. |
| Activity | A useful diagnostic ledger. “Recorded” versus “Completed” and measured versus unavailable fields require interpretation. Tool names such as `read` and `Read` are separate without harness context in the overview totals. | Surface provenance/coverage beside each row. Add useful grouping by harness, workflow, and setup. Preserve native tool names; any cross-harness category should be explicitly derived. |
| Comparisons | Once one experiment exists, the page is mainly a table of old experiments; there is no prominent creation flow. Repeated cards make differences harder to scan. | Add “New comparison,” a capability-aware local handoff, aligned comparison rows, and a structured assessment stage. Allow “insufficient evidence” as a normal result. |
| My devices | Long connection instructions dominate, while existing connections fall below the fold. “Connect a harness” repeats the page's main purpose. | Show device/sync status first. Open connection instructions on demand and track pending approval through successful registration. |
| Team & access | The invitation model is appropriate for a small private team. Admins must understand a stable actor handle, and the global “Connect a harness” CTA is unrelated to administration. | Make “Invite teammate” primary. Suggest a handle automatically for new users, provide member access/device visibility, and record administrative events. |

**Visual direction:** retain gunmetal, restrained red accents, square geometry, and the official harness icons. Reduce repeated page labels and decorative framing. Raise important metadata from the observed 10px to approximately 12–13px, and use comfortable body text for instructions. Some desktop space is spent on large headings while small details carry the real decisions. The device page and comparison dialog are particularly heavy with paragraphs and bordered blocks.

Mobile is serviceable for browsing, but long commands and comparison cards demand substantial scrolling. A desktop-first developer tool is reasonable; mobile should prioritize status, inspection, and approving a device. Native dialogs, Escape behavior, labelled controls, visible focus, and the skip link are useful foundations. A dedicated screen-reader/contrast pass is still needed; small typography alone is not proof of a WCAG violation.

## Privacy, authentication, and reliability assessment

The reviewed analytics path deliberately limits collected data to counters/metadata and rejects trace ingestion. I did not find evidence that connecting a device automatically uploads its existing sessions or configuration. Capture/publish and measurement sync are distinct actions, and the shared disclosure explains them. That distinction should remain visible in status and publishing flows, rather than relying on a large disclaimer.

There are sensible protections in the implementation: host-issued first-admin setup capability, private expiring invitations, users choosing their own passwords, hashed secrets, password hashing, same-origin mutation checks and CSRF protection, browser session cookies, ownership checks, revocable devices, work/personal store binding, file-path validation, and conflict-aware immutable revisions. Existing tests cover several access-control and invalidation cases. These should be preserved.

The remaining concern is operational completeness. Withdrawal and reconnect are the most immediate gaps. There is no administrative audit-log UI or retention/quota policy. Reverse-proxy clients share the socket-IP authentication limit of 30 attempts per five minutes; the deployment documentation acknowledges this, but deployment-level rate limiting alone cannot remove the application's shared bottleneck. Decide on a trusted-proxy/account throttling design before a larger rollout. SSO and passkeys can follow a demonstrated team need; replacing the whole auth model is not the first priority.

Native telemetry is also saved to disk only on the collector's graceful stop path. A crash or forced termination can lose the in-memory observations, and watch-sync cannot upload them while they remain unsaved. Consider periodic atomic persistence of counters with a clearly incomplete status, without retaining raw events. This is a code-based reliability concern, not a crash test performed against the user's collector.

Evidence: [operating limits and deployment constraints](AUTH.md#L99), [auth IP bucket](src/web-server.ts#L165), [collector persistence](src/cli.ts#L236).

## Suggested implementation sequence

1. **Make the existing system dependable:** withdrawal, complete known-secret filtering, reconnect, honest connection/sync status, the hidden-filter fix, stable detail URLs, and accurate context labels.
2. **Complete one useful team journey:** inspect a colleague's revision, understand the differences, try it locally through the matching harness, return to a named experiment, and record an assessment. Make compatibility and measurement limitations explicit.
3. **Refine the UI around that journey:** prioritize local status and useful shared changes, make skills easy to borrow, reduce instruction walls, and replace comparison cards with an aligned difference view. Preserve the selected visual identity.
4. **Prepare for larger teams:** aggregate/paginate analytics, avoid revalidating all artifact blobs per request, persist collector counters reliably, and add operational auditing, retention, quotas, and deployment checks.

The next milestone should demonstrate that a second teammate can discover, inspect, try, and evaluate a shared setup without needing the app's author to explain each step.
