"use client";
import { useState } from "react";

export function PasteStep({ onText }: { onText: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="mt-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
        <li>Log in to Quest and open <span className="font-medium text-ink">Class Schedule</span>.</li>
        <li>Pick your term and switch to <span className="font-medium text-ink">List View</span>.</li>
        <li>Press <kbd className="rounded border border-line bg-canvas px-1 font-mono text-xs">Ctrl/Cmd + A</kbd> then <kbd className="rounded border border-line bg-canvas px-1 font-mono text-xs">Ctrl/Cmd + C</kbd> to copy the whole page.</li>
        <li>Paste below. Parsing happens on your device; the text never leaves your browser.</li>
      </ol>
      <textarea
        className="field mt-3 min-h-40 font-mono text-xs"
        placeholder="Paste here (Ctrl/Cmd + V)"
        value={text}
        onChange={(e) => { setText(e.target.value); onText(e.target.value); }}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
      {text && <button className="mt-2 text-sm text-ink-muted underline" onClick={() => { setText(""); onText(""); }}>Clear</button>}
    </div>
  );
}
