"use client";
import { useState } from "react";
import type { CourseMeeting, DayOfWeek, University } from "@/domain/types";
import { DAYS_IN_ORDER, DAY_LABELS } from "@/domain/types";
import { createManualMeeting } from "@/parsers/manual";
import { allBuildings } from "@/data/buildings";

export function ManualClassForm({ defaultUniversity, onAdd }: { defaultUniversity: University; onAdd: (m: CourseMeeting) => void }) {
  const [university, setUniversity] = useState<University>(defaultUniversity);
  const [courseCode, setCourseCode] = useState("");
  const [component, setComponent] = useState("LEC");
  const [days, setDays] = useState<DayOfWeek[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [buildingCode, setBuildingCode] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const buildings = allBuildings(university).filter((b) => b.kind !== "RESIDENCE" && b.latitude !== undefined).sort((a, b) => a.code.localeCompare(b.code));

  const submit = () => {
    const r = createManualMeeting({ university, courseCode, component, days, start, end, buildingCode, roomNumber });
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]);
    onAdd(r.meeting);
    setCourseCode(""); setDays([]); setStart(""); setEnd(""); setRoomNumber("");
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex gap-2">
        {(["WLU", "UW"] as University[]).map((u) => (
          <button key={u} className={`btn flex-1 ${university === u ? "btn-primary" : "btn-secondary"}`} onClick={() => { setUniversity(u); setBuildingCode(""); }}>{u === "WLU" ? "Laurier" : "Waterloo"}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="Course, e.g. BU 111" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} />
        <select className="field" value={component} onChange={(e) => setComponent(e.target.value)}>
          {["LEC", "TUT", "LAB", "SEM", "OTHER"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        {DAYS_IN_ORDER.map((d) => (
          <button key={d} className={`chip min-h-9 px-3 ${days.includes(d) ? "bg-brand text-white" : "bg-canvas text-ink"}`} onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}>{DAY_LABELS[d]}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="Start, e.g. 2:30PM" value={start} onChange={(e) => setStart(e.target.value)} />
        <input className="field" placeholder="End, e.g. 3:50PM" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="field" value={buildingCode} onChange={(e) => setBuildingCode(e.target.value)}>
          <option value="">Building…</option>
          {buildings.map((b) => <option key={b.id} value={b.code}>{b.code} · {b.name}</option>)}
        </select>
        <input className="field" placeholder="Room, e.g. 1001" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
      </div>
      {errors.length > 0 && <ul className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <button className="btn btn-secondary w-full" onClick={submit}>Add class</button>
    </div>
  );
}
