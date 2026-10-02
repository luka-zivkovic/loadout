import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, MessageCircle, Plus, Users } from "lucide-react";
import type { WebUser } from "../src/web-auth";
import { useParam } from "./navigation";
import { api, date, Empty, ErrorBox, Field } from "./shared";

type RequestComment = {
  id: string;
  body: string;
  author: string;
  anonymous: boolean;
  moderatorAuthor?: string;
  mine: boolean;
  createdAt: string;
};
type SkillRequest = {
  id: string;
  title: string;
  body: string;
  author: string;
  anonymous: boolean;
  moderatorAuthor?: string;
  mine: boolean;
  createdAt: string;
  archivedAt: string | null;
  interestCount: number;
  commentCount: number;
  interested: boolean;
  comments?: RequestComment[];
};

function Byline({
  author,
  mine,
  moderatorAuthor,
  createdAt,
  anonymous,
}: Pick<SkillRequest, "author" | "mine" | "moderatorAuthor" | "createdAt" | "anonymous">) {
  return (
    <span className="request-byline">
      {mine && anonymous ? "You · anonymous to teammates" : author}
      {moderatorAuthor && !mine ? ` · ${moderatorAuthor} (admin only)` : ""}
      <span aria-hidden="true"> · </span>
      <time dateTime={createdAt}>{date(createdAt)}</time>
    </span>
  );
}

