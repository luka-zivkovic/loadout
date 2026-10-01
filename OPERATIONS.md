# Operating Loadout

Loadout is a single-process, self-hosted team service. Existing registry identities, accounts, device credentials, revisions, and local stores are preserved by the current migrations. Keep the data directory private.

## Upgrade and preflight

1. Stop the service and copy its entire registry directory to private backup storage. Keep secrets in the backup protected just as on the server.
2. Build with the supported Node version: `npm run check && npm test`.
3. On a dedicated dashboard host, install only the server runtime after building: `npm ci --ignore-scripts --omit=dev --omit=optional`. The optional Pi agent runtime is needed on machines that execute controlled Pi comparisons, not on the dashboard server. Confirm the deployed dependency set with `npm audit --omit=dev --omit=optional`. That dashboard audit does not cover the optional runner; runner hosts must review the full production audit separately.
4. Deploy both `dist` and `web/dist`. Start the service with its existing `--data`, public origin, and scope. Startup adds/backfills the operations tables and catalogue metadata once.
5. Run the read-only preflight with the same deployment settings:

```sh
loadout registry doctor --data /private/loadout-registry \
  --public-url https://share.example.com --trusted-proxy 127.0.0.1
```

It checks directory/database permissions, SQLite integrity, operations schema, built dashboard, and origin/proxy syntax. Failed checks return a nonzero exit code. It does not change permissions or migrate the database. Warnings require operator review: a local check cannot verify TLS termination, proxy routing, service supervision, or a successful backup restore.

Keep the public endpoint behind a VPN or identity-aware access proxy unless your organization explicitly accepts password-only access without MFA. Set HSTS at the HTTPS proxy after validating the domain. Set the trusted proxy IP to the actual socket peer, not a blanket network or client-supplied name. The proxy must preserve the public Host header and replace or append X-Forwarded-For with the true connecting address. Forwarded headers from an untrusted socket are ignored. Keep the Node port inaccessible to untrusted direct clients. See [AUTH.md](AUTH.md) for browser origin checks and auth limits.

## Withdraw and purge shared content

Owners and admins can withdraw an exact setup or skill revision in its detail drawer. The CLI supports:

```sh
loadout team withdraw engineering alice/review --scope work --revision FULL_HASH
loadout team withdraw-skill engineering alice/review-skill --scope work --revision FULL_HASH
```

Withdrawal immediately blocks new direct downloads, removes the revision from the available catalogue, and enters the change feed. Setups bundling a withdrawn skill are blocked too, with affected skill names visible in history and the unavailable section. Clients learn tombstones on sync and refuse new execution/materialization/installation through Loadout for known withdrawn content. Publish a reviewed replacement to move forward. A saved head or historical revision is never silently switched to a different bundle.

Withdrawal cannot recall files already downloaded, erase someone else's installed copies, or prevent a member from republishing content they already possess. Already materialized directories can be run outside Loadout. Work/personal scope does not remove personal material from deliberately shared files.

Admins can set the **withdrawal retention period** under Team & access → Workspace operations. Default: 30 days. Retention does not postpone withdrawal: downloads are blocked immediately. After the period, an admin can explicitly purge eligible server payloads, or the host operator can run:

```sh
loadout registry usage --data /private/loadout-registry
loadout registry purge-withdrawn --data /private/loadout-registry
```

Purge is destructive. It removes eligible withdrawn payload bodies, including setup blobs whose withdrawn skill dependencies make every reference unavailable. Still-available aliases protect a shared blob from purge. Tombstones, revision metadata, change cursors, and administrative history remain. This is logical removal, not a secure erase of disk pages; SQLite/WAL files and backups can retain previous bytes. Apply the organization's backup expiry and secure storage disposal procedures separately. Active usage records are retained; this policy is for withdrawn content, not automatic age-based analytics deletion.

## Quotas and audit history

Default limits are **500 MB of stored payloads** and **100,000 runs**. Admins can change them in Workspace operations. Publication and metadata ingestion reject over-quota batches atomically. A failed upload leaves the local data available for retry. The payload measure covers setup/skill blobs, run/assessment records, and the change feed; it is not the SQLite file size and excludes indexes, account state, audit/catalogue bookkeeping, and backups. Leave disk headroom and monitor the volume separately.

The administrative event list records new account setup/login/join/reset, invitations, access/device changes, publication/withdrawal, trial decisions, quota changes, and purge operations. Entries contain actor, action, target identifier, and server time, not passwords or link capabilities. The UI paginates older events. Events before this feature was enabled are not fabricated or backfilled. The local host and its backups remain the trust boundary; this is not an externally immutable compliance log.

## Device and collector recovery

Renew a device using its existing `team login REMOTE --url URL --scope SCOPE` command and approving as the same member. The client checks identity, writes the credential atomically, preserves sync history, and attempts to revoke the old credential. A watcher rereads the current credential on each request. If revocation fails, inspect/revoke the old credential from My devices.

Device status separates authorization, successful sync, saved configurations, local source checks, and the collector report. Existing devices show “not reported” until their upgraded client syncs. Source checks are opt-in (`setup check`, `team status --check`, or `team sync --watch 30 --check`) and never automatically publish a changed setup. Supply the same `--scope` and `--home` used when connecting.

Native collectors checkpoint counters privately every five seconds. Collecting checkpoints are skipped by sync and rejected by the registry. Normally, exit the native harness so it flushes, then stop the collector with Ctrl-C and sync. After an abrupt collector exit:

```sh
loadout telemetry recover --scope work
loadout team sync engineering --scope work
```

Only checkpoints belonging to a dead process are finalized as interrupted. Live processes are left alone. Counters since the last checkpoint and native events that never arrived can be lost. Recovery retains metadata, never raw events or task content. A collector status is its last device report, not an always-on heartbeat.

## Restore

Stop the service before restoring a complete consistent backup. Verify private permissions and run `registry doctor` before reopening access. An old backup can put a client's download cursor ahead of the service; the client refuses that mismatch instead of silently skipping data. Do not reset cursors casually or mix teams/scopes. Retain the current private store while an operator reconciles the restored registry and missing published revisions. Recheck device revocations and consumed capabilities when restoring older auth state.
