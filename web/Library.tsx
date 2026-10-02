import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Maximize2,
  Plus,
  Search,
  RefreshCw,
} from "lucide-react";
import {
  harnessLabels,
  type Harness,
  type NativeSetup,
  type Profile,
  type Skill,
} from "../src/schema";
import type { ProfileListing, SkillListing } from "../src/team-protocol";
import type { WebUser } from "../src/web-auth";
import {
  api,
  Copy,
  date,
  Empty,
  ErrorBox,
  Field,
  Modal,
  money,
  short,
  type Dashboard,
} from "./shared";
import { HarnessIcon, HarnessLabel } from "./HarnessIcon";
import {
  ArtifactControls,
  FileBrowser,
  SkillPackagePreview,
  SetupDiff,
  type FileCategory,
  useArtifactSelection,
  refKey,
} from "./Artifacts";
import {
  go,
  useParam,
  artifactUrl,
  setupPageUrl,
  type ArtifactRef,
} from "./navigation";
import type { AnalyticsSummary } from "../src/analytics";

type Preview<T extends { files: { data: string }[] }> = Omit<T, "files"> & {
  files: Omit<T["files"][number], "data">[];
};
type SetupPreview = Preview<Profile> | Preview<NativeSetup>;
function bundleContains(root: string, path: string) {
  return path === root || path.startsWith(`${root}/`);
}
function setupFileCategories(profile: SetupPreview): FileCategory[] {
  const resources = profile.resources;
  const skillCollections = profile.files
    .filter(
      (file) =>
        (file.path === "SKILL.md" || file.path.endsWith("/SKILL.md")) &&
        resources.skills.some((root) => bundleContains(root, file.path)),
    )
    .map((file) => {
      const root =
        file.path === "SKILL.md"
          ? ""
          : file.path.slice(0, -"/SKILL.md".length);
      return {
        key: root || profile.name,
        label: root.split("/").at(-1) ?? profile.name,
        root,
      };
    });
  const categories: FileCategory[] = [
    {
      key: "instructions",
      label: "Instructions",
      description: "Guidance intended for the agent context.",
      paths: profile.instructions,
    },
  ];
  if (profile.schemaVersion === 1)
    categories.push(
      {
        key: "extensions",
        label: "Extensions",
        description: "Pi code loaded when this isolated setup starts.",
        paths: profile.resources.extensions,
      },
      {
        key: "prompts",
        label: "Prompt templates",
        description: "Reusable prompts exposed to the setup.",
        paths: resources.prompts,
      },
    );
  else
    categories.push(
      {
        key: "hooks",
        label: "Hooks",
        description: "Lifecycle commands the native harness may execute.",
        paths: profile.resources.hooks,
      },
      {
        key: "agents",
        label: "Agents",
        description: "Custom agent definitions exposed to the harness.",
        paths: profile.resources.agents,
      },
      {
        key: "prompts",
        label: "Prompt templates",
        description: "Reusable prompts exposed to the setup.",
        paths: resources.prompts,
      },
    );
  categories.push({
    key: "skills",
    label: "Skills",
    description: "Each skill appears once; select it to browse bundled files.",
    paths: [
      ...resources.skills,
      ...(profile.skillPins ?? []).map((pin) => pin.path),
    ],
    collections: skillCollections,
  });
  return categories.map((category) => ({
    ...category,
    paths: [...new Set(category.paths)],
  }));
}
type LibraryProps = {
  data: Dashboard;
  refresh: () => Promise<unknown>;
  user: WebUser;
};
export function HarnessSelect({
  value,
  onChange,
  label = "Filter by harness",
  allowed = Object.keys(harnessLabels) as Harness[],
  all = true,
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
  allowed?: Harness[];
  all?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {all && <option value="">All harnesses</option>}
      {allowed.map((h) => (
        <option key={h} value={h}>
          {harnessLabels[h]}
        </option>
      ))}
    </select>
  );
}
function Publish({
  kind,
  team,
  close,
}: {
  kind: "skill" | "setup";
  team: Dashboard["team"];
  close: () => void;
}) {
  const [harness, setHarness] = useState("pi");
  const [name, setName] = useState("my-review-setup");
  const validName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name);
  const instructions = `Help me share a ${kind} with Loadout (${team.teamName}, ${team.scope}). Use my existing local Loadout CLI and remote alias; if it is unavailable, use node /path/to/pi-share/dist/cli.js from the local repository.\n\n${kind === "skill" ? "Ask me to choose a local skill directory. Capture it with loadout skill capture and declare only the harnesses we have checked. Inspect the saved skill with loadout skill inspect SKILL_NAME." : `Capture the reusable ${harnessLabels[harness as Harness]} configuration with:\nloadout setup capture ${name} --harness ${harness} --scope ${team.scope}\nloadout setup inspect ${name} --scope ${team.scope}`}\n\nShow me the exact included files and their contents, executable resources, native settings, omitted settings, and local requirements. Explain that these files become visible to workspace members. Do not include task code, notes, session traces, or credentials. Scope separates storage; it does not redact file contents.\n\nAfter I choose to publish this reviewed snapshot, use loadout team ${kind === "skill" ? "publish-skill" : "publish"} ${team.teamName} ${kind === "skill" ? "SKILL_NAME" : name} --scope ${team.scope} --reviewed-revision followed by the full revision from capture. If the snapshot changed, inspect the new revision first. Report the published revision and its library link.\n\nSubsequent edits remain local until captured, reviewed, and published again. loadout setup check reports changes without publishing them.`;
  return (
    <Modal
      title={kind === "skill" ? "Share a skill" : "Share a native setup"}
      close={close}
      compact
    >
      <div className="modal-body">
        <p>
          Capture locally, review the exact contents, then publish a pinned
          revision. Your harness can carry out these steps with you.
        </p>
        {kind === "setup" && (
          <>
            <Field label="Harness">
              <HarnessSelect
                value={harness}
                onChange={setHarness}
                all={false}
                label="Setup harness"
              />
            </Field>
            <Field label="Setup name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </Field>
          </>
        )}
        <ol className="flow-steps">
          <li>Capture reusable configuration on a connected device.</li>
          <li>Inspect files, hooks, requirements, and omitted settings.</li>
          <li>Publish the reviewed revision to this workspace.</li>
        </ol>
        {validName ? (
          <>
            <Copy text={instructions} label="Copy publishing instructions" />
            <details className="spaced">
              <summary>Read harness instructions</summary>
              <pre>{instructions}</pre>
            </details>
          </>
        ) : (
          <ErrorBox error="Use letters, numbers, dots, underscores, or dashes for the setup name." />
        )}
        <p className="text-small muted spaced">
          Published contents can be withdrawn to block future downloads.
          Existing downloaded copies remain on those devices.
        </p>
      </div>
    </Modal>
  );
}
function Unavailable({ kind }: { kind: "profile" | "skill" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    api("/library/unavailable")
      .then((r) => setRows(r.unavailable.filter((p: any) => p.kind === kind)))
      .catch((e) => setError(e.message));
  return (
    <details
      className="panel unavailable-panel"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Withdrawn revisions and blocked dependencies</summary>
      <ErrorBox error={error} />
      {rows.length ? (
        rows.map((p) => (
          <div className="history-list" key={refKey(p)}>
            <button
              className="text-button"
              onClick={() => go(artifactUrl(kind, p))}
            >
              {p.owner}/{p.name} · {short(p.revision)}
            </button>
            <p className="text-small muted">
              {p.withdrawnAt
                ? `Withdrawn ${date(p.withdrawnAt)}`
                : `Bundles withdrawn skills: ${p.blockedSkills.join(", ")}`}
            </p>
          </div>
        ))
      ) : (
        <p className="muted">
          No unavailable library heads. Older revisions are listed in each
          artifact’s history.
        </p>
      )}
    </details>
  );
}
export function Setups({ data, refresh, user }: LibraryProps) {
  const [query, setQuery] = useParam("search");
  const [harness, setHarness] = useParam("catalog-harness");
  const [workflow, setWorkflow] = useParam("catalog-workflow");
  const [model, setModel] = useParam("catalog-model");
  const { chosen, setChosen, selectionError } = useArtifactSelection(
    "profile",
    data.profiles,
  );
  const [share, setShare] = useParam("share");
  const publish = share === "1";
  const setPublish = (open: boolean) => setShare(open ? "1" : null);
  const list = data.profiles
    .filter(
      (p) =>
        (!harness || (p.harness?.kind ?? "pi") === harness) &&
        (!workflow || p.workflowId === workflow) &&
        (!model || p.model === model) &&
        `${p.name} ${p.owner} ${p.workflowId} ${p.model} ${p.description ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return (
    <>
      <ErrorBox error={selectionError} />
      <section className="setup-library" aria-label="Shared setup registry">
        <div className="collection-heading">
          <p>Inspect a revision. Try it locally. Keep what works.</p>
          <div className="row-actions">
            <button
              className="icon-button"
              aria-label="Refresh data"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
            <button className="button primary" onClick={() => setPublish(true)}>
              <Plus size={16} />
              Share a setup
            </button>
          </div>
        </div>
        <div
          className="harness-tabs"
          role="group"
          aria-label="Filter by harness"
        >
          <button aria-pressed={!harness} onClick={() => setHarness(null)}>
            All setups <span>{data.profiles.length}</span>
          </button>
          {(Object.keys(harnessLabels) as Harness[]).map((h) => (
            <button
              key={h}
              aria-pressed={harness === h}
              onClick={() => setHarness(h)}
            >
              <HarnessIcon harness={h} size={20} />
              {harnessLabels[h]}
              <span>
                {
                  data.profiles.filter((p) => (p.harness?.kind ?? "pi") === h)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="search-row library-filters registry-filters">
          <div className="search-field">
            <Search size={16} />
            <input
              type="search"
              className="search"
              aria-label="Search shared setups"
              placeholder="Find a setup, owner, or workflow…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by workflow"
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
          >
            <option value="">All workflows</option>
            {[...new Set(data.profiles.map((p) => p.workflowId))].map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
          <select
            aria-label="Filter by model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">All models</option>
            {[...new Set(data.profiles.map((p) => p.model))].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        {list.length ? (
          <ul className="setup-list">
            {list.map((p) => (
              <li key={refKey(p)}>
                <button
                  type="button"
                  className="setup-entry"
                  onClick={() => setChosen(p)}
                  aria-label={`Inspect ${p.name}, ${harnessLabels[p.harness?.kind ?? "pi"]}, by ${p.owner}`}
                >
                  <span className="harness-stamp">
                    <HarnessIcon harness={p.harness?.kind ?? "pi"} size={30} />
                  </span>
                  <span className="setup-main">
                    <span className="data-label">
                      {harnessLabels[p.harness?.kind ?? "pi"]} / {p.workflowId}
                    </span>
                    <span className="setup-title">{p.name}</span>
                    {p.description && (
                      <span className="setup-purpose">{p.description}</span>
                    )}
                    <span className="setup-meta">
                      <span>{p.model}</span>
                      <code title={p.revision}>rev {short(p.revision)}</code>
                    </span>
                  </span>
                  <span className="setup-owner">
                    <span className="data-label">Publisher</span>
                    <strong>{p.owner}</strong>
                    <small>{date(p.publishedAt)}</small>
                  </span>
                  <span className="setup-resource-count">
                    <strong>{String(p.skills).padStart(2, "0")}</strong>
                    <span>{p.skills === 1 ? "skill" : "skills"}</span>
                  </span>
                  <span className="setup-open" aria-hidden="true">
                    <ArrowRight size={20} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No matching setups">
            Share a setup or adjust the filters.
          </Empty>
        )}
        <div className="registry-footer">
          <span>
            {list.length} / {data.profiles.length} setups
          </span>
          <span>Latest available revisions</span>
        </div>
      </section>
      <p className="library-footnote">
        Keep your setup. Borrow just the skill.{" "}
        <a className="text-button" href="/skills">
          Browse shared skills <ArrowRight size={15} />
        </a>
      </p>
      <Unavailable kind="profile" />
      {chosen && (
        <SetupDetail
          key={refKey(chosen)}
          listing={chosen}
          data={data}
          user={user}
          refresh={refresh}
          close={() => setChosen(null)}
        />
      )}
      {publish && (
        <Publish
          kind="setup"
          team={data.team}
          close={() => setPublish(false)}
        />
      )}
    </>
  );
}
function SetupDetail({
  listing,
  data,
  user,
  refresh,
  close,
  presentation = "drawer",
}: LibraryProps & {
  listing: ProfileListing;
  close: () => void;
  presentation?: "drawer" | "page";
}) {
  const [profile, setProfile] = useState<SetupPreview | null>(null);
  const [legacyBlocked, setLegacyBlocked] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [previous, setPrevious] = useState<{
    owner: string;
    name: string;
    revision: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    setError("");
    setProfile(null);
    setLegacyBlocked(false);
    api(
      `/setups/${encodeURIComponent(listing.owner)}/${encodeURIComponent(listing.name)}/${listing.revision}`,
    )
      .then((r) => {
        if (live) {
          setProfile(r.profile);
          setLegacyBlocked(Boolean(r.legacyMcpDetailsBlocked));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refKey(listing), attempt]);
  const harness = listing.harness?.kind ?? "pi";
  const alias = `setup-${short(listing.revision)}`;
  const pullCommand = `loadout team pull ${data.team.teamName} ${listing.owner}/${listing.name} --scope ${data.team.scope} --revision ${listing.revision} --as ${alias}`;
  const inspectCommand = `loadout setup inspect ${alias} --scope ${data.team.scope}`;
  const activationCommand =
    harness === "pi"
      ? `PACKET="/path/to/frozen-review"\nloadout run ${alias} --scope ${data.team.scope} --packet "$PACKET"`
      : `SETUP_DIR="$HOME/loadout-setups/${alias}"\nloadout setup materialize ${alias} --scope ${data.team.scope} --out "$SETUP_DIR"\n${harness === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"}="$SETUP_DIR" ${harness === "codex" ? "codex" : "claude"}`;
  const commands = `${pullCommand}\n${inspectCommand}\n${activationCommand}`;
  const requirements = profile
    ? [
        ...profile.requirements,
        ...(profile.skillPins ?? []).flatMap((pin) =>
          pin.requirements.map(
            (requirement) => `${pin.name}: ${requirement}`,
          ),
        ),
      ]
    : [];
  const detail = (
    <div
      className={`setup-detail-content ${
        presentation === "drawer" ? "modal-body" : "setup-detail-page-body"
      }`}
    >
      <div className="setup-detail-toolbar">
        <div className="tag-list">
          <span className="badge">
            <HarnessLabel harness={harness} />{" "}
            {listing.harness?.version ?? listing.piVersion}
          </span>
          <span className="badge green">
            <Check size={12} />
            Pinned revision
          </span>
          <code title={listing.revision}>{short(listing.revision)}</code>
        </div>
        {presentation === "drawer" && (
          <button
            className="button"
            onClick={() => {
              const search = new URLSearchParams(location.search);
              search.delete("setup");
              go(setupPageUrl(listing), false, {
                returnTo: `/setups${search.size ? `?${search.toString()}` : ""}`,
              });
              window.scrollTo(0, 0);
            }}
          >
            <Maximize2 size={15} aria-hidden="true" />
            Open full page
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {error && (
        <button
          className="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry setup details
        </button>
      )}
      {!profile && !error && (
        <p className="muted setup-detail-loading">Loading setup details…</p>
      )}
      <ArtifactControls
        kind="profile"
        listing={listing}
        canWithdraw={user.role === "admin" || user.actorId === listing.owner}
        refresh={refresh}
        close={close}
        onCompareRevision={setPrevious}
        comparing={Boolean(previous)}
        copyUrl={`${location.origin}${setupPageUrl(listing)}`}
        historyUrl={
          presentation === "page"
            ? setupPageUrl
            : (revision) => {
                const search = new URLSearchParams(location.search);
                search.set("setup", refKey(revision));
                return `/setups?${search.toString()}`;
              }
        }
      />
      {profile && (
        <>
          <section className="setup-workflow-card spaced">
            <span className="data-label">Workflow prompt</span>
            <h3>{profile.workflow.id}</h3>
            <p>{profile.workflow.prompt}</p>
          </section>
          <div className="detail-grid spaced">
            <div>
              <dt>Model</dt>
              <dd>{listing.model}</dd>
            </div>
            <div>
              <dt>Harness</dt>
              <dd>{harnessLabels[harness]}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{profile.scope}</dd>
            </div>
            <div>
              <dt>Included</dt>
              <dd>
                {Object.values(profile.resources).reduce(
                  (total, paths) => total + paths.length,
                  0,
                )}{" "}
                resources · {profile.files.length} files
              </dd>
            </div>
            {profile.schemaVersion === 2 && profile.mcpServerNames?.length ? (
              <div>
                <dt>MCP servers</dt>
                <dd>{profile.mcpServerNames.join(", ")}</dd>
              </div>
            ) : null}
          </div>
          {legacyBlocked && (
            <p className="notice spaced">This older revision cannot be downloaded because it contains MCP connection details. Ask the publisher to recapture and publish a names-only revision.</p>
          )}
          {!legacyBlocked && <section className="setup-use-guide" aria-labelledby="setup-use-title">
            <header>
              <div>
                <span className="data-label">Local, explicit activation</span>
                <h3 id="setup-use-title">Add and use this revision</h3>
              </div>
              <span className="badge green">Default config stays untouched</span>
            </header>
            <div className="setup-behavior">
              <strong>What happens</strong>
              <p>
                Pulling saves this exact revision under a local Loadout alias;
                it does not activate or install anything. Inspecting is also
                read-only. {harness === "pi" ? (
                  <>
                    Running creates a temporary, isolated Pi configuration,
                    loads the resources shown below, and applies the workflow to
                    the frozen packet you choose.
                  </>
                ) : (
                  <>
                    Materializing writes a new configuration directory and
                    refuses to overwrite an existing one. The setup affects only
                    the {harnessLabels[harness]} process launched with that
                    directory.
                  </>
                )}{" "}
                Authentication and machine-local secrets are not included.
              </p>
              {profile.schemaVersion === 2 &&
                (profile.resources.hooks.length > 0 ||
                  Boolean(profile.settings.hooks)) && (
                  <p className="setup-hook-warning">
                    This revision includes hooks. They are inert in this preview
                    but may execute when the native harness runs, so review them
                    before activation.
                  </p>
                )}
            </div>
            <ol className="setup-use-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Add the pinned revision</strong>
                  <p>Download it to your local Loadout store under a new alias.</p>
                  <pre>{pullCommand}</pre>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Inspect before activation</strong>
                  <p>Review settings, requirements, and resolved bundle paths.</p>
                  <pre>{inspectCommand}</pre>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>
                    {harness === "pi"
                      ? "Run with your frozen packet"
                      : `Create and launch an isolated ${harnessLabels[harness]} config`}
                  </strong>
                  <p>
                    {harness === "pi"
                      ? "Set PACKET to the local frozen review packet this workflow should inspect."
                      : `SETUP_DIR is a suggested destination under your home directory. Change it if you prefer; it must not already exist. The final command selects this setup for one ${harnessLabels[harness]} process.`}
                  </p>
                  <pre>{activationCommand}</pre>
                </div>
              </li>
            </ol>
            <div className="setup-use-actions">
              <Copy text={commands} label="Copy all setup commands" />
              <small>
                If your configured remote alias differs from {data.team.teamName},
                replace it in the pull command.
              </small>
            </div>
          </section>}
          {!legacyBlocked && <button
            className="button primary spaced"
            onClick={() =>
              go(
                `/comparisons?new=1&candidate=${encodeURIComponent(refKey(listing))}`,
              )
            }
          >
            Compare with mine <ArrowRight size={16} />
          </button>}
          <h3 className="section-title">Requirements before use</h3>
          <p className="muted">
            Use {harnessLabels[harness]} with your own local authentication.
            Check executable resources and project policy. Captured version is
            not a portability guarantee.
          </p>
          {requirements.length ? (
            <ul>
              {requirements.map((requirement, index) => (
                <li key={index}>{requirement}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No additional requirements declared.</p>
          )}
          <h3 className="section-title">Pinned skills</h3>
          {profile.skillPins?.length ? (
            profile.skillPins.map((pin) => (
              <p key={pin.name}>
                {pin.name} <code>{short(pin.revision)}</code> · {pin.description}
              </p>
            ))
          ) : (
            <p className="muted">No standalone skill revisions pinned.</p>
          )}
          {previous ? (
            <SetupDiff baseline={previous} candidate={listing} />
          ) : !legacyBlocked ? (
            <FileBrowser
              kind="profile"
              listing={listing}
              files={profile.files}
              categories={setupFileCategories(profile)}
              pathExplanation={
                harness === "pi" ? (
                  <>
                    Labels such as <code>global/</code> record where the
                    publisher captured a file. Loadout reconstructs them inside
                    a temporary run directory and loads the declared resources
                    from there; it does not write these paths into your normal Pi
                    configuration.
                  </>
                ) : (
                  <>
                    Prefixes such as <code>global/</code>,{" "}
                    <code>project/</code>, and <code>shared-skills/</code> record
                    source layers inside this immutable revision. When you
                    materialize it, Loadout maps them into the new SETUP_DIR you
                    chose—for example, bundled skills become{" "}
                    <code>skills/&lt;name&gt;</code>. Your default configuration is
                    not modified.
                  </>
                )
              }
            />
          ) : null}
          <details className="spaced">
            <summary>Native settings and workflow</summary>
            <pre>
              {JSON.stringify(
                {
                  settings: profile.settings,
                  ...(profile.schemaVersion === 2 ? { mcpServerNames: profile.mcpServerNames ?? [] } : {}),
                  workflow: profile.workflow,
                  resources: profile.resources,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <details className="spaced">
            <summary>Omitted settings ({profile.omittedSettings.length})</summary>
            <p>{profile.omittedSettings.join(", ") || "None"}</p>
          </details>
          {harness !== "pi" && !legacyBlocked && (
            <details className="spaced">
              <summary>Record observations for this native setup</summary>
              <p className="muted">
                Start{" "}
                <code>
                  loadout telemetry listen {alias} --scope {data.team.scope}
                </code>
                , launch the isolated configuration, then stop the collector and
                run team sync.
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
  return presentation === "drawer" ? (
    <Modal
      title={`${listing.owner} / ${listing.name}`}
      close={close}
      variant="drawer"
    >
      {detail}
    </Modal>
  ) : (
    detail
  );
}

export function SetupPage({
  reference,
  data,
  refresh,
  user,
}: LibraryProps & { reference: ArtifactRef }) {
  const current = data.profiles.find(
    (listing) => refKey(listing) === refKey(reference),
  );
  const [listing, setListing] = useState<ProfileListing | null>(current ?? null);
  const [error, setError] = useState("");
  const returnTo =
    typeof history.state?.returnTo === "string" &&
    /^\/setups(?:\?|$)/.test(history.state.returnTo)
      ? history.state.returnTo
      : "/setups";
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    setListing(current ?? null);
    if (!current)
      api(
        `/artifacts/profile/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.name)}/history`,
      )
        .then((response) => {
          if (!live) return;
          const found = response.history.find(
            (candidate: ProfileListing) =>
              candidate.revision === reference.revision,
          );
          if (found) setListing(found);
          else setError("This setup revision could not be found.");
        })
        .catch((caught) => {
          if (live) setError(caught.message);
        });
    return () => {
      live = false;
    };
  }, [refKey(reference), Boolean(current), attempt]);
  return (
    <section className="setup-detail-page" aria-label="Setup revision details">
      <div className="setup-detail-page-navigation">
        <a
          className="text-button"
          href="/setups"
          onClick={(event) => {
            event.preventDefault();
            go(returnTo);
          }}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to shared setups
        </a>
      </div>
      {listing ? (
        <SetupDetail
          key={refKey(listing)}
          listing={listing}
          data={data}
          user={user}
          refresh={refresh}
          close={() => go(returnTo)}
          presentation="page"
        />
      ) : error ? (
        <div className="panel setup-detail-state">
          <ErrorBox error={error} />
          <button
            className="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="panel loading">Loading setup revision…</div>
      )}
    </section>
  );
}

export function Skills({ data, refresh, user }: LibraryProps) {
  const [query, setQuery] = useParam("search");
  const [harness, setHarness] = useParam("catalog-harness");
  const { chosen, setChosen, selectionError } = useArtifactSelection(
    "skill",
    data.skills,
  );
  const [publish, setPublish] = useState(false);
  const list = data.skills.filter(
    (s) =>
      (!harness || s.compatibleWith.includes(harness as Harness)) &&
      `${s.name} ${s.owner} ${s.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <ErrorBox error={selectionError} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              Shared skill library{" "}
              <span className="badge">{data.skills.length}</span>
            </h2>
            <p>
              Borrow reusable instructions and supporting files without
              replacing your setup.
            </p>
          </div>
          <button className="button primary" onClick={() => setPublish(true)}>
            <Plus size={15} />
            Share a skill
          </button>
        </div>
        <div className="search-row library-filters">
          <div className="search-field">
            <Search size={16} />
            <input
              className="search"
              type="search"
              aria-label="Search shared skills"
              placeholder="Search skills, owners, or descriptions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <HarnessSelect value={harness} onChange={setHarness} />
        </div>
        {list.length ? (
          <ul className="skill-grid">
            {list.map((skill) => (
              <li key={refKey(skill)}>
                <button
                  type="button"
                  className="skill-card"
                  onClick={() => setChosen(skill)}
                  aria-label={`Preview and install ${skill.name} by ${skill.owner}`}
                >
                  <span className="skill-card-heading">
                    <Code2 size={22} aria-hidden="true" />
                    <code>{short(skill.revision)}</code>
                  </span>
                  <span className="skill-card-title">{skill.name}</span>
                  <span className="text-small muted">by {skill.owner}</span>
                  <span className="skill-description">{skill.description}</span>
                  <span className="tag-list">
                    {skill.compatibleWith.map((compatibleHarness) => (
                      <span className="badge" key={compatibleHarness}>
                        <HarnessLabel harness={compatibleHarness} />
                      </span>
                    ))}
                  </span>
                  <span className="skill-card-footer">
                    <span className="text-small muted">
                      {
                        data.profiles.filter((profile) =>
                          profile.skillPins?.some(
                            (pin) => pin.revision === skill.revision,
                          ),
                        ).length
                      }{" "}
                      setups · {skill.files} files
                    </span>
                    <span className="text-button">
                      Preview and install <ArrowRight size={14} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No matching skills">
            Share a reusable skill or adjust the filters.
          </Empty>
        )}
      </section>
      <Unavailable kind="skill" />
      {chosen && (
        <SkillDetail
          key={refKey(chosen)}
          listing={chosen}
          data={data}
          user={user}
          refresh={refresh}
          close={() => setChosen(null)}
        />
      )}
      {publish && (
        <Publish
          kind="skill"
          team={data.team}
          close={() => setPublish(false)}
        />
      )}
    </>
  );
}
function SkillDetail({
  listing,
  data,
  refresh,
  user,
  close,
}: LibraryProps & { listing: SkillListing; close: () => void }) {
  const [detail, setDetail] = useState<{
    skill: Preview<Skill>;
    instructions: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [harness, setHarness] = useState<Harness>(listing.compatibleWith[0]);
  const [activity, setActivity] = useState<{
    summary: AnalyticsSummary;
    feedback: { value: string; count: number }[];
  } | null>(null);
  const [previous, setPrevious] = useState<{
    owner: string;
    name: string;
    revision: string;
  } | null>(null);
  const endpoint = `/skills/${encodeURIComponent(listing.owner)}/${encodeURIComponent(listing.name)}/${listing.revision}`;
  useEffect(() => {
    let live = true;
    api(endpoint)
      .then((r) => {
        if (live) setDetail(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    api(`${endpoint}/activity?days=${data.days}&mode=${data.mode}`)
      .then((r) => {
        if (live) setActivity(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [endpoint, data.days, data.mode]);
  const alias = `skill-${short(listing.revision)}`;
  const command = `loadout team pull-skill ${data.team.teamName} ${listing.owner}/${listing.name} --scope ${data.team.scope} --revision ${listing.revision} --as ${alias}\nloadout skill inspect ${alias} --scope ${data.team.scope}\nloadout skill install ${alias} --scope ${data.team.scope} --harness ${harness} --project .`;
  const installPath =
    harness === "pi"
      ? `.pi/skills/${listing.name}`
      : harness === "claude-code"
        ? `.claude/skills/${listing.name}`
        : `.agents/skills/${listing.name}`;
  const installTargets = Object.keys(harnessLabels) as Harness[];
  return (
    <Modal title={listing.name} close={close} wide>
      <div className="modal-body skill-preview-body">
        <div className="skill-preview-summary">
          <div className="tag-list">
            <span className="badge green">Pinned revision</span>
            {listing.compatibleWith.map((compatibleHarness) => (
              <span className="badge" key={compatibleHarness}>
                <HarnessLabel harness={compatibleHarness} />
              </span>
            ))}
          </div>
          <p>{listing.description}</p>
          <span className="skill-preview-meta">
            Published by <strong>{listing.owner}</strong> · {listing.files}{" "}
            {listing.files === 1 ? "file" : "files"} · revision{" "}
            <code>{short(listing.revision)}</code>
          </span>
        </div>
        <ErrorBox error={error} />
        <ArtifactControls
          kind="skill"
          listing={listing}
          canWithdraw={user.role === "admin" || user.actorId === listing.owner}
          refresh={refresh}
          close={close}
          onCompareRevision={setPrevious}
          comparing={Boolean(previous)}
        />
        {detail && (
          <>
            <section className="skill-install-panel" aria-labelledby="install-skill-title">
              <div className="skill-install-heading">
                <div>
                  <h3 id="install-skill-title">Install this skill</h3>
                  <p>
                    Choose a harness, then copy the commands into the target
                    project. The complete package is installed together and an
                    existing skill folder is never overwritten.
                  </p>
                </div>
                <Copy
                  text={command}
                  label={`Copy ${harnessLabels[harness]} install commands`}
                  primary
                />
              </div>
              <div
                className="skill-install-targets"
                role="group"
                aria-label="Install skill for harness"
              >
                {installTargets.map((target) => {
                  const compatible = listing.compatibleWith.includes(target);
                  return (
                    <button
                      type="button"
                      key={target}
                      disabled={!compatible}
                      aria-pressed={harness === target}
                      title={
                        compatible
                          ? `Install for ${harnessLabels[target]}`
                          : `Publisher has not declared ${harnessLabels[target]} compatibility`
                      }
                      onClick={() => setHarness(target)}
                    >
                      <HarnessIcon harness={target} size={20} />
                      <span>{harnessLabels[target]}</span>
                    </button>
                  );
                })}
              </div>
              <p className="skill-install-destination">
                Installs into <code>{installPath}</code> in the current project.
              </p>
              {listing.requirements.length > 0 && (
                <ul className="skill-requirements">
                  {listing.requirements.map((requirement, index) => (
                    <li key={index}>{requirement}</li>
                  ))}
                </ul>
              )}
              <pre>{command}</pre>
            </section>
            <SkillPackagePreview
              listing={listing}
              files={detail.skill.files}
              before={previous}
            />
            <details className="spaced">
              <summary>Pin this skill to a saved setup</summary>
              <pre>{`loadout setup add-skill YOUR_SETUP ${alias} --scope ${data.team.scope}`}</pre>
              <p>
                Publish the resulting setup revision when you choose to share
                the change.
              </p>
            </details>
            <details className="spaced skill-activity-details">
              <summary>Activity and team feedback</summary>
              <h3>Activity referencing this revision</h3>
              <p className="text-small muted">
                All harnesses · {data.mode} activity · last {data.days} days.
                References do not prove the skill was used or verified.
              </p>
              {activity?.summary.harnesses.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Harness</th>
                        <th>Observations</th>
                        <th>Known estimated spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.summary.harnesses.map((entry) => (
                        <tr key={entry.harness}>
                          <td>
                            <HarnessLabel harness={entry.harness as Harness} />
                          </td>
                          <td>{entry.runs}</td>
                          <td>
                            {money(entry.spend)}
                            {entry.runs > entry.pricedRuns && (
                              <span className="table-sub">
                                {entry.runs - entry.pricedRuns} without pricing
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">No observations in this period.</p>
              )}
              <h3>Team feedback</h3>
              <p className="muted">
                Share a usefulness signal after trying it; task content stays
                local.
              </p>
              <div className="row-actions">
                {["useful", "needs-local-setup"].map((value) => (
                  <button
                    className="button secondary"
                    key={value}
                    onClick={async () => {
                      try {
                        const response = await api("/skills/feedback", {
                          owner: listing.owner,
                          name: listing.name,
                          revision: listing.revision,
                          value,
                        });
                        setActivity((old) =>
                          old
                            ? { ...old, feedback: response.feedback }
                            : old,
                        );
                      } catch (caught) {
                        setError((caught as Error).message);
                      }
                    }}
                  >
                    {value === "useful" ? "Useful" : "Needs local setup"} ·{" "}
                    {activity?.feedback.find(
                      (entry) => entry.value === value,
                    )?.count ?? 0}
                  </button>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}
