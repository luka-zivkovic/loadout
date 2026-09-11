import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
const normalize = (address: string) =>
  address.startsWith("::ffff:") ? address.slice(7) : address;
export function trustedProxyAddresses(values: string[] = []) {
  return values.map((value) => {
    const address = normalize(value.trim());
    if (!isIP(address))
      throw new Error("Trusted proxies must be explicit IP addresses");
    return address;
  });
}
export function clientAddress(
  req: Pick<IncomingMessage, "headers" | "socket">,
  trusted: string[],
) {
  const peer = normalize(req.socket.remoteAddress ?? "unknown");
  if (!trusted.includes(peer)) return peer;
  const header = req.headers["x-forwarded-for"];
  if (typeof header !== "string" || header.length > 2048) return peer;
  const chain = header.split(",").map((s) => normalize(s.trim()));
  if (!chain.length || chain.some((s) => !isIP(s))) return peer;
  // Walk from the trusted socket toward the client; left-hand spoofed entries
  // cannot override the first untrusted address appended by the proxy chain.
  for (const address of chain.reverse())
    if (!trusted.includes(address)) return address;
  return chain.at(-1) ?? peer;
}
