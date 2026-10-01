# Dashboard, accounts, and device connection

Loadout 0.4 serves its dashboard from the same Node server and SQLite registry as the CLI API. One installation is one team and one work/personal scope. Authentication does not depend on a cloud account or an email provider.

The onboarding model combines **a host-issued first-admin link**, **admin-created invitations**, and **browser-approved device credentials**. Admins choose who can join and which role they receive. Each person chooses their own password; harnesses never need that password.

## First installation

From the Loadout repository:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js serve --data ~/.pi-share-registry/work --team engineering --scope work
```

Open the URL in `~/.pi-share-registry/work/setup-link.txt`. The file has private permissions and the link expires after 30 minutes. Create your name, email, stable member handle, and password. The first account is an admin. Setup closes atomically once it is created, including when two browsers submit concurrently. Visiting an unclaimed installation without its private link does not allow an outsider to claim it.

`serve` creates a registry if absent and reopens it otherwise. Existing v0.2 registries gain account tables without replacing setup revisions, measurements, sync cursors, or legacy device credentials. Choose your existing actor handle when creating an account for that identity.

A new server start before account creation issues a fresh setup link, invalidating the previous one. To issue a fresh link without restarting:

```sh
node dist/cli.js registry setup-link \
  --data ~/.pi-share-registry/work --public-url http://127.0.0.1:4318
```

Installation and password reset links put the secret in the URL fragment. It is removed from browser history after the page reads it and is sent only in the same-origin form request. If a page is reloaded before completing the form, reopen the original private link.

## Invite a teammate

1. Open **Team & access → Invite teammate**.
2. Set the recipient's email, stable member handle, and role. Use **Member** for ordinary team access.
3. Copy the generated invitation link and share it privately with that recipient.
4. They open it, enter their name and choose a password of at least 12 characters.

Invitations expire after 7 days, can be revoked, and work once. The recipient cannot change the invited email, handle, or role. The raw link is displayed only when created; the database stores its hash. An invalid or consumed link offers a return to sign-in or the workspace. If you lose it, revoke the pending invitation and create another.

Email is an account identifier here. Delivery is manual; Loadout does not verify mailbox ownership or send email. Possession of the invitation lets someone create that invited account, so deliver it through your existing private team channel. Public signup is disabled.

Admins can invite members/admins, change roles, disable/re-enable accounts, and issue password reset links. At least one active admin must remain. Disabling an account revokes its sessions and all its device credentials, including v0.2 operator-issued credentials for the same handle. Re-enabling it does not reactivate old credentials. Demoting an admin also invalidates its sessions, device credentials, and unconsumed links it issued.

All active members can read shared configurations and measurements in this installation. They can also browse member names, handles, optional job titles, and optional company teams in **People**. Each member controls their own optional profile fields; account email and access controls remain admin-only. Setup publishing, run ownership, and reviewer identity are still enforced by the registry. Admin browser accounts and device credentials are separate: possessing a CLI token does not grant browser administration.

## Connect Pi on any device

After joining, open **My devices** and copy the harness instructions. You may share these instructions broadly: they contain the server address and scope, but no invitation, account password, or reusable access token.

**What’s shared** is available on the sign-in/registration screens and in the dashboard footer. My devices shows a summary before connection, and copied harness instructions include the full disclosure. Published setup files and synced usage metadata are visible to workspace members; analytics sync excludes session traces, task messages, raw tool inputs/outputs, repository files/diffs, frozen task context, and generated reviews. Reusable setup files are intentionally shared content, so do not put task-specific code, notes, or credentials in them. The notice explains account/device information and when sharing happens; it does not add a consent gate or change collection or sync behavior.

The harness uses your existing local Loadout checkout or installed CLI:

```sh
node dist/cli.js team login engineering \
  --scope work --url https://share.example.com --label work-laptop