export function Requests({ user }: { user: WebUser }) {
  const [selectedId, setSelectedId] = useParam("request");
  const [requests, setRequests] = useState<SkillRequest[] | null>(null);
  const [detail, setDetail] = useState<SkillRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const result = await api<{ requests: SkillRequest[] }>("/skill-requests");
    setRequests(result.requests);
    setError("");
  }
  useEffect(() => {
    reload().catch((caught) => setError(caught.message));
  }, []);
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(null);
    setError("");
    api<{ request: SkillRequest }>(`/skill-requests/${encodeURIComponent(selectedId)}`)
      .then((result) => {
        if (active) setDetail(result.request);
      })
      .catch((caught) => {
        if (active) setError(caught.message);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ request: SkillRequest }>("/skill-requests", {
        title: String(values.get("title") ?? ""),
        body: String(values.get("body") ?? ""),
        anonymous: values.get("anonymous") === "on",
      });
      await reload();
      setCreating(false);
      setSelectedId(result.request.id);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function update(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ request: SkillRequest }>(path, body);
      setDetail(result.request);
      await reload();
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const saved = await update(`/skill-requests/${detail.id}/comments`, {
      body: String(values.get("body") ?? ""),
      anonymous: values.get("anonymous") === "on",
    });
    if (saved) form.reset();
  }

  async function archive() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(`/skill-requests/${detail.id}/archive`, {});
      await reload();
      setSelectedId(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function hideComment(commentId: string) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(`/skill-requests/${detail.id}/comments/${commentId}/hide`, {});
      const result = await api<{ request: SkillRequest }>(
        `/skill-requests/${detail.id}`,
      );
      setDetail(result.request);
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (selectedId) {
    return (
      <section className="request-detail">
        <button className="text-button request-back" onClick={() => setSelectedId(null)}>
          <ArrowLeft size={15} /> All skill requests
        </button>
        <ErrorBox error={error} />
        {!detail ? (
          <div className="panel loading">
            {error ? "Request unavailable." : "Loading request…"}
          </div>
        ) : (
          <>
            <article className="panel">
              <div className="request-detail-head">
                <div>
                  <span className="data-label">Skill idea</span>
                  <h2>{detail.title}</h2>
                  <Byline {...detail} />
                </div>
                {detail.archivedAt && <span className="badge">Archived</span>}
              </div>
              <p className="request-body">{detail.body}</p>
              <div className="request-actions">
                <button
                  className={`button${detail.interested ? " primary" : ""}`}
                  disabled={busy || Boolean(detail.archivedAt)}
                  aria-pressed={detail.interested}
                  onClick={() =>
                    update(`/skill-requests/${detail.id}/interest`, {
                      interested: !detail.interested,
                    })
                  }
                >
                  <Users size={16} />
                  {detail.interested ? "I'm interested" : "I'd use this"}
                  <span>{detail.interestCount}</span>
                </button>
                {(detail.mine || user.role === "admin") && !detail.archivedAt && (
                  <button className="text-button request-archive" disabled={busy} onClick={archive}>
                    Archive request
                  </button>
                )}
              </div>
            </article>
            <section className="panel" aria-labelledby="request-discussion-title">
              <div className="panel-heading">
                <div>
                  <h2 id="request-discussion-title">
                    Discussion <span className="badge">{detail.commentCount}</span>
                  </h2>
                  <p>Help shape the idea before someone builds it.</p>
                </div>
              </div>
              {detail.comments?.length ? (
                <ul className="request-comments">
                  {detail.comments.map((entry) => (
                    <li key={entry.id}>
                      <div className="request-comment-head">
                        <Byline {...entry} />
                        {(entry.mine || user.role === "admin") && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => hideComment(entry.id)}
                            aria-label={`Remove comment by ${entry.author}`}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <p>{entry.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="request-no-comments">No discussion yet. Add the first thought.</p>
              )}
              {!detail.archivedAt && (
                <form className="request-comment-form" onSubmit={comment}>
                  <Field label="Add to the discussion">
                    <textarea name="body" required minLength={2} maxLength={2000} placeholder="A use case, constraint, or possible approach…" />
                  </Field>
                  <label className="request-anonymous">
                    <input type="checkbox" name="anonymous" />
                    Hide my name from teammates on this comment
                  </label>
                  <div className="request-form-foot">
                    <small>Admins can identify anonymous authors for moderation.</small>
                    <button className="button primary" disabled={busy}>Post comment</button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="request-board">
      <ErrorBox error={error} />
      {creating ? (
        <section className="panel" aria-labelledby="request-create-title">
          <div className="panel-heading">
            <div>
              <h2 id="request-create-title">Request a skill</h2>
              <p>Describe a repeatable problem that a shared skill could solve.</p>
            </div>
          </div>
          <form className="request-create-form" onSubmit={create}>
            <Field label="What should this skill help with?">
              <input name="title" required minLength={5} maxLength={120} placeholder="e.g. Review database migrations" autoFocus />
            </Field>
            <Field label="What would a useful result look like?" hint="Share the situation and desired outcome. Leave out task code, credentials, and repository paths.">
              <textarea name="body" required minLength={10} maxLength={2000} placeholder="When I… I want the skill to…" />
            </Field>
            <label className="request-anonymous">
              <input type="checkbox" name="anonymous" />
              Hide my name from teammates on this request
            </label>
            <p className="request-privacy">Requests are visible to workspace members. Admins can identify anonymous authors for moderation.</p>
            <div className="request-form-foot">
              <button className="button" type="button" onClick={() => setCreating(false)}>Cancel</button>
              <button className="button primary" disabled={busy}>Post request</button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <section className="request-intro">
            <div>
              <span className="data-label">From idea to shared skill</span>
              <h2>What should we build next?</h2>
              <p>Put a recurring task on the board. Teammates can add context and show that they would use it.</p>
            </div>
            <button className="button primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Request a skill
            </button>
          </section>
          {!requests ? (
            <div className="panel loading">
              {error ? (
                <>
                  <p>Requests unavailable.</p>
                  <button className="button" onClick={() => reload().catch((caught) => setError(caught.message))}>Retry</button>
                </>
              ) : "Loading skill requests…"}
            </div>
          ) : requests.length ? (
            <section className="panel" aria-label="Open skill requests">
              <div className="panel-heading">
                <div>
                  <h2>Open requests <span className="badge">{requests.length}</span></h2>
                  <p>Most recent first</p>
                </div>
              </div>
              <ul className="request-list">
                {requests.map((request) => (
                  <li key={request.id}>
                    <button className="request-list-link" onClick={() => setSelectedId(request.id)}>
                      <span className="request-list-main">
                        <strong>{request.title}</strong>
                        <span className="request-excerpt">{request.body}</span>
                        <Byline {...request} />
                      </span>
                      <span className="request-list-meta">
                        <span><Users size={15} /> {request.interestCount} interested</span>
                        <span><MessageCircle size={15} /> {request.commentCount} comments</span>
                      </span>
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="panel">
              <Empty title="No skill requests yet" action={
                <button className="button primary" onClick={() => setCreating(true)}>
                  <Plus size={15} /> Request the first skill
                </button>
              }>
                Start with a task your team repeats or a skill you wish existed.
              </Empty>
            </section>
          )}
        </>
      )}
    </section>
  );
}
