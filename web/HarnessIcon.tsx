import { harnessLabels, type Harness } from "../src/schema";
import { MousePointer2, TerminalSquare } from "lucide-react";
import piMark from "./assets/brands/pi.svg";
import claudeMark from "./assets/brands/claude.svg";
import openaiMark from "./assets/brands/openai.svg";

const marks: Partial<Record<Harness, string>> = {
  pi: piMark,
  "claude-code": claudeMark,
  codex: openaiMark,
};

/** Existing service marks and neutral symbols, decorative beside visible names. */
export function HarnessIcon({ harness, size = 18 }: { harness: Harness; size?: number }) {
  const className = `harness-icon harness-icon-${harness}`;
  if (harness === "cursor") return <MousePointer2 className={className} size={size} aria-hidden="true" />;
  if (harness === "opencode") return <TerminalSquare className={className} size={size} aria-hidden="true" />;
  return <img className={className} src={marks[harness]} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}

export function HarnessLabel({ harness }: { harness: Harness }) {
  return <span className="harness-label"><HarnessIcon harness={harness}/>{harnessLabels[harness]}</span>;
}
