# Shared skills and native harnesses

Loadout supports a standalone skill library and native setup snapshots for Pi, Claude Code, Codex, Cursor, and OpenCode. Usage collection currently covers Pi, Claude Code, and Codex. A setup keeps its own configuration format; no full setup translation is attempted. Existing Pi profiles, registry contents, and analytics exports remain readable.

The dashboard has **Shared skills**, a harness filter in **Shared setups**, and a harness filter for activity. Skill details include compatibility, requirements, exact revision, installation commands, setups pinning that revision, and measurements referencing it. The same skill can be pinned into multiple native setups.

## Share one skill

Run from a device already connected with `team login`. These examples assume your remote is named `engineering`; substitute your actual remote name.

```sh
loadout skill capture /path/to/review-skill --scope work \
  --compatible pi,claude-code,codex --requires 'Git installed locally'
loadout skill inspect review-skill --scope work
loadout team publish-skill engineering review-skill --scope work
```

The name and description come from `SKILL.md` frontmatter. The directory, supporting files, and executable bits are included. Compatibility is a publisher declaration, not an automated guarantee. Skills with harness-specific frontmatter require an explicit compatibility declaration. Plain standard skills continue to default to Pi, Claude Code, and Codex; opt in to Cursor and OpenCode after checking them with `--compatible cursor,opencode` (or include other verified harnesses). Cursor/OpenCode skill names must use lowercase words separated by single hyphens, up to 64 characters. OpenCode skill descriptions are limited to 1024 characters. Use `--compatible claude-code` for a Claude-specific skill.

On another device:

```sh
loadout team skills engineering --scope work
loadout team pull-skill engineering alice/review-skill --scope work \
  --revision FULL_REVISION --as colleague-review
loadout skill install colleague-review --harness codex --scope work --project .
```

`--project .` installs into `.agents/skills/<name>` for Codex, Cursor, and OpenCode, `.claude/skills/<name>` for Claude Code, or `.pi/skills/<name>` for Pi. Without `--project`, installation uses the corresponding user skill directory. One `.agents/skills` copy can be discovered by all three compatible agents; it is one installation, not three copies. `--out` selects an exact new skill directory. Existing destinations are never overwritten. To upgrade, inspect and move/remove the old directory yourself, then install the chosen version.

An installation receipt inside the skill directory preserves its compatibility and version metadata for later setup capture. Receipts are excluded from the shared bundle. Editing a supporting file and capturing again produces a new content revision; it does not change an existing published revision.

Offline exchange is available through `skill export NAME --out FILE` and `skill import FILE`.

## Pin a skill into a setup

```sh
loadout setup add-skill my-review colleague-review --scope work
loadout team publish engineering my-review --scope work
```

This creates a new local setup revision containing the exact skill files and a verified pin. A same-named unpinned bundled skill is rejected to avoid ambiguous loading. `--as another-local-name` preserves the current local alias as well as its immutable revision.

To extract a pinned skill from a downloaded setup:

```sh
loadout skill extract colleague-setup review-skill --scope work
```

The extracted skill retains its declared compatibility. Use `--compatible` only after checking its behavior and dependencies on other harnesses.

## Share native setups

```sh
loadout setup capture my-claude --harness claude-code --scope work
loadout setup capture my-codex --harness codex --scope work
loadout setup capture my-pi --harness pi --scope work
loadout setup capture my-cursor --harness cursor --scope work --project /path/to/project
loadout setup capture my-opencode --harness opencode --scope work --project /path/to/project
loadout setup list --scope work
loadout team publish engineering my-claude --scope work
```

`--agent-dir` selects another configuration directory. `--project` includes supported project configuration/resources; repository instruction files stay with the task. `--workflow` and `--prompt FILE` declare the reusable workflow. Native versions are detected from the installed CLI; a missing executable records `unknown`. `--harness-version` is available for offline/test capture.

For Claude Code, list local choices before capture. The inventory lists selectors without reading file contents. Pass `--only-resource` once per item you want to share, `--exclude-resource` for items to leave out, or `--no-resources` if you want only the selected settings and MCP names. These modes cannot be combined. Skills, agents, hooks, prompts, and global `CLAUDE.md` are included by default; Claude commands require explicit selection. Settings and MCP server names are handled separately from these resource selectors. An unselected resource's contents are not scanned or bundled.

```sh
loadout setup inventory --harness claude-code --scope work
loadout setup capture my-claude --harness claude-code --scope work --exclude-resource global/skills/unused
loadout setup capture lean-claude --harness claude-code --scope work --only-resource global/skills/reviewer --only-resource global/agents/reviewer.md
```

Native capture deliberately selects supported model/reasoning settings, permission settings, hooks, reusable global instructions, skill directories, and other reusable resources. Claude captures enabled plugin declarations. Cursor captures project rules, commands, agents, hooks, and skills, plus portable CLI permissions. OpenCode captures JSON/JSONC model and agent settings, commands, agents, plugins, tools, and skills. All four native harnesses record MCP server names only; MCP launch commands, arguments, URLs, and credentials are not included. Authentication files, telemetry destinations, session history, automatic memories, arbitrary environment values, and project account/trust state are excluded. Omitted setting names appear in the setup inspector.

