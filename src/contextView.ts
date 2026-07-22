import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { ViewDeps } from "./view";
import { computeContext, ContextScope } from "./context";
import { TaskRowCtx, renderTaskRow } from "./ui";

export const VIEW_TYPE_TASKGREGATOR_CONTEXT = "taskgregator-context-view";

const TABS: [ContextScope, string][] = [
  ["all", "All"],
  ["page", "Page"],
  ["section", "Section"],
  ["reference", "Reference"],
];

/**
 * A right-sidebar panel that follows the active file and shows the tasks in its
 * context: tasks on the page (or, for a folder note, the whole folder subtree)
 * plus tasks elsewhere that reference it. Reuses the hub view's task rows.
 */
export class TaskgregatorContextView extends ItemView {
  deps: ViewDeps;
  file: TFile | null = null;
  tab: ContextScope = "page";

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

  private rowCtx(): TaskRowCtx {
    return {
      app: this.app,
      writer: this.deps.writer,
      reindexFile: this.deps.reindexFile,
      rerender: () => this.render(),
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

    const header = root.createDiv({ cls: "tg-context-header" });
    const title = header.createDiv({ cls: "tg-context-title" });
    const ic = title.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, ctx.isFolderNote ? "folder" : "file-text");
    title.createSpan({ cls: "tg-context-name", text: ctx.title });
    header.createSpan({ cls: "tg-count", text: String(ctx.total) });
    root.createDiv({ cls: "tg-context-sub", text: ctx.subtitle });

    // Subtle filter tabs.
    const tabs = root.createDiv({ cls: "tg-tabs" });
    for (const [scope, label] of TABS) {
      const n = ctx.scopes[scope].length;
      const tab = tabs.createDiv({
        cls: "tg-tab" + (this.tab === scope ? " is-active" : "") + (n === 0 ? " is-empty" : ""),
      });
      tab.createSpan({ cls: "tg-tab-label", text: label });
      tab.createSpan({ cls: "tg-tab-count", text: String(n) });
      tab.onclick = () => {
        if (this.tab === scope) return;
        this.tab = scope;
        this.render();
      };
    }

    const tasks = ctx.scopes[this.tab];
    if (tasks.length === 0) {
      root.createDiv({ cls: "tg-empty", text: "Nothing in this view." });
      return;
    }

    const rowCtx = this.rowCtx();
    const list = root.createDiv({ cls: "tg-list" });
    for (const task of tasks) renderTaskRow(list, task, rowCtx);
  }
}
