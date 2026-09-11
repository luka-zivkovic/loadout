import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { publicOrigin } from "./web-server.js";
import { trustedProxyAddresses } from "./proxy.js";

/** Read-only preflight: never migrates the database or changes permissions. */
export function checkDeployment(
  data: string,
  options: { publicUrl?: string; trustedProxies?: string[] } = {},
) {
  const checks: {
    name: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }[] = [];
  const add = (
    name: string,
    status: "pass" | "warn" | "fail",
    detail: string,
  ) => checks.push({ name, status, detail });
  const root = resolve(data);
  for (const [name, path] of [
    ["Registry directory", root],
    ["Registry database", join(root, "registry.sqlite")],
  ]) {
    if (!existsSync(path!)) add(name!, "fail", "Missing.");
    else
      add(
        name!,
        (statSync(path!).mode & 0o077) === 0 ? "pass" : "fail",
        "Must be readable only by the service account (directory 700, database 600).",
      );
  }
  const assets = fileURLToPath(
    new URL("../web/dist/index.html", import.meta.url),
  );
  add(
    "Built dashboard",
    existsSync(assets) ? "pass" : "fail",
    "Deploy web/dist alongside dist.",
  );
  try {
    const origin = publicOrigin(options.publicUrl ?? "http://127.0.0.1:4318");
    add(
      "Public origin",
      options.publicUrl ? "pass" : "warn",
      options.publicUrl
        ? origin
        : "Loopback default. Set --public-url for access from other devices.",
    );
    const proxies = trustedProxyAddresses(options.trustedProxies);
    add(
      "Proxy configuration",
      proxies.length ? "pass" : "warn",
      proxies.length
        ? `${proxies.length} explicit proxy IPs. The proxy must preserve Host and append or replace X-Forwarded-For with the actual client IP.`
        : "Forwarded IP headers are ignored. Configure --trusted-proxy if using a reverse proxy.",
    );
  } catch (error) {
    add("Origin / proxy configuration", "fail", (error as Error).message);
  }
  if (existsSync(join(root, "registry.sqlite"))) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(root, "registry.sqlite"), {
        readOnly: true,
        timeout: 5000,
      });
      const result = db.prepare("PRAGMA quick_check").all();
      add(
        "SQLite integrity",
        result.length === 1 && result[0]!.quick_check === "ok"
          ? "pass"
          : "fail",
        result.map((r) => String(r.quick_check)).join("; "),
      );
      const migrated = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='operation_settings'",
        )
        .get();
      add(
        "Operations schema",
        migrated ? "pass" : "warn",
        migrated
          ? "Current operations tables present."
          : "Back up while stopped before the first upgraded server start.",
      );
    } catch (error) {
      add("SQLite integrity", "fail", (error as Error).message);
    } finally {
      db?.close();
    }
  }
  add(
    "Backup and HTTPS verification",
    "warn",
    "Manually verify a restore from a private backup, HTTPS routing, service supervision, and backup expiry. This local preflight cannot verify them.",
  );
  return { ok: !checks.some((c) => c.status === "fail"), checks };
}
