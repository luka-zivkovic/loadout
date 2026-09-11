# Pi workflows and comparisons

Capture a reusable Pi review setup, compare it with a colleague's setup on the same local Git change, and collect usage measurements during normal work. The controlled runner uses Pi 0.85.1.

For publishing through a team registry, see the [team workflow guide](../TEAM.md). For Claude Code and Codex, see [shared skills and native harnesses](../SKILLS-AND-HARNESSES.md).

Run these commands from the repository root after building Loadout.

## Share your actual review setup

Capture the global Pi configuration and, optionally, a project's `.pi` configuration:

```sh
node dist/cli.js profile capture my-review \
  --scope work --project /path/to/repository \
  --workflow pr-review --prompt /path/to/review-request.md

node dist/cli.js setup inspect my-review --scope work
node dist/cli.js profile export my-review --scope work \
  --out /path/to/exchange/my-review.profile.json
```

The request file is the reusable workflow entry point. For example, if your setup has a skill named `review`, it could contain `/skill:review Review this frozen change.` Omit `--prompt` to use the included general review request. The `--workflow` value is a grouping label; it does not infer a workflow from past sessions.

Each colleague captures and exports their own named profile. On the receiving machine:

```sh
node dist/cli.js profile import /path/to/exchange/colleague-review.profile.json --scope work
node dist/cli.js profile list --scope work
```

Import stores an immutable revision and updates its local name pointer. It does not replace your normal Pi settings. Names can refer to the latest import; use the full revision hash to select an older version.

Capture defaults to `PI_CODING_AGENT_DIR` or `~/.pi/agent`; `--agent-dir` selects another source. Local model credentials and custom `models.json` definitions must exist on the receiving device. Runs use `--auth-dir`, `PI_CODING_AGENT_DIR`, or `~/.pi/agent` for those local credentials. **The work/personal scope does not select a credential account.**

### What a profile contains

- Pi version; model, thinking level, tool defaults, and supported inference settings.
- Workflow request, global instructions, explicit system prompt overrides, skills, prompt templates, and extension source files, including executable script permissions.
- Exact npm package versions or Git commit references, required local capabilities, and a list of settings omitted by capture.
- A SHA-256 revision over the profile's content.

Credentials, `models.json`, session history, memory directories, `.git`, and `node_modules` are excluded from capture. Common credential filenames and embedded token patterns are rejected. This check is best effort: profile files and the reusable workflow request are intentionally shared content, and may contain your own proprietary instructions.

Unpinned packages, package filtering objects, resource selection globs, and symlinks are rejected rather than silently changing the setup. Package references must look like `npm:@team/review@1.2.3` or `git:github.com/team/review@<40-character-commit>`. A project's declaration replaces the same global package's version. Loose extensions with external dependencies may require conversion into a pinned Pi package; the prototype does not restore their local `node_modules`.

## Compare on the same context

Freeze the exact base and head commits, with optional shared task documentation:

```sh
node dist/cli.js freeze --repo /path/to/repository \
  --base origin/main --head HEAD \
  --context /path/to/review-context --out /path/to/frozen-review

node dist/cli.js compare --scope work --actor alex \
  --profiles my-review,colleague-review \
  --packet /path/to/frozen-review --repeat 2
```

Omit `--context` when no extra documents are needed. If the PR base should be its merge base, resolve that commit first and pass it as `--base`. The tool compares the two supplied commits directly.

The packet contains the exact tracked head files, a binary-capable diff, the explicitly provided context directory, and a Git bundle containing the base/head commits and their reachable history. Uncommitted and untracked work is excluded. Symlinks and submodules are currently unsupported. Packets are local code artifacts; neither profile export nor analytics export includes them.

Every run receives a fresh copy of the same packet and an in-memory Pi session. The agent sees `repo/`, `PR.diff`, and `context/`; `git -C repo diff base..HEAD` also works. The runner loads the selected profile's resources and the frozen repository's root instructions, with ambient resource discovery disabled. It validates the packet's file contents before and after running. Changed working files make the run invalid.

This addresses context in two parts: your colleague supplies the reusable setup; both setups receive the same task evidence. Extra organizational knowledge needed by both belongs in `--context`. A private memory file or an external service available only to one setup makes a broader comparison, and must be accounted for when interpreting results.

By default each profile keeps its model, thinking level, and tools. `--model PROVIDER/MODEL` applies the same model to both. `--tool-policy read-only` fixes the built-in tools to `read`, `grep`, `find`, and `ls`; this override is recorded. For a focused skill comparison, also use profiles with the same thinking setting. Repeats alternate execution order.