Plugin declarations and named MCP servers are requirements, not bundled installations. Configure MCP servers independently on each receiving device. Hook scripts are bundled when they live under the captured hooks directory, but machine-specific command paths may need adjustment. Dependencies outside captured directories and installed plugin caches are not copied. Managed policies remain authoritative.

Historical native revisions that contain MCP definitions remain in registry history, but their browser previews show names only and their downloads and file inspection are blocked. Recapture and publish a names-only revision to restore distribution.

If a native skill has nonstandard or invalid frontmatter, setup capture retains its files as a native resource and adds a requirement to review it. It receives no standalone skill pin or cross-harness compatibility declaration. Explicit standalone skill capture still requires valid metadata, and credential/file checks still apply. An invalid installed shared-skill receipt cannot silently fall back to an unpinned resource.

```sh
loadout team pull engineering alice/my-claude --scope work --as colleague-claude
loadout setup materialize colleague-claude --scope work --out /path/to/new-config
```

Materialize creates a new native configuration directory and prints a launch command using `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. Launch from your chosen local project, authenticate locally if needed, and resolve the listed dependencies. It does not export MCP definitions or an `mcp.json`; configure the named servers locally if the workflow needs them. Your default harness configuration is not overwritten. Local project configuration and ambient resources may still affect behavior, so these launches are not controlled experiments.

For Cursor and OpenCode, `setup materialize` creates a new project-shaped bundle containing `.cursor/` or `.opencode/` and, for pinned skills, `.agents/skills/`. OpenCode's selected settings are written to `opencode.json`. Review those files before copying selected parts into your project; Loadout never overwrites your project. Cursor account-synced user and team rules cannot be read from local setup files, so they are not included. Cursor and OpenCode usage collection is not available yet.

Setup snapshots and skills are **explicitly captured and published**. Pulling pins the selected revision. `team sync --watch` exchanges saved measurements and catalogue metadata; it neither publishes configuration changes nor installs newer versions automatically. Optional `--check` detects drift against saved capture sources without updating the saved/published setup; see [TEAM.md](TEAM.md). Optimistic concurrency checks reject publishing over a revision changed on another device.

## Native usage analytics

Pi continues to use `/share-start` and `/share-stop`. For Claude Code or Codex:

```sh
loadout telemetry listen my-codex --scope work
```

The collector prints a command to launch the matching installed harness with OTLP HTTP JSON routed to an authenticated, loopback-only endpoint. Run that command in another terminal from your project. To select a materialized setup, pass `--config-dir /path/to/new-config` to the collector. It validates the local revision receipt and includes `CODEX_HOME` or `CLAUDE_CONFIG_DIR` in the launch command. This receipt binds the intended launch, but does not attest effective runtime configuration. Exit the harness first so it flushes events, then press Ctrl-C in the collector to save local measurements. Finally:

```sh
loadout team sync engineering --scope work
```

The collector performs no network upload to the registry. It processes native events in memory and atomically checkpoints selected counters/metadata locally every five seconds. Active checkpoints are not synced. It rejects trace endpoints, disables prompt/body logging in its generated commands, discards tool inputs/outputs, and never reads transcript files. Its temporary local credential is unrelated to the team credential and expires when the collector stops.

Saved native observations have status **recorded**. They describe the interval of events received, not a verified completed task. The selected setup/workflow is an attribution label: the collector does not prove that the process loaded that exact setup or skill version, and does not measure frozen task context. Skill names may be redacted by the harness; absent observations show as unavailable. Run counters are immutable after saving. Stop/restart creates a new observation interval rather than revising an already synced record. If the collector is killed abruptly, run `loadout telemetry recover --scope work` in the same store, then sync. Recovery marks dead-process checkpoints **interrupted** and preserves the last saved counters; live collectors are skipped. Up to the last five seconds and unflushed native events can still be lost. Ctrl-C finalizes the interval normally. The dashboard labels interrupted collection explicitly.

Claude exposes usage and cost estimates; Codex exposes usage counters while cost may remain unavailable. Missing measurements are explicitly marked unavailable. These values are usage estimates, not subscription invoices. The adapter does not infer task quality or skill effectiveness from usage.

Cross-harness observations can be selected in **Activity** for inspection. The controlled frozen review runner remains Pi-only in this release; Claude Code/Codex observations must not be treated as equivalent frozen-context experiments.

The integration follows [Claude Code's monitoring documentation](https://code.claude.com/docs/en/monitoring-usage) and [OpenAI's Codex telemetry documentation](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry). Client versions have different event coverage.

## Verification

`npm test` covers skill round trips, pinned references, native capture exclusions, legacy Pi compatibility, registry conflicts, authenticated dashboard endpoints, collector boundaries, and CLI installation flows. The optional smoke scripts exercise the installed native CLIs against scripted **loopback-only** model endpoints:

```sh
npm run build
node scripts/verify-native.mjs codex
node scripts/verify-native.mjs claude-code
```

These checks use temporary configuration directories and dummy local credentials. They do not change the user's harness configuration or make paid model calls.
