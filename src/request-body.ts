import { Buffer } from "node:buffer";
import { TeamError } from "./team-protocol.js";

/** Read only a bounded request body, cancelling the stream at the first excess byte. */
export async function boundedBody(request: Request, maxBytes: number): Promise<Buffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const tooLarge = async (): Promise<never> => {
    try { await reader.cancel(); } catch { /* Preserve the size error. */ }
    throw new TeamError(413, "too_large", "Request exceeds the upload limit.");
  };
  try {
    const declaredBytes = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) await tooLarge();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) await tooLarge();
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}