Extensions remain trusted executable code, including under the read-only policy. This is configuration isolation, not an OS sandbox: extension code, Bash, and external integrations can reach outside the packet. The built-in read tools are restricted to the packet and profile directory, but file validation cannot make arbitrary extensions deterministic. Executing a colleague's profile should follow your existing policy for running their code.

Run only one imported setup with:

```sh
node dist/cli.js run colleague-review --scope work --packet /path/to/frozen-review
```

Each run saves `review.md`, `metrics.json`, and configuration fingerprints under `~/.pi-share/work/runs/<run-id>/`. It does not save a transcript or raw tool events. A comparison saves a Markdown report with setup revisions, context hashes, tool calls/errors, observed skill loads, tokens, estimated cost, and duration.

## Collect analytics during normal Pi work

Load the built extension when starting Pi in your usual repository. Replace the extension path with its absolute path on that device:

```sh
PI_SHARE_SCOPE=work PI_SHARE_ACTOR=alex PI_SHARE_PROFILE=my-review \
  pi -e /absolute/path/to/loadout/dist/extension.js
```

Inside Pi, enter `/share-start pr-review`, perform the workflow, then enter `/share-stop`. Collection is opt-in and stays local. Closing a measured session without stopping marks it aborted. Your existing Pi installation retains its normal session behavior; this extension does not copy or export those sessions.

The extension snapshots configuration at the start and measures subsequent main-session activity. It deliberately excludes the interactive request, so use `profile capture --prompt ...` when creating a replayable workflow. Model changes appear as separate model counters. Configuration fingerprints describe the starting setup; arbitrary dynamic extension changes are not fully captured.

Use the same `PI_SHARE_ACTOR` or CLI `--actor` on your devices to group your records. Device IDs are generated separately in each store. Use `PI_SHARE_SCOPE=personal` for personal work. All CLI commands also accept `--home DIR` (or `PI_SHARE_HOME`) to select a different storage root. Work and personal imports cannot be mixed.

### Exchange metadata

```sh
node dist/cli.js analytics export --scope work --out /path/to/exchange/my-metrics.json
node dist/cli.js analytics import /path/to/exchange/colleague-metrics.json --scope work
node dist/cli.js analytics report --scope work
```

Share these explicit exports, rather than the whole store: the store also contains local code packets and final reviews. Imports validate a strict schema, deduplicate identical run IDs, and reject changes to immutable run data. Version 2 exports also carry the edit history of human assessments; version 1 exports remain readable. The team registry supports the same boundaries through authenticated, incremental synchronization.

| Exported analytics                                                  | Deliberately absent                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| Actor/device IDs, timestamps, work/personal scope                   | Conversation messages and reasoning                    |
| Workflow ID, setup revision, effective setup hash, context hash     | Task prompts, diffs, source code, context documents    |
| Model/thinking settings, token/cache counters, estimated model cost | Tool arguments, commands, file paths, tool results     |
| Tool names, counts, errors, aggregate duration                      | Credentials, environment values, provider error bodies |
| Available/observed skill names and content hashes                   | Skill bodies and final review text                     |
| Completion/failure category, optional human scores                  | A raw event stream or session trace                    |

IDs, model/tool/skill names, timestamps, and activity volumes are still identifying metadata. A context hash links equivalent inputs; it cannot reconstruct missing context.

Skill measurement distinguishes availability from observed loading via a successful built-in `read` or explicit `/skill:` command. It does not prove that the model followed a skill, and misses skills loaded through Bash or arbitrary extensions. Tool and token totals cover the instrumented Pi session; separate subprocess agents and services require their own instrumentation. Day-to-day extension hooks also do not expose every internal retry.

Costs are the Pi model usage estimates from observed assistant messages, not subscription invoices. Missing estimates remain unknown. Internal summarization and direct model calls made by extensions may be unobserved. Transitive package versions, external services, environment variables, and dynamic extension state can still vary; starting configuration fingerprints help identify differences but do not guarantee fully reproducible execution.

## Evaluate review quality

Read the local reviews against the actual change, then record human judgments:

```sh
node dist/cli.js score RUN_UUID --scope work --valid 2 --false 1 --missed 0
node dist/cli.js analytics report --scope work --comparison COMPARISON_UUID
```

`missed` requires known defects or an adjudicated reference. Lower spend or more skill/tool usage is not a quality score. Compare several representative changes and inspect valid findings, false positives, and missed issues together. The prototype does not automatically declare a winner.

Scores are now immutable assessment events attached to a run and reviewer. Editing a score creates a new event that supersedes the locally known versions. Concurrent offline edits remain visible as conflicting versions after sync. Inspect them, then run `score` again to record the resolution. Different reviewers retain independent assessments. Regenerate the analytics report after scoring; the original comparison report is a snapshot. Existing version 1 scores are retained and migrated to assessment events when their owner's metadata is synced.

[Back to Loadout](../README.md)
