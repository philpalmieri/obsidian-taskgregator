// Core data model for Taskgregator.

export type TaskStatus = "open" | "done" | "cancelled" | "inProgress" | "forwarded";

export interface RawTaskMeta {
  due?: string; // YYYY-MM-DD
  start?: string; // 🛫 start-on
  scheduled?: string; // ⏳ scheduled
  created?: string; // ➕ created
  doneDate?: string; // ✅ completion date
  cancelledDate?: string; // ❌ cancelled date
  recurrence?: string; // 🔁 rule text
}

export interface TaskItem {
  id: string; // stable identity: block id if present, else synthetic path:line
  blockId?: string; // ^abc123 (without caret) if the source line has one
  hasBlockId: boolean;
  filePath: string; // vault-relative path of the source file
  line: number; // 0-based line index in the source file
  indent: number; // leading whitespace length (for parent/child nesting)
  statusChar: string; // the raw char inside [ ]
  status: TaskStatus;
  text: string; // display text with emoji/metadata/tags stripped
  rawText: string; // the full original line
  tags: string[]; // inline #tags (without the leading #)
  links: string[]; // wikilink targets referenced in the task (normalized, no path/ext)
  priority: number; // 0 = none, 1 = highest .. higher number = lower priority
  meta: RawTaskMeta;
  // Derived context:
  bucketRoot: string; // "Projects" | "People" | "Areas" | "Dailies" | "Other"
  bucketFile: string; // basename of the source file, no extension
  sidecarPath?: string; // Taskgregator/tasksData/<id>.md if it exists
}

export interface TreeNode {
  key: string; // unique path key e.g. "Projects/Deployment Tracker"
  label: string;
  kind: "root" | "file" | "tag" | "smart";
  children: TreeNode[];
  taskIds: string[]; // tasks directly at this node
  count: number; // rolled-up open count including descendants
}
