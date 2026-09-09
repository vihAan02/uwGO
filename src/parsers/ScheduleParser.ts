import type { ParsedSchedule } from "@/domain/types";

/** Adapter interface: one implementation per student-information system. */
export interface ScheduleParser {
  readonly id: "QUEST" | "LORIS";
  readonly label: string;
  parse(text: string): ParsedSchedule;
}

/** Wilfrid Laurier's LORIS (Ellucian Banner). Not implemented: no verified copy-paste sample exists yet. */
export const laurierParser: ScheduleParser = {
  id: "LORIS",
  label: "Laurier LORIS",
  parse() {
    return {
      meetings: [],
      warnings: [
        {
          code: "PARSER_NOT_IMPLEMENTED",
          message: "Laurier LORIS import is not implemented yet. Add Laurier classes manually.",
        },
      ],
      dateOrder: "UNKNOWN",
      recognised: false,
    };
  },
};
