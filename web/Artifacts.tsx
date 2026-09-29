import { Code2, Eye, Info, Search } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ProfileListing, SkillListing } from "../src/team-protocol";
import { api, Copy, date, ErrorBox, Modal, short } from "./shared";
import { useParam, go, artifactUrl, setParam } from "./navigation";

type Ref = { owner: string; name: string; revision: string };
export const refKey = (ref: Ref) => `${ref.owner}/${ref.name}/${ref.revision}`;
const base = (kind: string, ref: Ref) =>
  `/artifacts/${kind}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
export function useArtifactSelection<T extends Ref>(
  kind: "profile" | "skill",
  listings: T[],
) {
  const parameter = kind === "profile" ? "setup" : "skill";
  const [key, setKey] = useParam(parameter);
  const [loaded, setLoaded] = useState<T | null>(null);
  const [error, setError] = useState("");
  const current = listings.find((p) => refKey(p) === key);
  useEffect(() => {
    setError("");
    setLoaded(null);
    if (!key || current) return;
    const [owner, name, revision, extra] = key.split("/");
    if (!owner || !name || !revision || extra) {
      setError("Invalid revision link.");
      return;
    }
    let live = true;
    api(`${base(kind, { owner, name, revision })}/history`)
      .then((r) => {
        if (!live) return;
        const found = r.history.find((p: T) => refKey(p) === key);
        if (found) setLoaded(found);
        else setError("This revision could not be found.");
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [key, Boolean(current)]);
  return {
    chosen: key
      ? (current ?? (loaded && refKey(loaded) === key ? loaded : null))
      : null,
    setChosen: (ref: T | null) =>
      ref ? setKey(refKey(ref)) : setParam(parameter, null, true),
    selectionError: error,
  };
}
export function LineDiff({ before, after }: { before: string; after: string }) {
  if (before === after) return <p className="muted">No content changes.</p>;
  const a = before.split("\n").slice(0, 500),
    b = after.split("\n").slice(0, 500);
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: { type: string; text: string }[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ type: " ", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1]))
      rows.push({ type: "−", text: a[i++] });
    else rows.push({ type: "+", text: b[j++] });
  }
  return (
    <>
      <p className="text-small muted">
        − Before · + After
        {before.split("\n").length > 500 || after.split("\n").length > 500
          ? " · Preview limited to the first 500 lines of each file"
          : ""}
      </p>
      <pre className="line-diff" aria-label="Content changes">
        {rows.map((r, i) => (
          <span
            key={i}
            className={
              r.type === "+" ? "diff-add" : r.type === "−" ? "diff-remove" : ""
            }
          >
            {r.type} {r.text}
            {"\n"}
          </span>
        ))}
      </pre>
    </>
  );
}
type FileInfo = {
  path: string;
  sha256: string;
  executable?: true;
  bytes?: number;
};
type FileContent = {
  path: string;
  bytes: number;
  text: string | null;
  binary: boolean;
  truncated: boolean;
};
export type FileCategory = {
  key: string;
  label: string;
  description: string;
  paths: string[];
};
function fileGroup(path: string) {
  const [root, packageName] = path.split("/");
  if (!root || !path.includes("/")) return "Root";
  if (root === "shared-skills" && packageName)
    return `${root}/${packageName}`;
  return root;
}
function pathContains(root: string, path: string) {
  return path === root || path.startsWith(`${root}/`);
}
function relativeFileLabel(path: string, root: string) {
  if (root === "Root") return path;
  if (!pathContains(root, path))
    return path.replace(/^(global|project)\//, "");
  const name = root.split("/").at(-1) ?? root;
  const suffix = path.slice(root.length + 1);
  const genericRoots = new Set([
    "skills",
    "extensions",
    "hooks",
    "agents",
    "prompts",
  ]);
  if (suffix && genericRoots.has(name)) return suffix;
  return suffix ? `${name}/${suffix}` : name;
}
const ReactMarkdown = lazy(() => import("react-markdown"));
function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="markdown-preview">
      <Suspense fallback={<p className="muted">Formatting preview…</p>}>
        <ReactMarkdown
          skipHtml
          components={{
            a: ({ href, children, title }) => {
              const safe =
                href?.startsWith("#") ||
                /^(https?:|mailto:)/i.test(href ?? "");
              return (
                <a
                  href={safe ? href : undefined}
                  title={title}
                  {...(href && /^(https?:|mailto:)/i.test(href)
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                >
                  {children}
                </a>
              );
            },
            img: ({ alt, title }) => (
              <span className="markdown-image-placeholder" title={title}>
                [Image not loaded{alt ? `: ${alt}` : ""}]
              </span>
            ),
          }}
        >
          {source}
        </ReactMarkdown>
      </Suspense>
    </div>
  );
}
export function FileBrowser({
  kind,
  listing,
  files,
  before,
  categories,
  pathExplanation,
}: {
  kind: "profile" | "skill";
  listing: Ref;
  files: FileInfo[];
  before?: Ref | null;
  categories?: FileCategory[];
  pathExplanation?: ReactNode;
}) {
  const [selected, setSelected] = useState(files[0]?.path ?? "");
  const [query, setQuery] = useState("");
  const [markdownView, setMarkdownView] = useState<"preview" | "source">(
    "preview",
  );
  const [content, setContent] = useState<FileContent | null>(null);
  const [previous, setPrevious] = useState<FileContent | null>(null);
  const [beforeFiles, setBeforeFiles] = useState<FileInfo[] | null>(null);
  const [beforeError, setBeforeError] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setBeforeFiles(null);
    setBeforeError("");
    if (before)
      api(
        `/${kind === "profile" ? "setups" : "skills"}/${encodeURIComponent(before.owner)}/${encodeURIComponent(before.name)}/${before.revision}`,
      )
        .then((r) => {
          if (live) setBeforeFiles(r[kind].files);
        })
        .catch((e) => {
          if (live) setBeforeError(e.message);
        });
    return () => {
      live = false;
    };
  }, [kind, before ? refKey(before) : ""]);
  const allFiles = [
    ...files,
    ...(beforeFiles ?? []).filter(
      (f) => !files.some((current) => current.path === f.path),
    ),
  ];
  const visibleFiles = allFiles.filter((file) =>
    file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const groupedFiles = (() => {
    const groups = new Map<
      string,
      {
        label: string;
        description: string;
        entries: { file: FileInfo; label: string }[];
      }
    >();
    for (const category of categories ?? [])
      groups.set(category.key, {
        label: category.label,
        description: category.description,
        entries: [],
      });
    for (const file of visibleFiles) {
      const category = categories?.find((candidate) =>
        candidate.paths.some((path) => pathContains(path, file.path)),
      );
      const fallback = categories
        ? {
            key: "supporting",
            label: "Supporting files",
            description:
              "Files retained for the resources above or for native configuration.",
            root: file.path.replace(/^(global|project)\//, "").split("/")[0]!,
          }
        : {
            key: fileGroup(file.path),
            label: fileGroup(file.path),
            description: "",
            root: fileGroup(file.path),
          };
      const key = category?.key ?? fallback.key;
      const group = groups.get(key) ?? {
        label: category?.label ?? fallback.label,
        description: category?.description ?? fallback.description,
        entries: [],
      };
      const root = category
        ? [...category.paths]
            .filter((path) => pathContains(path, file.path))
            .sort((a, b) => b.length - a.length)[0]!
        : fallback.root;
      group.entries.push({
        file,
        label: relativeFileLabel(file.path, root),
      });
      groups.set(key, group);
    }
    return [...groups.entries()].filter(([, group]) => group.entries.length);
  })();
  const removed = !files.some((f) => f.path === selected);
  const added = Boolean(
    beforeFiles && !beforeFiles.some((f) => f.path === selected),
  );
  useEffect(() => {
    setSelected(files[0]?.path ?? "");
  }, [listing.revision]);
  useEffect(() => {
    setMarkdownView("preview");
  }, [selected, listing.revision]);
  useEffect(() => {
    let live = true;
    setError("");
    setContent(null);
    setPrevious(null);
    if (!selected || (before && !beforeFiles)) return;
    const empty: FileContent = {
      path: selected,
      bytes: 0,
      text: "",
      binary: false,
      truncated: false,
    };
    const request = (ref: Ref) =>
      api<FileContent>(
        `${base(kind, ref)}/${ref.revision}/file?path=${encodeURIComponent(selected)}`,
      );
    (removed ? Promise.resolve(empty) : request(listing))
      .then((r) => {
        if (live) setContent(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    if (before)
      (added ? Promise.resolve(empty) : request(before))
        .then((r) => {
          if (live) setPrevious(r);
        })
        .catch((e) => {
          if (live) setError(`Earlier file unavailable: ${e.message}`);
        });
    return () => {
      live = false;
    };
  }, [selected, refKey(listing), before ? refKey(before) : "", beforeFiles]);
  return (
    <section className="artifact-files">
      <div className="artifact-files-heading">
        <div>
          <h3 className="section-title">
            Included contents <span className="badge">{allFiles.length}</span>
          </h3>
          <p className="text-small muted">
            {categories
              ? "Grouped by what each file does when this setup is active."
              : "Grouped by bundle folder."}{" "}
            Scripts and hooks are previewed without executing them.
          </p>
        </div>
        <label className="file-filter">
          <span className="sr-only">Filter included files</span>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter files"
            autoComplete="off"
          />
        </label>
      </div>
      {pathExplanation && (
        <aside className="bundle-path-note">
          <Info size={18} aria-hidden="true" />
          <div>
            <strong>Bundle paths, not paths on your computer</strong>
            <p>{pathExplanation}</p>
          </div>
        </aside>
      )}
      <div className="file-browser">
        <div className="file-list" role="group" aria-label="Included files">
          {groupedFiles.map(([key, group]) => (
            <div className="file-group" key={key}>
              <div className="file-group-heading">
                <div>
                  <strong>{group.label}</strong>
                  {group.description && <small>{group.description}</small>}
                </div>
              </div>
              {group.entries.map(({ file, label }) => (
                <button
                  type="button"
                  key={file.path}
                  className={selected === file.path ? "selected" : ""}
                  onClick={() => setSelected(file.path)}
                  aria-pressed={selected === file.path}
                  title={`Bundle path: ${file.path}`}
                >
                  <code>{label}</code>
                  {file.executable && (
                    <span className="badge amber">Executable</span>
                  )}
                  {beforeFiles &&
                    !files.some((current) => current.path === file.path) && (
                      <span className="badge red">Removed</span>
                    )}
                  {beforeFiles &&
                    !beforeFiles.some((old) => old.path === file.path) && (
                      <span className="badge green">Added</span>
                    )}
                </button>
              ))}
            </div>
          ))}
          {!visibleFiles.length && (
            <p className="file-list-empty">No files match this filter.</p>
          )}
        </div>
        <div className="file-preview">
          <ErrorBox error={error || beforeError} />
          {content ? (
            <>
              <div className="file-preview-heading">
                <div>
                  <span className="data-label">Bundle path</span>
                  <code>{selected}</code>
                  <small>
                    {previous ? `${previous.bytes.toLocaleString()} → ` : ""}
                    {content.bytes.toLocaleString()} bytes
                    {content.truncated || previous?.truncated
                      ? " · First 200 KB shown; inspect the full file locally before use"
                      : ""}
                  </small>
                </div>
                {!previous &&
                  !content.binary &&
                  /\.md(?:own)?$/i.test(selected) && (
                    <div
                      className="file-view-toggle"
                      role="group"
                      aria-label="Markdown view"
                    >
                      <button
                        type="button"
                        aria-pressed={markdownView === "preview"}
                        onClick={() => setMarkdownView("preview")}
                      >
                        <Eye size={14} aria-hidden="true" /> Preview
                      </button>
                      <button
                        type="button"
                        aria-pressed={markdownView === "source"}
                        onClick={() => setMarkdownView("source")}
                      >
                        <Code2 size={14} aria-hidden="true" /> Source
                      </button>
                    </div>
                  )}
              </div>
              {content.binary || previous?.binary ? (
                <p>
                  Binary content cannot be previewed as text. Inspect it locally
                  before use.
                </p>
              ) : previous && !previous.binary ? (
                <LineDiff
                  before={previous.text ?? ""}
                  after={content.text ?? ""}
                />
              ) : /\.md(?:own)?$/i.test(selected) &&
                markdownView === "preview" ? (
                <MarkdownPreview source={content.text ?? ""} />
              ) : (
                <pre tabIndex={0}>{content.text}</pre>
              )}
            </>
          ) : error || beforeError ? null : selected ? (
            <p className="muted">Loading file…</p>
          ) : (
            <p className="muted">No bundled files.</p>
          )}
        </div>
      </div>
    </section>
  );
}
export function ArtifactControls({
  kind,
  listing,
  canWithdraw,
  refresh,
  close,
  onCompareRevision,
  comparing = false,
  copyUrl,
  historyUrl,
}: {
  kind: "profile" | "skill";
  listing: Ref;
  canWithdraw: boolean;
  refresh: () => Promise<unknown>;
  close: () => void;
  onCompareRevision?: (ref: Ref | null) => void;
  comparing?: boolean;
  copyUrl?: string;
  historyUrl?: (ref: Ref) => string;
}) {
  const [history, setHistory] = useState<
    ((ProfileListing | SkillListing) & {
      withdrawnAt: string | null;
      blockedSkills: string[];
    })[]
  >([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api(`${base(kind, listing)}/history`)
      .then((r) => {
        if (live) setHistory(r.history);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refKey(listing)]);
  return (
    <>
      <div className="artifact-actions">
        <Copy
          text={
            copyUrl ??
            new URL(artifactUrl(kind, listing), location.origin).href
          }
          label="Copy revision link"
        />
        {canWithdraw &&
          history.some(
            (p) => p.revision === listing.revision && !p.withdrawnAt,
          ) && (
            <button
              type="button"
              className="button danger"
              onClick={() => setConfirm(true)}
            >
              Withdraw revision
            </button>
          )}
      </div>
      <ErrorBox error={error} />
      <details className="spaced">
        <summary>Revision history · {history.length}</summary>
        <div className="history-list">
          {history.map((p) => (
            <div key={p.revision}>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  go(historyUrl ? historyUrl(p) : artifactUrl(kind, p))
                }
              >
                {short(p.revision)}
              </button>
              <span>{date(p.publishedAt)}</span>
              {p.withdrawnAt ? (
                <span className="badge red">Withdrawn</span>
              ) : p.blockedSkills.length ? (
                <span className="badge amber">
                  Blocked: {p.blockedSkills.join(", ")}
                </span>
              ) : (
                <span className="badge">Available</span>
              )}
              {onCompareRevision &&
                p.revision !== listing.revision &&
                !p.withdrawnAt &&
                !p.blockedSkills.length && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onCompareRevision(p)}
                  >
                    Compare contents
                  </button>
                )}
            </div>
          ))}
        </div>
      </details>
      {onCompareRevision && comparing && (
        <button
          type="button"
          className="text-button spaced"
          onClick={() => onCompareRevision(null)}
        >
          Clear revision comparison
        </button>
      )}
      {confirm && (
        <Modal
          title="Withdraw this revision?"
          close={() => setConfirm(false)}
          compact
        >
          <div className="modal-body">
            <p>
              Stop future downloads of{" "}
              <strong>
                {listing.owner}/{listing.name}@{short(listing.revision)}
              </strong>
              .
            </p>
            <p className="muted spaced">
              Setups bundling a withdrawn skill will also be blocked. Copies
              already downloaded remain on those devices. Server content can be
              purged later under the workspace retention policy; backup expiry
              is separate.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => setConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/artifacts/withdraw", {
                      kind,
                      owner: listing.owner,
                      name: listing.name,
                      revision: listing.revision,
                    });
                    await refresh();
                    setConfirm(false);
                    close();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Withdraw revision
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function SetupDiff({
  baseline,
  candidate,
}: {
  baseline: Ref;
  candidate: Ref;
}) {
  const [pair, setPair] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setPair(null);
    setError("");
    Promise.all(
      [baseline, candidate].map((ref) =>
        api(
          `/setups/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/${ref.revision}`,
        ).then((r) => r.profile),
      ),
    )
      .then((r) => {
        if (live) setPair(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refKey(baseline), refKey(candidate)]);
  if (!pair)
    return (
      <>
        <ErrorBox error={error} />
        {!error && <p className="muted">Inspecting setup differences…</p>}
      </>
    );
  const [a, b] = pair;
  const fields = [
    "settings",
    "workflow",
    "resources",
    "requirements",
    "omittedSettings",
    "skillPins",
    "packages",
    "mcpServers",
  ];
  const changedFiles = [
    ...new Set([...a.files, ...b.files].map((f: FileInfo) => f.path)),
  ].filter(
    (path) =>
      a.files.find((f: FileInfo) => f.path === path)?.sha256 !==
        b.files.find((f: FileInfo) => f.path === path)?.sha256 ||
      Boolean(a.files.find((f: FileInfo) => f.path === path)?.executable) !==
        Boolean(b.files.find((f: FileInfo) => f.path === path)?.executable),
  );
  return (
    <div className="setup-diff">
      <h3>What changes</h3>
      <p className="muted">
        {baseline.owner}/{baseline.name} → {candidate.owner}/{candidate.name}
      </p>
      {fields.map((key) =>
        JSON.stringify(a[key]) === JSON.stringify(b[key]) ? null : (
          <details key={key} className="spaced">
            <summary>{key}</summary>
            <LineDiff
              before={JSON.stringify(a[key] ?? null, null, 2)}
              after={JSON.stringify(b[key] ?? null, null, 2)}
            />
          </details>
        ),
      )}
      <p className="spaced">{changedFiles.length} bundled files changed</p>
      <ul>
        {changedFiles.map((path) => (
          <li key={path}>
            <code>{path}</code> ·{" "}
            {!a.files.some((f: FileInfo) => f.path === path)
              ? "added"
              : !b.files.some((f: FileInfo) => f.path === path)
                ? "removed"
                : "modified"}
          </li>
        ))}
      </ul>
      <FileBrowser
        kind="profile"
        listing={candidate}
        files={b.files}
        before={baseline}
      />
    </div>
  );
}
