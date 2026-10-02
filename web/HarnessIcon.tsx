import { harnessLabels, type Harness } from "../src/schema";
import piMark from "./assets/brands/pi.svg";
import claudeMark from "./assets/brands/claude.svg";
import openaiMark from "./assets/brands/openai.svg";
import cursorMark from "./assets/brands/cursor.svg";
import opencodeMark from "./assets/brands/opencode.svg";

const marks: Record<Harness, string> = {
  pi: piMark,
  "claude-code": claudeMark,
  codex: openaiMark,
  cursor: cursorMark,
  opencode: opencodeMark,
};

/** Product marks are decorative beside visible names. */
export function HarnessIcon({ harness, size = 18 }: { harness: Harness; size?: number }) {
  const className = `harness-icon harness-icon-${harness}`;
  return <img className={className} src={marks[harness]} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}

export function HarnessLabel({ harness }: { harness: Harness }) {
  return <span className="harness-label"><HarnessIcon harness={harness}/>{harnessLabels[harness]}</span>;
}
