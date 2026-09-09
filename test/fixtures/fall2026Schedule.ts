import type { CourseMeeting } from "@/domain/types";

/**
 * A real Fall 2026 first-year schedule, used as the itinerary engine's worked example.
 * Rooms that are genuinely unannounced stay TBA: the point is that they must not turn
 * into invented destinations.
 */
const TERM = { startDate: "2026-09-08", endDate: "2026-12-08" };

const m = (over: Partial<CourseMeeting> & Pick<CourseMeeting, "id" | "courseCode" | "days" | "start" | "end">): CourseMeeting => ({
  university: "UW",
  component: "LEC",
  location: { kind: "TBA" },
  source: "MANUAL",
  includeInPlan: true,
  ...TERM,
  ...over,
});

const at = (h: number, min = 0) => h * 60 + min;
const room = (buildingCode: string, roomNumber: string) => ({ kind: "ROOM", buildingCode, roomNumber }) as const;

export const FALL_2026: CourseMeeting[] = [
  // Rooms still TBA: no physical destination may be invented for these.
  m({ id: "bus111-lec", courseCode: "BUS 111W", days: ["T", "Th"], start: at(8, 30), end: at(9, 50) }),
  m({ id: "bus111-lab", courseCode: "BUS 111W", component: "LAB", days: ["T"], start: at(17, 30), end: at(18, 50) }),
  m({ id: "econ120-lec", courseCode: "ECON 120W", days: ["T", "Th"], start: at(10), end: at(11, 20) }),

  // CS 135
  m({ id: "cs135-lec", courseCode: "CS 135", days: ["T", "Th"], start: at(13), end: at(14, 20), location: room("MC", "4020") }),
  m({ id: "cs135-tut", courseCode: "CS 135", component: "TUT", days: ["F"], start: at(11, 30), end: at(12, 20), location: room("MC", "2035") }),
  // One-off evening tests: a single date each, not a weekly pattern.
  m({ id: "cs135-test1", courseCode: "CS 135", component: "OTHER", days: ["Th"], start: at(19), end: at(20, 50), startDate: "2026-10-08", endDate: "2026-10-08" }),
  m({ id: "cs135-test2", courseCode: "CS 135", component: "OTHER", days: ["M"], start: at(19), end: at(20, 50), startDate: "2026-11-09", endDate: "2026-11-09" }),

  // MATH 135
  m({ id: "math135-lec", courseCode: "MATH 135", days: ["M", "W", "F"], start: at(14, 30), end: at(15, 20), location: room("QNC", "2502") }),
  m({ id: "math135-tut", courseCode: "MATH 135", component: "TUT", days: ["W"], start: at(16), end: at(17, 20), location: room("STC", "0050") }),
  m({ id: "math135-test", courseCode: "MATH 135", component: "OTHER", days: ["W"], start: at(19), end: at(20, 50), startDate: "2026-10-21", endDate: "2026-10-21" }),

  // MATH 137
  m({ id: "math137-lec", courseCode: "MATH 137", days: ["M", "W", "F"], start: at(10, 30), end: at(11, 20), location: room("STC", "0010") }),
  m({ id: "math137-tut", courseCode: "MATH 137", component: "TUT", days: ["M"], start: at(17, 30), end: at(18, 50), location: room("STC", "0020") }),
  m({ id: "math137-test", courseCode: "MATH 137", component: "OTHER", days: ["M"], start: at(19), end: at(20, 50), startDate: "2026-10-26", endDate: "2026-10-26" }),

  // No location and no meeting pattern at all.
  m({ id: "mthel99", courseCode: "MTHEL 99", days: [], start: 0, end: 0, unscheduled: true, location: { kind: "ONLINE" } }),
  m({ id: "seq5dd", courseCode: "SEQ 5DD", days: [], start: 0, end: 0, unscheduled: true }),
];

/** A plain week with no one-off tests in it. */
export const ORDINARY_WEEK_MONDAY = "2026-09-14";
/** The week containing the MATH 135 test on Wednesday 21 October. */
export const OCT21_WEEK_MONDAY = "2026-10-19";
