"use client";
import { useState } from "react";
import type { CourseMeeting, DayOfWeek, University } from "@/domain/types";
import { DAYS_IN_ORDER, DAY_LABELS } from "@/domain/types";
import { createManualMeeting } from "@/parsers/manual";
import { allBuildings } from "@/data/buildings";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-3">
      <ToggleGroup type="single" className="max-w-xs" value={university} onValueChange={(u) => { if (u) { setUniversity(u as University); setBuildingCode(""); } }} aria-label="University">
        <ToggleGroupItem value="WLU">Laurier</ToggleGroupItem>
        <ToggleGroupItem value="UW">Waterloo</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="Course" placeholder="Course, e.g. BU 111" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} />
        <NativeSelect aria-label="Component" value={component} onChange={(e) => setComponent(e.target.value)}>
          {["LEC", "TUT", "LAB", "SEM", "OTHER"].map((c) => <NativeSelectOption key={c}>{c}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <ToggleGroup type="multiple" value={days} onValueChange={(v) => setDays(v as DayOfWeek[])} aria-label="Days">
        {DAYS_IN_ORDER.map((d) => <ToggleGroupItem key={d} value={d} className="flex-none px-3">{DAY_LABELS[d]}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="Start time" placeholder="Start, e.g. 2:30PM" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input aria-label="End time" placeholder="End, e.g. 3:50PM" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect aria-label="Building" value={buildingCode} onChange={(e) => setBuildingCode(e.target.value)}>
          <NativeSelectOption value="">Building…</NativeSelectOption>
          {buildings.map((b) => <NativeSelectOption key={b.id} value={b.code}>{b.code} · {b.name}</NativeSelectOption>)}
        </NativeSelect>
        <Input aria-label="Room" placeholder="Room, e.g. 1001" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
      </div>
      {errors.length > 0 && <ul className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <Button variant="outline" size="touch" className="w-full" onClick={submit}>Add class</Button>
    </div>
  );
}
