# Team registry and synchronization

For standalone skills and native Claude Code/Codex setup sharing, see [Shared skills and native harnesses](SKILLS-AND-HARNESSES.md). The examples below continue to work for Pi profiles.

Loadout replaces repeated export-file handoffs with a self-hosted registry. Team members can publish chosen setup revisions, browse each other's setups, pull one into a local alias, and synchronize metadata as they work.

The registry stores setup bundles, immutable run metadata, and versioned human assessments. It does not accept repository packets, final reviews, conversation messages, or raw tool events, and it never executes published setup code. Running an imported setup still happens on the receiving device with that device's model credentials.

## Start a team

Run commands from the Loadout repository after `npm ci --ignore-scripts` and `npm run build`.

The recommended account and device setup is described in **[AUTH.md](AUTH.md)**:

```sh
node dist/cli.js serve --data ~/.pi-share-registry/work --team engineering --scope work
```

Open the private installation link saved to `~/.pi-share-registry/work/setup-link.txt` and create the first admin. Invite teammates through **Team & access**. Each recipient chooses their own password, then connects each harness through browser approval.

The service listens on `127.0.0.1:4318`. For other machines, place it behind HTTPS, preserve the public Host header, and pass `--public-url https://share.example.com`. `--host` and `--port` change the listener. Each registry directory has one immutable team identity and scope; use another registry for personal use.

## Connect your device

On your own machine:

```sh
node dist/cli.js team login engineering \
  --scope work --url http://127.0.0.1:4318 --label work-laptop

node dist/cli.js team status engineering --scope work
```

Open the approval URL printed by the CLI, sign in, and approve the matching code. The harness receives its own 90-day credential for your account. Revoke individual devices in **My devices**.

Use the registry's HTTPS URL when it runs elsewhere. `engineering` is this device's local remote name. Connecting validates the credential against the service, pins the team identity, and sets this scoped store's default actor to the authenticated member. The local device ID stays distinct.

A scoped store can belong to only one team. Use another `--home DIR` for a separate work team; `--scope personal` already has a separate store. This prevents a second connection from silently sending the first team's records elsewhere. Existing records with a different actor ID are not relabeled or uploaded. An explicit `--actor` or `PI_SHARE_ACTOR` still overrides the local default, so it must match your team member name if you want those runs synced.

Connecting alone sends no local setups or analytics. Renew an existing connection with the same `team login REMOTE --url URL --scope SCOPE` command; identity verification preserves the existing remote and sync history. A different member/server is refused.

### Operator-issued credentials (legacy / CLI-only access)

The v0.2 commands remain available for installations using credential files:

```sh
node dist/cli.js registry grant --data ~/.pi-share-registry/work \
  --member colleague --token-out /private/colleague.credential.json
node dist/cli.js team connect engineering --scope work \
  --url https://share.example.com --token-file /private/colleague.credential.json
node dist/cli.js registry members --data ~/.pi-share-registry/work
node dist/cli.js registry revoke TOKEN_UUID --data ~/.pi-share-registry/work
```

The operator must privately deliver that file. Prefer browser-approved login for people with dashboard accounts. Each credential has an independent token ID and expiration (`--expires-days`, 1–365, default 90). Only token hashes are stored in the registry. A device credential does not confer admin browser access. Disabling a browser account revokes all credentials for the same member handle, including these legacy tokens.

## Publish and use setups

Capture your setup with its actual workflow request, then publish that chosen revision:

```sh
node dist/cli.js profile capture my-review --scope work \
  --project /path/to/repository --workflow pr-review \
  --prompt /path/to/review-request.md

node dist/cli.js setup inspect my-review --scope work
node dist/cli.js team publish engineering my-review --scope work --reviewed-revision FULL_REVIEWED_HASH
node dist/cli.js team profiles engineering --scope work
```

The registry owns the namespace. If both you and a colleague have a profile named `my-review`, they appear as `makina/my-review` and `colleague/my-review`. Their bundles and revisions remain distinct unless their content is identical.

Pull a colleague's setup:

```sh
node dist/cli.js team pull engineering colleague/my-review --scope work
node dist/cli.js profile list --scope work
node dist/cli.js run colleague--my-review --scope work --packet /path/to/frozen-review
```

The default local alias is `member--setup`; `--as NAME` chooses another. Pulling stores the source bundle unchanged and preserves its revision. It does not replace your current Pi configuration or run extension code. A conflicting local alias is refused unless that alias was already established by a prior pull of the same remote setup.

Use the alias in the existing comparison command:

```sh
node dist/cli.js compare --scope work \
  --profiles my-review,colleague--my-review \
  --packet /path/to/frozen-review --repeat 2
```

`team pull ... --revision HASH` retrieves a specific published revision. Published revisions stay available even when the owner publishes an update, unless withdrawn. Owner/admin withdrawal blocks direct downloads, emits a sync tombstone, and blocks setups bundling a withdrawn skill. See [OPERATIONS.md](OPERATIONS.md).

Publishing uses the last revision this device published or explicitly pulled as the expected previous revision. If another device has updated the setup, publication stops with a conflict. Inspect the current setup through `team profiles` and `team pull`; to intentionally replace it, publish with `--expected CURRENT_REVISION`. Re-publishing an identical current revision is harmless.

## Synchronize measurements

Once the Pi extension or comparison runner has collected records:

```sh
node dist/cli.js team sync engineering --scope work
node dist/cli.js analytics report --scope work
```

