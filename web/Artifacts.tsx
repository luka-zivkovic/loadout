import { useEffect, useState } from "react";
import type { ProfileListing, SkillListing } from "../src/team-protocol";
import { api, Copy, date, ErrorBox, Field, Modal, short } from "./shared";
import { useParam, go, artifactUrl } from "./navigation";

type Ref = { owner: string; name: string; revision: string };
export const refKey = (ref: Ref) => `${ref.owner}/${ref.name}/${ref.revision}`;
const base = (kind: string, ref: Ref) =>
  `/artifacts/${kind}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
export function useArtifactSelection<T extends Ref>(
  kind: "profile" | "skill",
  listings: T[],
) {
  const [key, setKey] = useParam(kind === "profile" ? "setup" : "skill");
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
    setChosen: (ref: T | null) => setKey(ref ? refKey(ref) : null),
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
export function FileBrowser({
  kind,
  listing,
  files,
  before,
}: {
  kind: "profile" | "skill";
  listing: Ref;
  files: FileInfo[];
  before?: Ref | null;
}) {
  const [selected, setSelected] = useState(files[0]?.path ?? "");
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
  const removed = !files.some((f) => f.path === selected);
  const added = Boolean(
    beforeFiles && !beforeFiles.some((f) => f.path === selected),
  );
  useEffect(() => {
    setSelected(files[0]?.path ?? "");
  }, [listing.revision]);
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
      <h3 className="section-title">Included contents</h3>
      <p className="text-small muted">
        Plain-text previews. Scripts and hooks are displayed without executing
        them.
      </p>
      <div className="file-browser">
        <div className="file-list" role="group" aria-label="Included files">
          {allFiles.map((f) => (
            <button
              type="button"
              key={f.path}
              className={selected === f.path ? "selected" : ""}
              onClick={() => setSelected(f.path)}
              aria-pressed={selected === f.path}
            >
              <code>{f.path}</code>
              {f.executable && <span className="badge amber">Executable</span>}
              {beforeFiles &&
                !files.some((current) => current.path === f.path) && (
                  <span className="badge red">Removed</span>
                )}
              {beforeFiles &&
                !beforeFiles.some((old) => old.path === f.path) && (
                  <span className="badge green">Added</span>
                )}
            </button>
          ))}
        </div>
        <div className="file-preview">
          <ErrorBox error={error || beforeError} />
          {content ? (
            <>
              <p className="text-small muted">
                {previous ? `${previous.bytes.toLocaleString()} → ` : ""}
                {content.bytes.toLocaleString()} bytes
                {content.truncated || previous?.truncated
                  ? " · First 200 KB shown; inspect the full file locally before use"
                  : ""}
              </p>
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
}: {
  kind: "profile" | "skill";
  listing: Ref;
  canWithdraw: boolean;
  refresh: () => Promise<unknown>;
  close: () => void;
  onCompareRevision?: (ref: Ref | null) => void;
  comparing?: boolean;
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
          text={new URL(artifactUrl(kind, listing), location.origin).href}
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
                onClick={() => go(artifactUrl(kind, p))}
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
