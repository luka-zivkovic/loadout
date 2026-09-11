import { harnessLabels, type Harness } from "../src/schema";
import piMark from "./assets/brands/pi.svg";
import claudeMark from "./assets/brands/claude.svg";
import openaiMark from "./assets/brands/openai.svg";

const marks: Record<Harness, string> = {
  pi: piMark,
  "claude-code": claudeMark,
  codex: openaiMark,
};

/** Official artwork, kept decorative beside the visible service name. */
export function HarnessIcon({ harness, size = 18 }: { harness: Harness; size?: number }) {
  return <img className={`harness-icon harness-icon-${harness}`} src={marks[harness]} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}

export function HarnessLabel({ harness }: { harness: Harness }) {
  return <span className="harness-label"><HarnessIcon harness={harness}/>{harnessLabels[harness]}</span>;
}
