import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Code2,
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
  SetupDiff,
  useArtifactSelection,
  refKey,
} from "./Artifacts";
import { go, useParam, artifactUrl } from "./navigation";
import type { AnalyticsSummary } from "../src/analytics";

type Preview<T extends { files: { data: string }[] }> = Omit<T, "files"> & {
  files: Omit<T["files"][number], "data">[];
};
type SetupPreview = Preview<Profile> | Preview<NativeSetup>;
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
  const [publish, setPublish] = useState(false);
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
          <div>
            <span className="section-kicker">Configuration registry</span>
            <p>Inspect a revision. Try it locally. Keep what works.</p>
          </div>
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
          <div className="setup-list" role="list">
            {list.map((p) => (
              <article className="setup-entry" role="listitem" key={refKey(p)}>
                <div className="harness-stamp">
                  <HarnessIcon harness={p.harness?.kind ?? "pi"} size={30} />
                </div>
                <div className="setup-main">
                  <span className="data-label">
                    {harnessLabels[p.harness?.kind ?? "pi"]} / {p.workflowId}
                  </span>
                  <button className="setup-title" onClick={() => setChosen(p)}>
                    {p.name}
                  </button>
                  {p.description && (
                    <p className="setup-purpose">{p.description}</p>
                  )}
                  <div className="setup-meta">
                    <span>{p.model}</span>
                    <code title={p.revision}>rev {short(p.revision)}</code>
                  </div>
                </div>
                <div className="setup-owner">
                  <span className="data-label">Publisher</span>
                  <strong>{p.owner}</strong>
                  <small>{date(p.publishedAt)}</small>
                </div>
                <div className="setup-resource-count">
                  <strong>{String(p.skills).padStart(2, "0")}</strong>
                  <span>{p.skills === 1 ? "skill" : "skills"}</span>
                </div>
                <button
                  className="setup-open"
                  aria-label={`Inspect ${p.name}`}
                  onClick={() => setChosen(p)}
                >
                  <ArrowRight size={20} />
                </button>
              </article>
            ))}
          </div>
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
}: LibraryProps & { listing: ProfileListing; close: () => void }) {
  const [profile, setProfile] = useState<SetupPreview | null>(null);
  const [error, setError] = useState("");
  const [previous, setPrevious] = useState<{
    owner: string;
    name: string;
    revision: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    api(
      `/setups/${encodeURIComponent(listing.owner)}/${encodeURIComponent(listing.name)}/${listing.revision}`,
    )
      .then((r) => {
        if (live) setProfile(r.profile);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refKey(listing)]);
  const harness = listing.harness?.kind ?? "pi";
  const alias = `setup-${short(listing.revision)}`;
  const commands = `loadout team pull ${data.team.teamName} ${listing.owner}/${listing.name} --scope ${data.team.scope} --revision ${listing.revision} --as ${alias}\nloadout setup inspect ${alias} --scope ${data.team.scope}\n${harness === "pi" ? `loadout run ${alias} --scope ${data.team.scope} --packet /path/to/frozen-review` : `loadout setup materialize ${alias} --scope ${data.team.scope} --out /path/to/new-config-directory`}`;
  return (
    <Modal
      title={`${listing.owner} / ${listing.name}`}
      close={close}
      variant="drawer"
    >
      <div className="modal-body">
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
        <ErrorBox error={error} />
        <ArtifactControls
          kind="profile"
          listing={listing}
          canWithdraw={user.role === "admin" || user.actorId === listing.owner}
          refresh={refresh}
          close={close}
          onCompareRevision={setPrevious}
          comparing={Boolean(previous)}
        />
        {profile && (
          <>
            <p className="setup-description spaced">
              {profile.workflow.prompt}
            </p>
            <div className="detail-grid spaced">
              <div>
                <dt>Model</dt>
                <dd>{listing.model}</dd>
              </div>
              <div>
                <dt>Workflow</dt>
                <dd>{profile.workflow.id}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{profile.scope}</dd>
              </div>
              <div>
                <dt>Resources</dt>
                <dd>{profile.files.length} files</dd>
              </div>
            </div>
            <button
              className="button primary spaced"
              onClick={() =>
                go(
                  `/comparisons?new=1&candidate=${encodeURIComponent(refKey(listing))}`,
                )
              }
            >
              Compare with mine <ArrowRight size={16} />
            </button>
            <h3 className="section-title">Requirements before use</h3>
            <p className="muted">
              Use {harnessLabels[harness]} with your own local authentication.
              Check executable resources, paths, and project policy. Captured
              version is not a portability guarantee.
            </p>
            <ul>
              {[
                ...profile.requirements,
                ...(profile.skillPins ?? []).flatMap((p) =>
                  p.requirements.map((r) => `${p.name}: ${r}`),
                ),
              ].map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <h3 className="section-title">Pinned skills</h3>
            {profile.skillPins?.length ? (
              profile.skillPins.map((p) => (
                <p key={p.name}>
                  {p.name} <code>{short(p.revision)}</code> · {p.description}
                </p>
              ))
            ) : (
              <p className="muted">No standalone skill revisions pinned.</p>
            )}
            {previous ? (
              <SetupDiff baseline={previous} candidate={listing} />
            ) : (
              <FileBrowser
                kind="profile"
                listing={listing}
                files={profile.files}
              />
            )}
            <details className="spaced">
              <summary>Native settings and workflow</summary>
              <pre>
                {JSON.stringify(
                  {
                    settings: profile.settings,
                    workflow: profile.workflow,
                    resources: profile.resources,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            <details className="spaced">
              <summary>
                Omitted settings ({profile.omittedSettings.length})
              </summary>
              <p>{profile.omittedSettings.join(", ") || "None"}</p>
            </details>
            <details className="spaced">
              <summary>Try this revision without a comparison</summary>
              <p className="muted">
                Use your configured remote alias if it differs from{" "}
                {data.team.teamName}. Inspect first, then choose a new local
                destination.
              </p>
              <pre>{commands}</pre>
              <Copy text={commands} label="Copy setup commands" />
              {harness !== "pi" && (
                <p className="muted spaced">
                  Materialization prints the native launch command. To record
                  observations, start{" "}
                  <code>
                    loadout telemetry listen {alias} --scope {data.team.scope}
                  </code>
                  , use the selected configuration directory in the printed
                  launch environment, then stop the collector and run team sync.
                </p>
              )}
            </details>
          </>
        )}
      </div>
    </Modal>
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
          <div className="skill-grid">
            {list.map((s) => (
              <article className="skill-card" key={refKey(s)}>
                <div className="skill-card-heading">
                  <Code2 size={22} />
                  <code>{short(s.revision)}</code>
                </div>
                <h3>{s.name}</h3>
                <span className="text-small muted">by {s.owner}</span>
                <p className="skill-description">{s.description}</p>
                <div className="tag-list">
                  {s.compatibleWith.map((h) => (
                    <span className="badge" key={h}>
                      <HarnessLabel harness={h} />
                    </span>
                  ))}
                </div>
                <div className="skill-card-footer">
                  <span className="text-small muted">
                    {
                      data.profiles.filter((p) =>
                        p.skillPins?.some((pin) => pin.revision === s.revision),
                      ).length
                    }{" "}
                    setups · {s.files} files
                  </span>
                  <button className="text-button" onClick={() => setChosen(s)}>
                    Use this skill <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
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
  return (
    <Modal
      title={`${listing.owner} / ${listing.name}`}
      close={close}
      variant="drawer"
    >
      <div className="modal-body">
        <div className="tag-list">
          <span className="badge green">Pinned skill</span>
          <code>{short(listing.revision)}</code>
        </div>
        <p className="spaced">{listing.description}</p>
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
            <h3 className="section-title">Compatibility and requirements</h3>
            <p className="muted">
              Compatibility is publisher-declared. Resolve native tool
              dependencies locally.
            </p>
            <ul>
              {listing.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <FileBrowser
              kind="skill"
              listing={listing}
              files={detail.skill.files}
              before={previous}
            />
            <h3 className="section-title">Use this skill</h3>
            <Field label="Install for">
              <HarnessSelect
                label="Install skill for harness"
                value={harness}
                onChange={(h) => setHarness(h as Harness)}
                allowed={listing.compatibleWith}
                all={false}
              />
            </Field>
            <p className="text-small muted">
              Run in the target project with your configured remote alias.
              Existing skill folders are never overwritten.
            </p>
            <pre>{command}</pre>
            <Copy text={command} label="Copy install commands" />
            <details className="spaced">
              <summary>Pin this skill to a saved setup</summary>
              <pre>{`loadout setup add-skill YOUR_SETUP ${alias} --scope ${data.team.scope}`}</pre>
              <p>
                Publish the resulting setup revision when you choose to share
                the change.
              </p>
            </details>
            <h3 className="section-title">
              Activity referencing this revision
            </h3>
            <p className="text-small muted">
              All harnesses · {data.mode} activity · last {data.days} days.
              Library compatibility filters do not restrict this history.
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
                    {activity.summary.harnesses.map((h) => (
                      <tr key={h.harness}>
                        <td>
                          <HarnessLabel harness={h.harness as Harness} />
                        </td>
                        <td>{h.runs}</td>
                        <td>
                          {money(h.spend)}
                          {h.runs > h.pricedRuns && (
                            <span className="table-sub">
                              {h.runs - h.pricedRuns} without pricing
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
            <p className="text-small muted spaced">
              References do not prove a skill was used or that its installed
              version was verified. Usage does not establish quality.
            </p>
            <h3 className="section-title">Team feedback</h3>
            <p className="muted">
              Share a simple usefulness signal after trying it; task content
              stays local.
            </p>
            <div className="row-actions">
              {["useful", "needs-local-setup"].map((value) => (
                <button
                  className="button secondary"
                  key={value}
                  onClick={async () => {
                    try {
                      const r = await api("/skills/feedback", {
                        owner: listing.owner,
                        name: listing.name,
                        revision: listing.revision,
                        value,
                      });
                      setActivity((old) =>
                        old ? { ...old, feedback: r.feedback } : old,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {value === "useful" ? "Useful" : "Needs local setup"} ·{" "}
                  {activity?.feedback.find((f) => f.value === value)?.count ??
                    0}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
