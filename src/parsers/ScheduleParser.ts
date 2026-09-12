import type { ParsedSchedule } from "@/domain/types";

/**
 * Adapter interface: one implementation per student-information system that can *create* a
 * schedule. Only Quest can: a double-degree student's Laurier courses already appear in Quest,
 * so Laurier's LORIS is an enrichment source rather than a second schedule, and it lives in
 * `src/parsers/loris/` with its own shape (see LorisParser.ts and merge.ts).
 */
export interface ScheduleParser {
  readonly id: "QUEST";
  readonly label: string;
  parse(text: string): ParsedSchedule;
}