```

Or use `loadout team login ...` after `npm link` in this repository. Do not install an unrelated public npm package with a similar name.

The CLI shows a device code and approval URL, then waits up to 10 minutes. Open that URL yourself, sign in, check that the code matches the one on your device, and approve it. The next CLI poll receives an individual credential for **the approving account**. Neither the admin nor the browser receives that device's bearer token.

Each device credential expires after 90 days and is independently revocable in **My devices**. Credentials are stored privately in that scoped local store. Logging out of the browser does not disconnect your devices. Password reset or account disabling does.

Connecting changes the scoped store's default member identity and pins the team identity. It does not capture, publish, or synchronize existing data. Those remain explicit CLI actions. Work and personal stores stay separate; different teams within the same scope require separate `--home` directories.

If a login expires or is denied, start it again. If a completed credential response is lost, use a new device login and revoke any unused credential from **My devices**. To reconnect an existing remote with an expired/revoked credential, run `team login` again with the **same remote name, server URL, and scope**. Approve it as the same member. Loadout verifies the server/team/member identity before replacing the credential, preserves the sync cursor and publication state, and attempts to revoke the old credential. An already-running watcher reads the renewed credential on its next request. A different member or server is rejected; use a separate scoped store for a different team.

The flow is inspired by the [OAuth device authorization grant](https://www.rfc-editor.org/rfc/rfc8628). It is a Loadout-specific protocol, not an OAuth/OIDC provider or implementation claiming RFC conformance.

## Dashboard views

- **Overview:** latest shared revisions, device/sync status, pending trials, then complete period totals and tool usage grouped by harness.
- **Shared setups and skills:** pinned links, revision history, plain-text supporting-file inspection, content differences, requirements, explicit local handoff, and owner/admin withdrawal. Skill usage has an explicit all-harness scope and structured usefulness feedback.
- **People:** an active-member directory searchable by name, handle, optional job title, or optional company team. Members maintain only their own profile fields.
- **Activity:** server-paginated runs, visible search/member/workflow/harness filters, metadata coverage, stable run links, human assessments, and selection of 2–4 runs for inspection.
- **Comparisons:** named setup trials, compatible revision selection (including the candidate's available history), local CLI instructions, full experiment results, assessments, and an explicit decision. Pi trials use one frozen packet; native trials remain usage observations.
- **My devices:** authorization and last successful sync are separate. Source checks and collector state are reports at the last sync, not a live heartbeat. Connection instructions open on demand.
- **Team & access:** admin-only member/invitation management, member devices, administrative events, payload quotas, and withdrawn-content retention/purge.

The dashboard defaults to live activity. Demo measurements are separate. Period totals cover all matching runs in the selected 7, 30, or 90 days; Activity returns pages of 100. Experiment filters select groups, and an opened experiment includes all its runs even when some lie outside that period. Catalogue metadata is cached separately from file blobs. Configuration catalogues and named trials are independent of activity filters; skill detail states its own period/mode scope. Details and filters have stable URLs.

Spend is a provider usage estimate, not an invoice. Runs with missing model pricing or incomplete usage coverage are excluded from the aggregate with an explicit count; individual unknown estimates remain unavailable. Skills indicate observed reads/commands, not proof that a model followed the skill. The dashboard never infers a quality winner from spend, speed, or tool volume. Runner context hashes describe frozen review packets. Interactive extension hashes describe the starting session branch; matching interactive hashes do not establish equal repository state or task context, and the comparison view marks that limitation. Claude Code/Codex context is explicitly unmeasured; a synthetic telemetry fingerprint never establishes equal task context.

## Recovery

An admin can create a 30-minute, single-use password reset link from **Team & access**. The recipient chooses a new password, which invalidates all of their prior sessions and device credentials.

An operator with access to the server filesystem can recover an active account without another signed-in admin:

```sh
node dist/cli.js registry recovery-link \
  --data ~/.pi-share-registry/work \
  --email admin@example.com --public-url https://share.example.com
```

Open the private link written to `reset-link.txt` in the registry directory. The command does not print the secret or change the password itself. Creating a new reset link revokes the previous unconsumed one. These operator commands require filesystem access; there is no unauthenticated recovery endpoint that generates links.

## Deployment

For another device to connect, put the Node server behind an HTTPS reverse proxy and set its exact browser-visible origin. For an internal team deployment, also keep the service behind a VPN or identity-aware access proxy; Loadout's local password authentication does not currently provide MFA or SSO:

```sh
node dist/cli.js serve --data ~/.pi-share-registry/work \
  --host 127.0.0.1 --port 4318 \
  --public-url https://share.example.com --trusted-proxy 127.0.0.1
```

Proxy `/`, `/assets`, `/api`, and `/v1` to that server and **preserve the public Host header**. Set HSTS at the HTTPS proxy after confirming the domain is served only over HTTPS. API browser mutations require that exact Origin; forwarded-host headers are not trusted. Use a single origin without a path prefix. Non-loopback public URLs require HTTPS. Browser cookies use HttpOnly, SameSite=Lax, and Secure with an HTTPS public URL; they expire after 7 days. The service does not implement TLS termination itself.

Retain the built `web/dist` alongside `dist` when deploying. Do not expose the registry directory, setup-link files, or client connection files as static assets. The built-in file handler serves only application pages and bundled assets. Its CSP restricts scripts/connections to the same origin and blocks framing. No third-party fonts, trackers, or session replay scripts are included.

Run a single server process for a small-team trial, supervise it with your usual service manager, and back up the registry directory while the service is stopped. Auth attempt limits use persistent SQLite buckets: 30 attempts per socket IP per 5 minutes, 10 login attempts per email per 5 minutes, and 100 authenticated mutations per user per minute. By default forwarded IP headers are ignored. Configure `--trusted-proxy` with only the explicit IP addresses of proxies you control (comma separated). The service walks X-Forwarded-For from the trusted socket back to the first untrusted address. The proxy must replace the header or append the actual connecting IP; do not blindly forward a caller-supplied header. Restrict direct access to the Node listener. Email/account limits still apply, and hashing remains capped at two concurrent jobs. Without this configuration, proxy clients share the socket IP bucket.

Passwords use salted Node scrypt (N=2^17, r=8, p=1), following the [OWASP password storage recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Random session, invitation, reset, setup, and device secrets are hashed in the database. Expiring one-time reset capabilities and access invalidation follow the principles in [OWASP's password reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

This is local password auth for a self-hosted team. SSO, passkeys/MFA, automated email delivery, and multi-server deployment remain future work. Audit events and storage/retention controls are implemented; see [OPERATIONS.md](OPERATIONS.md) for the deployment check, policy, withdrawal, purge, and backup procedure. The registry still trusts members to report their own measurements; it cannot attest that a local harness measured every call accurately.

## Local development

```sh
# Terminal 1: same database/API, with the Vite origin allowed
node dist/cli.js serve --data .demo/dashboard --team loadout --scope work \
  --public-url http://127.0.0.1:4319

# Terminal 2
npm run dev:web
```

The Vite server listens on 4319 and proxies `/api` and `/v1` to 4318. For a production-build local preview, omit `--public-url` and open port 4318. `npm run dashboard` builds and serves a fresh or existing `.registry` installation.
