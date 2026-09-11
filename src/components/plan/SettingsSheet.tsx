"use client";
import { useRouter } from "next/navigation";
import { LogOut, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HomePicker } from "../onboarding/HomePicker";
import { BufferPicker } from "../onboarding/BufferPicker";
import { ManualClassForm } from "../onboarding/ManualClassForm";
import { GymPrefsPicker } from "../prefs/GymPrefsPicker";
import { RoutePrefPicker } from "../prefs/RoutePrefPicker";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-5">
      <h3 className="font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-sm text-ink-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { state, setHome, setConfig, setGym, setRoutePreference, setIncludeInPlan, removeMeeting, addMeeting, reset } = useStore();
  const auth = useAuth();
  const meetings = state.schedule?.meetings ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription className="sr-only">Where you live, your arrival buffer, route and gym preferences, and your classes.</SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody className="divide-y divide-line">
          {auth.user && (
            <Section title="Account">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm text-ink-muted">{auth.user.email}{auth.mode === "DEV_BYPASS" ? " (dev bypass)" : ""}</p>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => void auth.signOut()}><LogOut /> Log out</Button>
              </div>
            </Section>
          )}

          <Section title="Where you live">
            <HomePicker value={state.home} onChange={setHome} />
          </Section>

          <Section title="Arrival buffer" hint="How early you want to be at the door.">
            <BufferPicker value={state.config.arrivalBufferMinutes} onChange={(v) => setConfig({ arrivalBufferMinutes: v })} />
          </Section>

          <Section title="Route preference">
            <RoutePrefPicker value={state.routePreference ?? "FASTEST"} onChange={setRoutePreference} />
          </Section>

          <Section title="Gym">
            <GymPrefsPicker value={state.gym} onChange={setGym} />
          </Section>

          <Section title="Classes" hint="Switch a class off to leave it out of the plan.">
            <ul className="divide-y divide-line">
              {meetings.map((m) => {
                const id = `include-${m.id}`;
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <label htmlFor={id} className="min-w-0 cursor-pointer">
                      <span className="font-semibold">{m.courseCode}</span>{" "}
                      <span className="text-ink-muted">{m.component}{m.section ? ` ${m.section}` : ""} · {m.days.join("") || "no time"} · {m.location.kind === "ROOM" ? `${m.location.buildingCode} ${m.location.roomNumber}` : m.location.kind.toLowerCase()}</span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      {m.source === "MANUAL" && (
                        <Button variant="ghost" size="icon-sm" className="text-ink-muted" aria-label={`Remove ${m.courseCode}`} onClick={() => removeMeeting(m.id)}><Trash2 /></Button>
                      )}
                      <Switch id={id} checked={m.includeInPlan} onCheckedChange={(v) => setIncludeInPlan(m.id, v)} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <details className="group mt-3">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
                <Plus className="size-4 transition-transform group-open:rotate-45" aria-hidden="true" />
                Add a class by hand
              </summary>
              <div className="mt-3"><ManualClassForm defaultUniversity="WLU" onAdd={addMeeting} /></div>
            </details>
          </Section>

          <Section title="Start over" hint="Removes the schedule and home from this device.">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto"><Trash2 /> Delete everything</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your schedule and home?</AlertDialogTitle>
                  <AlertDialogDescription>This removes everything UW GO keeps on this device. You can paste your schedule again any time.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { reset(); onOpenChange(false); router.replace("/setup"); }}>Delete everything</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Section>

          <p className="py-5 text-xs leading-relaxed text-ink-muted">Building data: University of Waterloo campus map (used as-is) and Wilfrid Laurier University pages. Laurier coordinates © OpenStreetMap contributors (ODbL). Routes and maps by Google. PAC hours and live occupancy from Waterloo Athletics; indoor connections from the UW Campus Accessibility building pages.</p>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
