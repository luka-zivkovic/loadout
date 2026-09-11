import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { sharingDisclosure } from "../src/sharing";
import { Modal } from "./shared";

function SharingDetails() {
  return <div className="sharing-details">
    <dl>
      {sharingDisclosure.sections.map(({ title, body }) => (
        <div key={title}><dt>{title}</dt><dd>{body}</dd></div>
      ))}
    </dl>
    <p>{sharingDisclosure.controls}</p>
    <p className="sharing-footnote">{sharingDisclosure.note}</p>
  </div>;
}

export function SharingLink() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="text-button sharing-link" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <ShieldCheck size={14} aria-hidden="true" /> What’s shared
    </button>
    {open && <Modal title="What’s shared with your workspace" close={() => setOpen(false)}>
      <div className="modal-body">
        <p className="sharing-summary">{sharingDisclosure.summary}</p>
        <SharingDetails />
      </div>
    </Modal>}
  </>;
}

export function SharingNotice() {
  return <section className="sharing-notice" aria-label="What’s shared">
    <ShieldCheck size={18} aria-hidden="true" />
    <div>
      <h2>What’s shared</h2>
      <p>{sharingDisclosure.summary}</p>
      <details>
        <summary>See what’s included and what stays local</summary>
        <SharingDetails />
      </details>
    </div>
  </section>;
}