Sync downloads new team metadata, uploads unsent local records owned by the authenticated member, then pulls the resulting changes. It tracks acknowledged uploads and a durable download cursor. Repeated syncs are idempotent. A failed connection leaves local records intact, and concurrent syncs against the same local remote are refused.

Demo runs are excluded from uploads unless `--include-demo` is specified. A team member can deliberately publish demo metadata with that flag; received demo records retain their label and are excluded from the default analytics report.

Run continuous synchronization while you work:

```sh
node dist/cli.js team sync engineering --scope work --watch 30
```

This foreground process checks every 30 seconds and retries after connection failures. Ctrl-C stops it. It does not install a system service. It sends new metadata after a workflow is saved; `/share-start` and `/share-stop` still control what the Pi extension measures. Configuration changes are not automatically published. Add `--check` to check saved capture sources at most once per minute. This only reports differences; it does not save or upload a new setup. `setup check [NAME]` or `team status REMOTE --check` checks immediately. Capture-source paths remain private on that device; only counts and check time enter a sync status report. Sources captured before this feature or unavailable on the device are reported as unchecked/unavailable. Re-capture explicitly to register or update their source. Use the same `--scope` and `--home` as the connected store.

No traces, code packets, final review text, model credentials, or environment values enter metadata sync. Shared metadata still includes actor/device IDs, timestamps, workflow/model/tool/skill names, content hashes, counters, and optional assessment counts. The exact field allowlist is validated both on the client and on the service.

## Named setup trials

In **Comparisons → New comparison**, select a candidate and a baseline with the same harness and workflow. Available history for the selected setup is included. Inspect settings, workflow, requirements, added/removed files, and supporting contents before creating the handoff. Use a reusable trial label: the label, revision references, usage records, and decision are shared; repository paths and task contents are not.

Copy the tailored instructions to your local harness. For a Pi trial:

```sh
loadout team trial engineering TRIAL_UUID --scope work \
  --repo /path/to/project --base BASE_REF --head HEAD --prepare-only
# After reviewing the local prerequisites, repeat without --prepare-only to run.
```

Preparation pins both exact revisions and freezes the chosen Git task locally. Reusing the same trial keeps that packet; changing the supplied task inputs is refused. Execution uses read-only Pi tools, runs both revisions, and syncs finalized metadata under the same trial ID. Local extension code is still trusted executable code, not an OS sandbox. Review output stays in the local store. Review it locally, enter assessment counts through the CLI or dashboard, and record **keep baseline**, **adopt candidate**, or **insufficient evidence**. Adoption/retention decisions require both revisions and assessed completed Pi runs. Uploads must belong to the trial owner, use the pinned revisions, and share the frozen context and live/demo mode.

For Claude Code/Codex, preparation exports two separate native configuration directories and prints collector commands with `--config-dir` and the trial ID. Resolve local credentials/dependencies, run each harness on your chosen task, stop its collector after it flushes, then sync. These are usage observations: effective configuration, task completion, and equal context are not attested. Whole setups are never translated between harnesses. Individual skills remain portable where declared compatible.

The dashboard polls an open trial for newly synced results. It does not remotely execute a harness. The comparison summary aligns model, thinking, policy, context provenance, skills, measurements, and human assessments. No winner is inferred from spend or duration.

## Resolve score edits across devices

After reading a local review, record your judgment:

```sh
node dist/cli.js score RUN_UUID --scope work --valid 2 --false 1 --missed 0
node dist/cli.js team sync engineering --scope work
node dist/cli.js analytics report --scope work
```

Each score is a separate immutable assessment with a reviewer, an event ID, and links to the versions it supersedes. It does not change the run's tool/token/cost counters. Two people can score the same run independently.

If your desktop and laptop both edit the same earlier score while offline, synchronization retains both versions. It reports a conflict rather than picking whichever device's clock or upload happened to win. The analytics report lists both current assessments. Inspect them and run `score` again after syncing; that new judgment supersedes all locally known current versions for your reviewer identity. Syncing it resolves the conflict on the other devices too.

The history remains available in the local `assessments` directory and in version 2 analytics exports. Version 1 analytics files can still be imported. Legacy scores already embedded in a run are preserved and converted into an initial assessment when that run's owner syncs it.

## Storage and trial limits

- The registry uses a local SQLite database in `--data`. Keep this directory private. Stop the registry before copying the directory for a simple consistent backup. Restoring an older backup can put a client's cursor ahead of the service; the client refuses to silently skip that mismatch.
- Client connection files, sync checkpoints, and catalogue summaries live under `~/.pi-share/<scope>/remotes/<name>/`. Downloaded profile bodies are stored only when explicitly pulled. Reviews and frozen code packets remain local.
- Node 22's bundled `node:sqlite` API emits an experimental-feature warning. No additional database installation is required. The dashboard uses React and Vite.
- This release is for a small self-hosted team trial. It has browser accounts, invitations, device pairing, ownership checks, a dashboard, and auth rate limits. SSO/MFA, automatic email, and multi-server deployment remain future work. Admin audit events, quotas, withdrawn-content retention/purge, and `registry doctor` are implemented; see [OPERATIONS.md](OPERATIONS.md).
- Runtime reproducibility and measurement coverage are unchanged: credentials and external services are local; transitive dependencies and extension behavior may differ; subprocess-agent and internal summarization costs may be unobserved. These are still Pi usage estimates rather than invoices.

`npm test` exercises the HTTP service with multiple devices and members, the real CLI onboarding flow, metadata-only transfer, pagination/retries, immutable revisions, token revocation/expiry, scope/ownership enforcement, and conflicting offline score edits. The existing Pi execution and privacy tests also remain in the suite.
