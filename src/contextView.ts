import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { ViewDeps, sortTasksBy } from "./view";
import { computeContext, ContextScope, DueFilter } from "./context";
import { SortKey } from "./state";
import { TaskItem } from "./types";
import { TaskRowCtx, renderTaskRow } from "./ui";

export const VIEW_TYPE_TASKGREGATOR_CONTEXT = "taskgregator-context-view";

const TABS: [ContextScope, string][] = [
  ["all", "All"],
  ["page", "Page"],
  ["section", "Section"],
  ["reference", "Reference"],
];

// Due-date filter options shown above the scope tabs.
const DUE_FILTERS: [DueFilter, string][] = [
  ["all", "All"],
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["soon", "Soon"],
];

// Sort options for the context sidebar (tri-state, one active at a time).
const SORT_OPTIONS: [SortKey, string][] = [
  ["priority", "Priority"],
  ["due", "Due"],
  ["start", "Start"],
  ["created", "Age"],
];

/**
 * A right-sidebar panel that follows the active file and shows the tasks in its
 * context: tasks on the page (or, for a folder note, the whole folder subtree)
 * plus tasks elsewhere that reference it. Reuses the hub view's task rows.
 */
export class TaskgregatorContextView extends ItemView {
  deps: ViewDeps;
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKGREGATOR_CONTEXT;
  }
  getDisplayText(): string {
    return "Task context";
  }
  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("taskgregator", "tg-context");
    this.render();
  }

  /** Point the panel at a file (called as the active file changes). */
  setFile(file: TFile | null): void {
    if (file?.path === this.file?.path) return;
    this.file = file;
    this.render();
  }

  /** Filter a task list by the selected due-date window. */
  private filterByDue(tasks: TaskItem[], filter: DueFilter): TaskItem[] {
    if (filter === "all") return tasks;
    if (filter === "completed") return tasks.filter((t) => t.status === "done");
    const today = new Date().toISOString().slice(0, 10);
    if (filter === "overdue") return tasks.filter((t) => t.meta.due && t.meta.due < today);
    if (filter === "today") return tasks.filter((t) => t.meta.due === today);
    // "soon": due after today, through today + soonDays.
    const end = new Date();
    end.setDate(end.getDate() + Math.max(1, this.deps.settings.soonDays));
    const endStr = end.toISOString().slice(0, 10);
    return tasks.filter((t) => t.meta.due && t.meta.due > today && t.meta.due <= endStr);
  }

  /** Apply the active sidebar sort, if any (else keep natural scope order). */
  private applySort(tasks: TaskItem[]): TaskItem[] {
    const s = this.deps.state;
    if (!s.contextSortExplicit) return tasks;
    return sortTasksBy(tasks, s.contextSortBy, s.contextSortDir);
  }

  /** Tri-state cycle for a sidebar sort key: asc -> desc -> off. */
  private cycleSort(key: SortKey): void {
    const s = this.deps.state;
    if (!s.contextSortExplicit || s.contextSortBy !== key) {
      s.contextSortExplicit = true;
      s.contextSortBy = key;
      s.contextSortDir = "asc";
    } else if (s.contextSortDir === "asc") {
      s.contextSortDir = "desc";
    } else {
      s.contextSortExplicit = false;
      s.contextSortBy = "priority";
      s.contextSortDir = "asc";
    }
    this.render();
  }

  private rowCtx(): TaskRowCtx {    return {
      app: this.app,
      writer: this.deps.writer,
      reindexFile: this.deps.reindexFile,
      rerender: () => this.render(),
      agingDays: this.deps.settings.agingDays,
      onTagClick: (tag: string) => {
        this.deps.state.selection = { type: "smart", tag, label: "#" + tag };
        void this.deps.openList();
        this.deps.rerenderAll();
      },
    };
  }

  render(): void {
    const root = this.contentEl;
    root.empty();

    if (!this.file) {
      root.createDiv({ cls: "tg-empty", text: "Open a note to see its tasks." });
      return;
    }

    const ctx = computeContext(this.app, this.deps.store, this.file);
    const fullCtx = computeContext(this.app, this.deps.store, this.file, true);

    const header = root.createDiv({ cls: "tg-context-header" });
    const title = header.createDiv({ cls: "tg-context-title" });
    const ic = title.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, ctx.isFolderNote ? "folder" : "file-text");
    title.createSpan({ cls: "tg-context-name", text: ctx.title });
    header.createSpan({ cls: "tg-count", text: String(ctx.total) });
    root.createDiv({ cls: "tg-context-sub", text: ctx.subtitle });

    // Subtle due-date filter (applies within the active scope tab).
    const state = this.deps.state;
    const scopeTasks =
      state.contextDueFilter === "completed"
        ? fullCtx.scopes[state.contextTab]
        : ctx.scopes[state.contextTab];
    const filterRow = root.createDiv({ cls: "tg-duefilter" });
    const completedCount = this.filterByDue(
      fullCtx.scopes[state.contextTab],
      "completed"
    ).length;
    const completedActive = state.contextDueFilter === "completed";
    const completedToggle = filterRow.createDiv({
      cls:
        "tg-duefilter-seg tg-duefilter-icon" +
        (completedActive ? " is-active" : "") +
        (completedCount === 0 ? " is-empty" : ""),
    });
    setIcon(completedToggle, completedActive ? "eye" : "eye-off");
    completedToggle.setAttr(
      "aria-label",
      completedActive ? "Hide completed tasks" : "Show completed tasks"
    );
    completedToggle.onclick = () => {
      state.contextDueFilter = completedActive ? "all" : "completed";
      this.render();
    };

    for (const [key, label] of DUE_FILTERS) {
      const n = this.filterByDue(ctx.scopes[state.contextTab], key).length;
      const seg = filterRow.createDiv({
        cls:
          "tg-duefilter-seg" +
          (state.contextDueFilter === key ? " is-active" : "") +
          (key !== "all" && n === 0 ? " is-empty" : ""),
      });
      seg.setText(label);
      seg.onclick = () => {
        if (state.contextDueFilter === key) return;
        state.contextDueFilter = key;
        this.render();
      };
    }

    // Tri-state sort row (Priority · Due · Start · Age). Styled to line up with
    // the due-filter and scope-tab rows above/below it. Click cycles a key
    // asc (↑) -> desc (↓) -> off (natural scope order).
    const sortRow = root.createDiv({ cls: "tg-context-sort" });
    for (const [key, label] of SORT_OPTIONS) {
      const active = state.contextSortExplicit && state.contextSortBy === key;
      const seg = sortRow.createDiv({ cls: "tg-context-sort-seg" + (active ? " is-active" : "") });
      seg.createSpan({ text: label });
      if (active) {
        seg.createSpan({ cls: "tg-pill-dir", text: state.contextSortDir === "asc" ? "↑" : "↓" });
      }
      seg.onclick = () => this.cycleSort(key);
    }

    // Subtle filter tabs.
    const tabs = root.createDiv({ cls: "tg-tabs" });
    for (const [scope, label] of TABS) {
      const n = ctx.scopes[scope].length;
      const tab = tabs.createDiv({
        cls: "tg-tab" + (state.contextTab === scope ? " is-active" : "") + (n === 0 ? " is-empty" : ""),
      });
      tab.createSpan({ cls: "tg-tab-label", text: label });
      tab.createSpan({ cls: "tg-tab-count", text: String(n) });
      tab.onclick = () => {
        if (state.contextTab === scope) return;
        state.contextTab = scope;
        this.render();
      };
    }

    const tasks = this.applySort(this.filterByDue(scopeTasks, state.contextDueFilter));
    if (tasks.length === 0) {
      root.createDiv({ cls: "tg-empty", text: "Nothing in this view." });
      return;
    }

    const rowCtx = this.rowCtx();
    const list = root.createDiv({ cls: "tg-list" });
    for (const task of tasks) renderTaskRow(list, task, rowCtx);
  }
}
