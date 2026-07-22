import { ItemView, WorkspaceLeaf } from "obsidian";
import { TaskItem, TreeNode } from "./types";
import { TaskStore } from "./store";
import { TaskWriter } from "./writer";
import { nodeKeyForFile } from "./parser";
import { TaskgregatorSettings } from "./settings";
import { TaskRowCtx, renderTaskRow, todayStr, promptDate } from "./ui";
import { Selection, SortKey, GroupKey, TaskgregatorState } from "./state";

export { promptDate };

export const VIEW_TYPE_TASKGREGATOR = "taskgregator-view";

const SORT_OPTIONS: [SortKey, string][] = [
  ["priority", "Priority"],
  ["due", "Due date"],
  ["start", "Start date"],
  ["reference", "Reference"],
  ["title", "Title"],
];

const GROUP_OPTIONS: [GroupKey, string][] = [
  ["none", "None"],
  ["priority", "Priority"],
  ["due", "Due date"],
  ["reference", "Reference"],
];

export interface ViewDeps {
  store: TaskStore;
  writer: TaskWriter;
  settings: TaskgregatorSettings;
  state: TaskgregatorState;
  reindexFile: (path: string) => Promise<void>;
  // Reindex the vault, then re-render every Taskgregator view.
  refresh: () => void;
  // Ensure/reveal the center list view (called when a nav item is chosen).
  openList: () => Promise<void>;
  // Re-render nav + list + context views without reindexing.
  rerenderAll: () => void;
}

/**
 * The list view: renders the task list for the current selection (held in shared
 * state). Navigation lives in the separate nav view (left dock).
 */
export class TaskgregatorView extends ItemView {
  deps: ViewDeps;
  mainEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  private get state(): TaskgregatorState {
    return this.deps.state;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKGREGATOR;
  }
  getDisplayText(): string {
    return "Taskgregator";
  }
  getIcon(): string {
    return "check-check";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("taskgregator", "tg-list-view");
    this.mainEl = root.createDiv({ cls: "tg-main" });
    this.render();
  }

  render(): void {
    this.renderMain();
  }

  /** Focus the node that contains a given source file (used by external reveal). */
  revealTask(filePath: string): void {
    const { fileKey, flat, rootName } = nodeKeyForFile(filePath, this.deps.settings);
    const base = filePath.split("/").pop()?.replace(/\.md$/i, "") || filePath;
    this.state.selection = {
      type: "node",
      key: fileKey,
      label: flat ? rootName : base,
    };
    this.render();
  }

  private rowCtx(): TaskRowCtx {
    return {
      app: this.app,
      writer: this.deps.writer,
      reindexFile: this.deps.reindexFile,
      rerender: () => this.render(),
    };
  }

  private currentTasks(): { title: string; tasks: TaskItem[] } {
    const s: Selection = this.state.selection;
    switch (s.type) {
      case "today":
        return { title: "Today", tasks: this.deps.store.dueToday() };
      case "flagged":
        return {
          title: "Flagged",
          tasks: this.deps.store.visible().filter((t) => t.priority > 0 && t.priority <= 2),
        };
      case "all":
        return { title: "All tasks", tasks: this.deps.store.visible() };
      case "smart":
        return { title: s.label, tasks: this.deps.store.tasksWithTag(s.tag) };
      case "node": {
        const roots = this.deps.store.buildContextTree();
        const node = findNode(roots, s.key);
        const tasks = node ? this.deps.store.tasksForNode(node) : [];
        return { title: s.label, tasks };
      }
    }
  }

  private renderMain(): void {
    const el = this.mainEl;
    el.empty();
    const { title, tasks } = this.currentTasks();
    const head = el.createDiv({ cls: "tg-main-header" });
    head.createEl("h2", { text: title });
    head.createSpan({ cls: "tg-count", text: `${tasks.length}` });

    if (tasks.length === 0) {
      this.renderControls(el);
      el.createDiv({ cls: "tg-empty", text: "No tasks here. Nice." });
      return;
    }

    this.renderControls(el);

    const sorted = sortTasksBy(tasks, this.state.sortBy);
    const list = el.createDiv({ cls: "tg-list" });

    if (this.state.groupBy === "none") {
      for (const t of sorted) this.renderTaskRow(list, t);
      return;
    }

    for (const group of groupTasks(sorted, this.state.groupBy)) {
      const header = list.createDiv({ cls: "tg-group-header" });
      header.createSpan({ cls: "tg-group-label", text: group.label });
      header.createSpan({ cls: "tg-group-count", text: String(group.tasks.length) });
      for (const t of group.tasks) this.renderTaskRow(list, t);
    }
  }

