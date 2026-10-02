import { z } from "zod";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  assessmentSchema,
  setupHarnessSchema,
  hash,
  metricsSchema,
} from "./schema.js";

export function periodFilter(url: URL) {
  const days = z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .parse(url.searchParams.get("days") ?? 30);
  const mode = z
    .enum(["live", "demo"])
    .parse(url.searchParams.get("mode") ?? "live");
  const harness = url.searchParams.get("harness")
    ? setupHarnessSchema.parse(url.searchParams.get("harness"))
    : null;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const clauses = [
    "json_extract(r.body,'$.mode')=?",
    "json_extract(r.body,'$.startedAt')>=?",
    "json_extract(r.body,'$.startedAt')<=?",
  ];
  const params: SQLInputValue[] = [
    mode,
    start.toISOString(),
    new Date().toISOString(),
  ];
  if (harness) {
    clauses.push("COALESCE(json_extract(r.body,'$.harness.kind'),'pi')=?");
    params.push(harness);
  }
  for (const key of ["owner", "workflow", "setup"] as const) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    clauses.push(
      key === "owner"
        ? "r.owner=?"
        : `json_extract(r.body,'$.${key === "workflow" ? "workflowId" : "profileRevision"}')=?`,
    );
    params.push(z.string().max(100).parse(value));
  }
  const skill = url.searchParams.get("skill");
  if (skill) {
    clauses.push(
      "EXISTS(SELECT 1 FROM json_each(r.body,'$.skillPins') pin WHERE json_extract(pin.value,'$.revision')=?)",
    );
    params.push(hash.parse(skill));
  }
  const query = url.searchParams.get("query");
  if (query) {
    clauses.push(
      "instr(lower(json_extract(r.body,'$.profileName') || ' ' || r.owner || ' ' || json_extract(r.body,'$.workflowId') || ' ' || json_extract(r.body,'$.status') || ' ' || COALESCE(json_extract(r.body,'$.harness.kind'),'pi') || ' ' || json_extract(r.body,'$.models') || ' ' || json_extract(r.body,'$.tools') || ' ' || json_extract(r.body,'$.skillCatalog')),lower(?))>0",
    );
    params.push(z.string().max(120).parse(query));
  }
  return { days, mode, harness, where: clauses.join(" AND "), params };
}
export function assessmentsFor(db: DatabaseSync, ids: string[]) {
  if (!ids.length) return [];
  return db
    .prepare(
      `SELECT body FROM assessments WHERE run_id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids)
    .map((r) => assessmentSchema.parse(JSON.parse(String(r.body))));
}
export function activityPage(db: DatabaseSync, url: URL) {
  const f = periodFilter(url);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .parse(url.searchParams.get("offset") ?? 0);
  const found = db
    .prepare(
      `SELECT body FROM runs r WHERE ${f.where} ORDER BY json_extract(body,'$.startedAt') DESC,run_id DESC LIMIT 101 OFFSET ?`,
    )
    .all(...f.params, offset);
  const records = found
    .slice(0, 100)
    .map((row) => metricsSchema.parse(JSON.parse(String(row.body))));
  const total = Number(
    db
      .prepare(`SELECT COUNT(*) AS total FROM runs r WHERE ${f.where}`)
      .get(...f.params)!.total,
  );
  return {
    records,
    assessments: assessmentsFor(
      db,
      records.map((r) => r.runId),
    ),
    total,
    offset,
    nextOffset: found.length > 100 ? offset + 100 : null,
  };
}
const pricedCte = (
  where: string,
) => `WITH selected AS (SELECT body,owner,run_id FROM runs r WHERE ${where}), priced AS (
  SELECT *,CASE WHEN json_array_length(body,'$.models')>0 AND NOT EXISTS(SELECT 1 FROM json_each(body,'$.models') m WHERE json_extract(m.value,'$.estimatedCostUsd') IS NULL OR json_extract(m.value,'$.calls')!=json_extract(m.value,'$.usageCalls'))
    THEN (SELECT SUM(json_extract(m.value,'$.estimatedCostUsd')) FROM json_each(body,'$.models') m) ELSE NULL END AS cost,
    (SELECT COALESCE(SUM(json_extract(t.value,'$.calls')),0) FROM json_each(body,'$.tools') t) AS tool_calls FROM selected)`;
export function analyticsSummary(db: DatabaseSync, url: URL) {
  const f = periodFilter(url);
  const row = db
    .prepare(
      `${pricedCte(f.where)} SELECT COUNT(*) AS runs,COUNT(DISTINCT owner) AS members,COALESCE(SUM(tool_calls),0) AS toolCalls,COUNT(cost) AS pricedRuns,SUM(cost) AS spend,
    COALESCE(SUM(CASE WHEN json_extract(body,'$.coverage.tools')='unavailable' THEN 1 ELSE 0 END),0) AS missingTools,
    COALESCE(SUM(CASE WHEN json_extract(body,'$.coverage.skills')='unavailable' THEN 1 ELSE 0 END),0) AS missingSkills FROM priced`,
    )
    .get(...f.params)!;
  const daily = db
    .prepare(
      `SELECT substr(json_extract(body,'$.startedAt'),1,10) AS day,COUNT(*) AS runs FROM runs r WHERE ${f.where} GROUP BY day ORDER BY day`,
    )
    .all(...f.params)
    .map((r) => ({ day: String(r.day), runs: Number(r.runs) }));
  const tools = db
    .prepare(
      `SELECT COALESCE(json_extract(r.body,'$.harness.kind'),'pi') AS harness,json_extract(t.value,'$.name') AS name,SUM(json_extract(t.value,'$.calls')) AS calls FROM runs r,json_each(r.body,'$.tools') t WHERE ${f.where} GROUP BY harness,name ORDER BY calls DESC LIMIT 20`,
    )
    .all(...f.params)
    .map((r) => ({
      harness: String(r.harness),
      name: String(r.name),
      calls: Number(r.calls),
    }));
  const harnesses = db
    .prepare(
      `${pricedCte(f.where)} SELECT COALESCE(json_extract(body,'$.harness.kind'),'pi') AS harness,COUNT(*) AS runs,COUNT(cost) AS pricedRuns,SUM(cost) AS spend FROM priced GROUP BY harness`,
    )
    .all(...f.params)
    .map((r) => ({
      harness: String(r.harness),
      runs: Number(r.runs),
      pricedRuns: Number(r.pricedRuns),
      spend: r.spend === null ? null : Number(r.spend),
    }));
  return {
    runs: Number(row.runs),
    members: Number(row.members),
    toolCalls: Number(row.toolCalls),
    pricedRuns: Number(row.pricedRuns),
    spend: row.spend === null ? null : Number(row.spend),
    missingTools: Number(row.missingTools),
    missingSkills: Number(row.missingSkills),
    daily,
    tools,
    harnesses,
  };
}
export type AnalyticsSummary = ReturnType<typeof analyticsSummary>;
export function comparisonList(db: DatabaseSync, url: URL) {
  const f = periodFilter(url);
  return db
    .prepare(
      `SELECT json_extract(body,'$.comparisonId') AS comparisonId,COUNT(*) AS runs,MIN(json_extract(body,'$.startedAt')) AS startedAt,COUNT(DISTINCT json_extract(body,'$.contextHash')) AS contexts,COUNT(DISTINCT json_extract(body,'$.source')) AS sources,GROUP_CONCAT(DISTINCT json_extract(body,'$.profileName')) AS setups,
    SUM(CASE WHEN json_extract(body,'$.source')='runner' THEN 1 ELSE 0 END) AS frozenRuns FROM runs WHERE json_extract(body,'$.comparisonId') IN (SELECT json_extract(r.body,'$.comparisonId') FROM runs r WHERE ${f.where} AND json_extract(r.body,'$.comparisonId') IS NOT NULL) GROUP BY comparisonId ORDER BY startedAt DESC`,
    )
    .all(...f.params);
}
export function comparisonData(db: DatabaseSync, id: string) {
  z.uuid().parse(id);
  const records = db
    .prepare(
      "SELECT body FROM runs WHERE json_extract(body,'$.comparisonId')=? ORDER BY json_extract(body,'$.startedAt'),run_id",
    )
    .all(id)
    .map((r) => metricsSchema.parse(JSON.parse(String(r.body))));
  // Bounded batches avoid SQLite's parameter-count limit for large observational trials.
  const assessments = records.flatMap((_, i) =>
    i % 200 === 0
      ? assessmentsFor(
          db,
          records.slice(i, i + 200).map((r) => r.runId),
        )
      : [],
  );
  return { records, assessments };
}
