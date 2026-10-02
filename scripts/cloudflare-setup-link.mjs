import { readFileSync, writeFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const origin = new URL(config.vars.PUBLIC_ORIGIN).origin;
const { BOOTSTRAP_SECRET: secret } = JSON.parse(readFileSync(".registry/cloudflare-secrets.json", "utf8"));
if (!secret || !/^https:/.test(origin)) throw new Error("Cloudflare origin or bootstrap secret is missing.");

const response = await fetch(`${origin}/__loadout/bootstrap`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const result = await response.json();
if (!response.ok) throw new Error(result.message ?? `Bootstrap failed (${response.status}).`);
const link = new URL(result.url);
if (link.origin !== origin || !link.hash.startsWith("#token=psb_"))
  throw new Error("Cloudflare returned an unexpected setup link.");
writeFileSync(".registry/cloudflare-setup-link.txt", `${link.href}\n`, { mode: 0o600 });
console.log(`First-admin setup link (expires ${result.expiresAt}):\n${link.href}`);