  private renderControls(el: HTMLElement): void {
    const bar = el.createDiv({ cls: "tg-controls" });

    const sortWrap = bar.createDiv({ cls: "tg-control" });
    sortWrap.createSpan({ cls: "tg-control-label", text: "Sort" });
    const sortSel = sortWrap.createEl("select", { cls: "tg-select" });
    for (const [val, label] of SORT_OPTIONS) {
      const opt = sortSel.createEl("option", { text: label });
      opt.value = val;
      if (val === this.state.sortBy) opt.selected = true;
    }
    sortSel.onchange = () => {
      this.state.sortBy = sortSel.value as SortKey;
      this.renderMain();
    };

    const groupWrap = bar.createDiv({ cls: "tg-control" });
    groupWrap.createSpan({ cls: "tg-control-label", text: "Group" });
    const groupSel = groupWrap.createEl("select", { cls: "tg-select" });
    for (const [val, label] of GROUP_OPTIONS) {
      const opt = groupSel.createEl("option", { text: label });
      opt.value = val;
      if (val === this.state.groupBy) opt.selected = true;
    }
    groupSel.onchange = () => {
      this.state.groupBy = groupSel.value as GroupKey;
      this.renderMain();
    };
  }

  private renderTaskRow(parent: HTMLElement, task: TaskItem): void {
    renderTaskRow(parent, task, this.rowCtx());
  }
}

function sortTasksBy(tasks: TaskItem[], key: SortKey): TaskItem[] {
  const byPrio = (a: TaskItem, b: TaskItem) => (a.priority || 99) - (b.priority || 99);
  const byText = (a: TaskItem, b: TaskItem) => a.text.localeCompare(b.text);
  const byDue = (a: TaskItem, b: TaskItem) => {
    const da = a.meta.due || "9999-99-99";
    const db = b.meta.due || "9999-99-99";
    return da === db ? 0 : da < db ? -1 : 1;
  };
  const byStart = (a: TaskItem, b: TaskItem) => {
    const da = a.meta.start || "9999-99-99";
    const db = b.meta.start || "9999-99-99";
    return da === db ? 0 : da < db ? -1 : 1;
  };
  const byRef = (a: TaskItem, b: TaskItem) => refKey(a).localeCompare(refKey(b));

  return tasks.slice().sort((a, b) => {
    let c = 0;
    switch (key) {
      case "due":
        c = byDue(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "start":
        c = byStart(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "reference":
        c = byRef(a, b) || byPrio(a, b) || byDue(a, b) || byText(a, b);
        break;
      case "title":
        c = byText(a, b);
        break;
      case "priority":
      default:
        c = byPrio(a, b) || byDue(a, b) || byText(a, b);
        break;
    }
    return c;
  });
}

function refKey(t: TaskItem): string {
  return `${t.bucketRoot}: ${t.bucketFile}`;
}

// Group tasks (already sorted) into ordered buckets. The "none" equivalent
// (no priority / no due date) always sorts to the bottom.
function groupTasks(
  tasks: TaskItem[],
  key: GroupKey
): { label: string; sort: number; tasks: TaskItem[] }[] {
  const groups = new Map<string, { label: string; sort: number; tasks: TaskItem[] }>();
  const push = (id: string, label: string, sort: number, t: TaskItem) => {
    let g = groups.get(id);
    if (!g) {
      g = { label, sort, tasks: [] };
      groups.set(id, g);
    }
    g.tasks.push(t);
  };

  for (const t of tasks) {
    if (key === "priority") {
      const p = t.priority;
      if (p === 0) push("z-none", "No priority", 999, t);
      else if (p >= 1 && p <= 3) push("p" + p, "P" + p, p, t);
      else push("p-low", "Low", 4, t);
    } else if (key === "due") {
      const bucket = dueBucket(t.meta.due);
      push(bucket.id, bucket.label, bucket.sort, t);
    } else {
      // reference
      const rk = refKey(t);
      push("ref:" + rk, rk, 0, t);
    }
  }

  const arr = Array.from(groups.values());
  arr.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  return arr;
}

function dueBucket(due?: string): { id: string; label: string; sort: number } {
  if (!due) return { id: "z-none", label: "No due date", sort: 999 };
  const today = todayStr();
  if (due < today) return { id: "overdue", label: "Overdue", sort: 0 };
  if (due === today) return { id: "today", label: "Today", sort: 1 };
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const weekStr = week.toISOString().slice(0, 10);
  if (due <= weekStr) return { id: "week", label: "Next 7 days", sort: 2 };
  return { id: "later", label: "Later", sort: 3 };
}

function findNode(roots: TreeNode[], key: string): TreeNode | undefined {
  for (const r of roots) {
    if (r.key === key) return r;
    const found = findNode(r.children, key);
    if (found) return found;
  }
  return undefined;
}
