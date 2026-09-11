import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { jsonRead } from "./files.js";
import { withdrawalSchema } from "./team-protocol.js";
import type { Store } from "./store.js";
import type { Setup, Skill } from "./schema.js";
export function assertLocalAvailable(store: Store, artifact: Setup | Skill) {
  const path = join(store.dir, "withdrawals.json");
  if (!existsSync(path)) return;
  const withdrawals = z.array(withdrawalSchema).parse(jsonRead(path));
  if (
    withdrawals.some(
      (w) =>
        w.revision === artifact.revision ||
        (w.kind === "skill" &&
          "skillPins" in artifact &&
          artifact.skillPins?.some((p) => p.revision === w.revision)),
    )
  )
    throw new Error(
      "This local revision or a bundled skill was withdrawn by its publisher. Inspect a replacement before running or installing it. Existing files remain local.",
    );
}
