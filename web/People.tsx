import {
  BriefcaseBusiness,
  Pencil,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { PublicPerson, WebUser } from "../src/web-auth";
import { api, ErrorBox, Field } from "./shared";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ProfileEditor({
  person,
  teams,
  close,
  saved,
}: {
  person: PublicPerson;
  teams: string[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      await api("/profile", {
        jobTitle: String(values.get("jobTitle") ?? ""),
        companyTeam: String(values.get("companyTeam") ?? ""),
      });
      await saved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel profile-editor" aria-labelledby="profile-title">
      <div className="panel-heading">
        <div>
          <h2 id="profile-title">Your directory profile</h2>
          <p>
            Help teammates find you. Both fields are optional and visible to
            signed-in workspace members.
          </p>
        </div>
      </div>
      <form className="profile-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Job title" hint="Use the title people know you by.">
            <input
              name="jobTitle"
              defaultValue={person.jobTitle ?? ""}
              maxLength={100}
              placeholder="e.g. Staff engineer"
              autoComplete="organization-title"
            />
          </Field>
          <Field
            label="Company team"
            hint="Choose an existing team when possible to keep filtering consistent."
          >
            <input
              name="companyTeam"
              defaultValue={person.companyTeam ?? ""}
              list="company-team-options"
              maxLength={100}
              placeholder="e.g. Platform"
              autoComplete="off"
            />
            <datalist id="company-team-options">
              {teams.map((team) => (
                <option key={team} value={team} />
              ))}
            </datalist>
          </Field>
        </div>
        <ErrorBox error={error} />
        <div className="profile-actions">
          <button className="button" type="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function People({ user }: { user: WebUser }) {
  const [people, setPeople] = useState<PublicPerson[] | null>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    setError("");
    const result = await api("/people");
    setPeople(result.people);
    setTeams(result.teams);
  };
  useEffect(() => {
    reload().catch((caught) => setError(caught.message));
  }, []);

  const filtered = useMemo(() => {
    if (!people) return [];
    const needle = query.trim().toLocaleLowerCase();
    return people.filter((person) => {
      if (team && person.companyTeam !== team) return false;
      if (!needle) return true;
      return [
        person.name,
        person.actorId,
        person.jobTitle ?? "",
        person.companyTeam ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [people, query, team]);

  const self = people?.find((person) => person.actorId === user.actorId);
  const profileIncomplete = self && (!self.jobTitle || !self.companyTeam);

  if (!people)
    return (
      <>
        <ErrorBox error={error} />
        <div className="panel loading people-loading">
          <p>{error ? "People unavailable." : "Loading people…"}</p>
          {error && (
            <button
              className="button"
              onClick={() =>
                reload().catch((caught) => setError(caught.message))
              }
            >
              Retry
            </button>
          )}
        </div>
      </>
    );

  return (
    <>
      <ErrorBox error={error} />
      {profileIncomplete && !editing && (
        <section className="profile-prompt" aria-label="Profile incomplete">
          <div>
            <strong>Help teammates find you</strong>
            <p>
              Add your job title and company team. You can leave either field
              blank and update them whenever your role changes.
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            Complete profile
          </button>
        </section>
      )}
      {editing && self && (
        <ProfileEditor
          person={self}
          teams={teams}
          close={() => setEditing(false)}
          saved={async () => {
            await reload();
            setEditing(false);
            setSaved(true);
          }}
        />
      )}
      {saved && (
        <p className="success directory-success" role="status">
          Your profile is updated.
        </p>
      )}
      <section
        className="panel people-directory"
        aria-labelledby="directory-title"
      >
        <div className="panel-heading">
          <div>
            <h2 id="directory-title">
              People <span className="badge">{people.length}</span>
            </h2>
            <p>Search by name, handle, job title, or company team.</p>
          </div>
          <button
            className="button"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            <Pencil size={14} aria-hidden="true" />
            Edit my profile
          </button>
        </div>
        <div className="people-controls">
          <label className="people-search">
            <span className="sr-only">Search people</span>
            <Search size={16} aria-hidden="true" />
            <input
              className="search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              autoComplete="off"
            />
          </label>
          <label className="team-filter">
            <span className="sr-only">Filter by company team</span>
            <select
              value={team}
              onChange={(event) => setTeam(event.target.value)}
              aria-label="Filter by company team"
            >
              <option value="">All teams</option>
              {team && !teams.includes(team) && (
                <option value={team}>Unavailable team: {team}</option>
              )}
              {teams.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <span className="directory-count" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "person" : "people"}
          </span>
        </div>
        {filtered.length ? (
          <ul className="people-list">
            {filtered.map((person) => (
              <li className="person-row" key={person.actorId}>
                <span className="person-avatar" aria-hidden="true">
                  {initials(person.name)}
                </span>
                <div className="person-identity">
                  <strong>
                    {person.name}
                    {person.actorId === user.actorId && (
                      <span className="badge">You</span>
                    )}
                  </strong>
                  <code>@{person.actorId}</code>
                </div>
                <div
                  className={
                    person.jobTitle ? "person-detail" : "person-detail missing"
                  }
                >
                  <BriefcaseBusiness size={15} aria-hidden="true" />
                  <span>{person.jobTitle ?? "Job title not added"}</span>
                </div>
                <div
                  className={
                    person.companyTeam
                      ? "person-detail"
                      : "person-detail missing"
                  }
                >
                  <UsersRound size={15} aria-hidden="true" />
                  <span>{person.companyTeam ?? "Team not added"}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty directory-empty">
            <span className="empty-icon">
              <UserRound size={20} aria-hidden="true" />
            </span>
            <h3>No people match these filters</h3>
            <p>Try another name, title, or team.</p>
            <button
              className="button"
              onClick={() => {
                setQuery("");
                setTeam("");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </section>
    </>
  );
}
