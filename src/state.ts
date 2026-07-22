// Shared UI state for the Taskgregator nav (left dock) and list (center) views.
// Both views read/write the same instance so a selection made in the nav is
// reflected by the list, and sort/group/collapse survive re-renders.

export type SortKey = "priority" | "due" | "start" | "reference" | "title";
export type GroupKey = "none" | "priority" | "due" | "reference";

export type Selection =
  | { type: "today" }
  | { type: "all" }
  | { type: "flagged" }
  | { type: "smart"; tag: string; label: string }
  | { type: "node"; key: string; label: string };

export class TaskgregatorState {
  selection: Selection = { type: "today" };
  // Context-tree node keys the user has collapsed.
  collapsed: Set<string> = new Set();
  sortBy: SortKey = "priority";
  groupBy: GroupKey = "none";
}
