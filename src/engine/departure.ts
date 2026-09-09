import { addMin } from "@/time/toronto";

/**
 * Latest departure that still arrives `bufferMinutes` before `arriveBy`.
 * departure = arriveBy - duration - buffer. Integer-minute arithmetic on absolute instants.
 */
export function recommendedDeparture(arriveBy: Date, durationMinutes: number, bufferMinutes: number): Date {
  return addMin(arriveBy, -(Math.ceil(durationMinutes) + bufferMinutes));
}

export function expectedArrival(departure: Date, durationMinutes: number): Date {
  return addMin(departure, Math.ceil(durationMinutes));
}

/** Clamp a planned departure so it is never before the student can actually leave. */
export function clampDeparture(planned: Date, departAfter: Date): Date {
  return planned.getTime() < departAfter.getTime() ? departAfter : planned;
}
