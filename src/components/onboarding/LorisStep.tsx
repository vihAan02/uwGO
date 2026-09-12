"use client";
import { useState } from "react";
import { parseLorisSchedule, type LaurierRecord } from "@/parsers/loris/LorisParser";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * The optional LORIS paste. It never creates a course: a double-degree student's Laurier courses
 * are already in their Quest paste. This only fills in the two things Quest does not carry, the
 * professor and the Laurier room, on courses that exist.
 */
export function LorisStep({ onRecords, needing }: { onRecords: (records: LaurierRecord[]) => void; needing: number }) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseLorisSchedule(text) : undefined;

  const change = (value: string) => {
    setText(value);
    const next = value.trim() ? parseLorisSchedule(value) : undefined;
    onRecords(next?.records ?? []);
  };

  return (
    <div>
      <p className="text-sm leading-relaxed text-ink-muted">
        {needing > 0
          ? `${needing} of your Laurier meetings have no room or professor from Quest. In LORIS open Student Detail Schedule, select the whole page, copy, and paste it here.`
          : "In LORIS open Student Detail Schedule, select the whole page, copy, and paste it here. You can skip this."}
      </p>
      <Textarea
        className="mt-3 min-h-28 font-mono text-xs"
        placeholder="Paste your LORIS schedule (optional)"
        aria-label="Laurier LORIS schedule"
        value={text}
        onChange={(e) => change(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
      <div className="mt-2 flex min-h-8 flex-wrap items-center gap-2 text-xs text-ink-muted">
        {parsed && (parsed.recognised
          ? <Badge variant="ok">{parsed.records.length} Laurier meeting{parsed.records.length === 1 ? "" : "s"} read</Badge>
          : <Badge variant="warn">Not a LORIS schedule</Badge>)}
        <span>Parsed on your device. The text never leaves your browser.</span>
        {text && (
          <Button variant="link" size="xs" className="ml-auto text-ink-muted" onClick={() => change("")}>Clear</Button>
        )}
      </div>
    </div>
  );
}
