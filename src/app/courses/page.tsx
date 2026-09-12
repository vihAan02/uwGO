import { CoursesView } from "@/components/courses/CoursesView";

/**
 * The student's academic profile: their term, their courses and their weekly timetable, built
 * from the schedule already saved to their account. `/plan` and `/courses` are the app's two
 * primary places.
 */
export default function CoursesPage() {
  return <CoursesView />;
}
