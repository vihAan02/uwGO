"use client";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-canvas px-1 py-px font-mono text-[11px] text-ink">{children}</kbd>;
}

export function PasteStep({ onText }: { onText: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div>
      <p className="text-sm leading-relaxed text-ink-muted">
        In Quest, open <span className="font-medium text-ink">Class Schedule</span>, pick your term and switch to{" "}
        <span className="font-medium text-ink">List View</span>. Select the whole page (<Kbd>Ctrl</Kbd> or <Kbd>⌘</Kbd> + <Kbd>A</Kbd>), copy it, and paste it here.
      </p>
      <Textarea
        className="mt-3 min-h-36 font-mono text-xs"
        placeholder="Paste your schedule"
        aria-label="Quest schedule"
        value={text}
        onChange={(e) => { setText(e.target.value); onText(e.target.value); }}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
      <div className="mt-2 flex min-h-8 items-center justify-between gap-3 text-xs text-ink-muted">
        <span>Parsed on your device. The text never leaves your browser.</span>
        {text && (
          <Button variant="link" size="xs" className="text-ink-muted" onClick={() => { setText(""); onText(""); }}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
