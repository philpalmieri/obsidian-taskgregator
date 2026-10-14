// Dataview inline-field task format support.
//
// The Tasks plugin can store task metadata either as emoji signifiers
// (📅 2024-01-01) or as Dataview "bracketed inline fields" ([due:: 2024-01-01]
// or (due:: 2024-01-01)). This module handles reading, stripping, and writing
// the Dataview variant so Taskgregator can stay compatible with either setup.
//
// Reference: https://publish.obsidian.md/tasks/Reference/Task+Formats/Dataview+Format

export type TaskFormat = "emoji" | "dataview";

// Dataview field keys understood by the Tasks plugin. `completion` and
// `cancelled` are the done/cancelled dates; note the naming differs from the
// emoji model (✅ done-date -> `completion`).
export const DV_KEYS = {
  due: "due",
  start: "start",
  scheduled: "scheduled",
  created: "created",
  completion: "completion",
  cancelled: "cancelled",
  priority: "priority",
  repeat: "repeat",
} as const;

// All recognized task field keys, used for detection and display-text cleanup.
// Only these keys are stripped from card text; unrelated user inline fields
// (e.g. [effort:: 3]) are left untouched.
export const DV_TASK_KEYS: string[] = [
  DV_KEYS.due,
  DV_KEYS.start,
  DV_KEYS.scheduled,
  DV_KEYS.created,
  DV_KEYS.completion,
  DV_KEYS.cancelled,
  DV_KEYS.priority,
  DV_KEYS.repeat,
  "onCompletion",
  "id",
  "dependsOn",
];

const DATE = "\\d{4}-\\d{2}-\\d{2}";

/**
 * Build a regex matching a single Dataview inline field for `key`, in either
 * bracket style: `[key:: value]` or `(key:: value)`. Capture group 1 is the
 * trimmed-ish value (leading/trailing spaces inside the brackets are allowed).
 */
function fieldRe(key: string, value = "[^\\]\\)]*?"): RegExp {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`[\\[(]\\s*${k}\\s*::\\s*(${value})\\s*[\\])]`, "i");
}

/** Read a Dataview date field (returns YYYY-MM-DD) if present. */
export function readDvDate(text: string, key: string): string | undefined {
  const m = text.match(fieldRe(key, DATE));
  return m ? m[1] : undefined;
}

/** Read an arbitrary Dataview field value if present. */
export function readDvField(text: string, key: string): string | undefined {
  const m = text.match(fieldRe(key));
  return m ? m[1].trim() : undefined;
}

/** True if the line contains any recognized Dataview task field. */
export function hasDataviewField(text: string): boolean {
  return DV_TASK_KEYS.some((k) => fieldRe(k).test(text));
}

/** Remove all recognized Dataview task fields from `text` (for display). */
export function stripDataviewFields(text: string): string {
  let out = text;
  for (const key of DV_TASK_KEYS) {
    out = out.replace(new RegExp(fieldRe(key).source, "gi"), "");
  }
  return out;
}

/**
 * Set (or clear, when `value` is null) a Dataview inline field on a line.
 * Existing occurrences are removed first; a new `[key:: value]` is appended
 * (Tasks always writes square brackets). Trailing block ids are preserved by
 * the caller via appendSignifier.
 */
export function stripDvField(line: string, key: string): string {
  return line
    .replace(new RegExp("\\s*" + fieldRe(key).source, "gi"), "")
    .trimEnd();
}
