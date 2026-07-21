import { ItemView, Menu, Modal, WorkspaceLeaf, setIcon, App } from "obsidian";
import { TaskItem, TreeNode } from "./types";
import { TaskStore } from "./store";
import { TaskWriter } from "./writer";
import { deriveBucket } from "./parser";
import { TaskgregatorSettings } from "./settings";

export const VIEW_TYPE_TASKGREGATOR = "taskgregator-view";

type Selection =
  | { type: "today" }
  | { type: "all" }
  | { type: "flagged" }
  | { type: "smart"; tag: string; label: string }
  | { type: "node"; key: string; label: string };

export interface ViewDeps {
  store: TaskStore;
  writer: TaskWriter;
  settings: TaskgregatorSettings;
  reindexFile: (path: string) => Promise<void>;
  refresh: () => void;
}

export class TaskgregatorView extends ItemView {
  deps: ViewDeps;
  selection: Selection = { type: "today" };
  sidebarEl!: HTMLElement;
  mainEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
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
    root.addClass("taskgregator");
    const wrap = root.createDiv({ cls: "tg-wrap" });
    this.sidebarEl = wrap.createDiv({ cls: "tg-sidebar" });
    this.mainEl = wrap.createDiv({ cls: "tg-main" });
    this.render();
  }

  render(): void {
    this.renderSidebar();
    this.renderMain();
  }

  /** Focus the node that contains a given source file (used by external reveal). */
  revealTask(filePath: string): void {
    const { bucketRoot, bucketFile } = deriveBucket(filePath, this.deps.settings);
    if (this.deps.settings.inboxRoots.includes(bucketRoot)) {
      this.selection = { type: "node", key: bucketRoot, label: bucketRoot };
    } else {
      this.selection = {
        type: "node",
        key: `${bucketRoot}/${bucketFile}`,
        label: bucketFile,
      };
    }
    this.render();
  }

  private renderSidebar(): void {
    const el = this.sidebarEl;
    el.empty();
    const c = this.deps.store.counts();

    const header = el.createDiv({ cls: "tg-side-header" });
    header.createSpan({ text: "Taskgregator" });
    const reload = header.createSpan({ cls: "tg-icon-btn" });
    setIcon(reload, "refresh-cw");
    reload.setAttr("aria-label", "Reindex");
    reload.onclick = () => this.deps.refresh();

    const smart = el.createDiv({ cls: "tg-section" });
    this.sideItem(smart, "star", "Today", c.today, this.selection.type === "today", () => {
      this.selection = { type: "today" };
      this.render();
    });
    this.sideItem(smart, "flag", "Flagged", c.flagged, this.selection.type === "flagged", () => {
      this.selection = { type: "flagged" };
      this.render();
    });
    this.sideItem(smart, "inbox", "All", c.total, this.selection.type === "all", () => {
      this.selection = { type: "all" };
      this.render();
    });

    // Tag-driven smart lists.
    const lists = el.createDiv({ cls: "tg-section" });
    lists.createDiv({ cls: "tg-section-title", text: "Lists" });
    for (const sl of this.deps.settings.smartLists) {
      const n = this.deps.store.tasksWithTag(sl.tag).length;
      const active = this.selection.type === "smart" && this.selection.tag === sl.tag;
      this.sideItem(lists, sl.icon || "hash", sl.name, n, active, () => {
        this.selection = { type: "smart", tag: sl.tag, label: sl.name };
        this.render();
      });
    }

    // Context tree.
    const tree = el.createDiv({ cls: "tg-section" });
    tree.createDiv({ cls: "tg-section-title", text: "Context" });
    const roots = this.deps.store.buildContextTree();
    for (const r of roots) {
      if (r.count === 0) continue;
      this.renderTreeNode(tree, r, 0);
    }
  }

  private renderTreeNode(parent: HTMLElement, node: TreeNode, depth: number): void {
    const active =
      this.selection.type === "node" && this.selection.key === node.key;
    const row = parent.createDiv({ cls: "tg-tree-row" + (active ? " is-active" : "") });
    row.style.paddingLeft = 8 + depth * 14 + "px";
    const icon = node.kind === "root" ? "folder" : "file-text";
    const ic = row.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, icon);
    row.createSpan({ cls: "tg-tree-label", text: node.label });
    row.createSpan({ cls: "tg-badge", text: String(node.count) });
    row.onclick = () => {
      this.selection = { type: "node", key: node.key, label: node.label };
      this.render();
    };
    for (const child of node.children) {
      if (child.count === 0) continue;
      this.renderTreeNode(parent, child, depth + 1);
    }
  }

  private sideItem(
    parent: HTMLElement,
    icon: string,
    label: string,
    count: number,
    active: boolean,
    onClick: () => void
  ): void {
    const row = parent.createDiv({ cls: "tg-side-item" + (active ? " is-active" : "") });
    const ic = row.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, icon);
    row.createSpan({ cls: "tg-tree-label", text: label });
    if (count > 0) row.createSpan({ cls: "tg-badge", text: String(count) });
    row.onclick = onClick;
  }

  private currentTasks(): { title: string; tasks: TaskItem[] } {
    const s = this.selection;
    switch (s.type) {
      case "today":
        return { title: "Today", tasks: sortTasks(this.deps.store.dueToday()) };
      case "flagged":
        return {
          title: "Flagged",
          tasks: sortTasks(
            this.deps.store.visible().filter((t) => t.priority > 0 && t.priority <= 2)
          ),
        };
      case "all":
        return { title: "All tasks", tasks: sortTasks(this.deps.store.visible()) };
      case "smart":
        return { title: s.label, tasks: sortTasks(this.deps.store.tasksWithTag(s.tag)) };
      case "node": {
        const roots = this.deps.store.buildContextTree();
        const node = findNode(roots, s.key);
        const tasks = node ? this.deps.store.tasksForNode(node) : [];
        return { title: s.label, tasks: sortTasks(tasks) };
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
      el.createDiv({ cls: "tg-empty", text: "No tasks here. Nice." });
      return;
    }
    const list = el.createDiv({ cls: "tg-list" });
    for (const t of tasks) this.renderTaskRow(list, t);
  }

  private renderTaskRow(parent: HTMLElement, task: TaskItem): void {
    const row = parent.createDiv({ cls: "tg-task" + (task.priority > 0 ? " has-prio" : "") });

    // Checkbox.
    const cb = row.createDiv({ cls: "tg-check" });
    cb.setAttr("data-status", task.statusChar);
    if (task.status === "done") cb.addClass("is-done");
    if (task.status === "inProgress") cb.addClass("is-doing");
    cb.onclick = async () => {
      await this.deps.writer.toggleDone(task);
      await this.deps.reindexFile(task.filePath);
      this.render();
    };

    // Body.
    const body = row.createDiv({ cls: "tg-task-body" });
    const textEl = body.createDiv({ cls: "tg-task-text" });
    if (task.status === "done" || task.status === "cancelled") textEl.addClass("is-struck");
    renderTextWithLinks(this.app, textEl, task.text, task.links);

    // Meta row: context, dates, tags.
    const meta = body.createDiv({ cls: "tg-task-meta" });
    const ctx = meta.createSpan({ cls: "tg-chip tg-ctx" });
    ctx.setText(`${task.bucketRoot}: ${task.bucketFile}`);
    ctx.onclick = () => this.jumpToSource(task);
    if (task.meta.due) {
      const d = meta.createSpan({ cls: "tg-chip tg-due" });
      if (task.meta.due < todayStr()) d.addClass("is-overdue");
      d.setText("📅 " + task.meta.due);
    }
    if (task.meta.start) meta.createSpan({ cls: "tg-chip", text: "🛫 " + task.meta.start });
    for (const tag of task.tags) meta.createSpan({ cls: "tg-chip tg-tag", text: "#" + tag });
    if (task.sidecarPath) {
      const note = meta.createSpan({ cls: "tg-chip tg-note", text: "📝" });
      note.setAttr("aria-label", "Open detail note");
      note.onclick = (ev) => {
        ev.stopPropagation();
        this.deps.writer.openPath(task.sidecarPath as string);
      };
    }

    // Priority flag.
    const flag = row.createDiv({ cls: "tg-prio p" + task.priority });
    setIcon(flag, "flag");
    flag.setAttr("aria-label", "Cycle priority");
    flag.onclick = async () => {
      const cur = task.priority >= 1 && task.priority <= 3 ? task.priority : task.priority > 3 ? 3 : 0;
      const next = (cur + 1) % 4;
      await this.deps.writer.setPriority(task, next);
      await this.deps.reindexFile(task.filePath);
      this.render();
    };

    // Actions menu.
    const more = row.createDiv({ cls: "tg-more" });
    setIcon(more, "more-horizontal");
    more.onclick = (e) => this.taskMenu(e, task);
  }

  private taskMenu(e: MouseEvent, task: TaskItem): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle("Set due date").setIcon("calendar").onClick(async () => {
        const d = await promptDate(this.app, "Due date", task.meta.due);
        if (d !== undefined) {
          await this.deps.writer.setDue(task, d);
          await this.deps.reindexFile(task.filePath);
          this.render();
        }
      })
    );
    menu.addItem((i) =>
      i.setTitle("Set start date").setIcon("plane").onClick(async () => {
        const d = await promptDate(this.app, "Start date", task.meta.start);
        if (d !== undefined) {
          await this.deps.writer.setStart(task, d);
          await this.deps.reindexFile(task.filePath);
          this.render();
        }
      })
    );
    menu.addItem((i) =>
      i.setTitle("Open detail note").setIcon("sticky-note").onClick(async () => {
        await this.deps.writer.openSidecar(task);
        await this.deps.reindexFile(task.filePath);
      })
    );
    menu.addItem((i) =>
      i.setTitle("Jump to source").setIcon("arrow-up-right").onClick(() => this.jumpToSource(task))
    );
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle("Cancel task").setIcon("x").onClick(async () => {
        await this.deps.writer.setStatus(task, "-");
        await this.deps.reindexFile(task.filePath);
        this.render();
      })
    );
    menu.showAtMouseEvent(e);
  }

  private jumpToSource(task: TaskItem): void {
    const link = task.blockId
      ? `${task.filePath}#^${task.blockId}`
      : task.filePath;
    this.app.workspace.openLinkText(link, "", false);
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function sortTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks.slice().sort((a, b) => {
    const pa = a.priority || 99;
    const pb = b.priority || 99;
    if (pa !== pb) return pa - pb;
    const da = a.meta.due || "9999-99-99";
    const db = b.meta.due || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
}

function findNode(roots: TreeNode[], key: string): TreeNode | undefined {
  for (const r of roots) {
    if (r.key === key) return r;
    const found = findNode(r.children, key);
    if (found) return found;
  }
  return undefined;
}

function renderTextWithLinks(
  app: App,
  el: HTMLElement,
  text: string,
  _links: string[]
): void {
  // Render [[wikilinks]] as clickable internal links; rest as plain text.
  const re = /\[\[([^\]]+?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) el.appendText(text.slice(last, m.index));
    const target = m[1].split("|")[0];
    const label = m[1].split("|")[1] || (target.split("/").pop() as string);
    const a = el.createEl("a", { cls: "tg-link internal-link", text: label });
    a.onclick = (ev) => {
      ev.preventDefault();
      app.workspace.openLinkText(target, "", false);
    };
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

class DateModal extends Modal {
  value: string;
  label: string;
  resolve: (v: string | null | undefined) => void;

  constructor(app: App, label: string, initial: string | undefined, resolve: (v: string | null | undefined) => void) {
    super(app);
    this.label = label;
    this.value = initial || "";
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.label });
    const input = contentEl.createEl("input", { type: "date" });
    input.value = this.value;
    input.focus();
    const btns = contentEl.createDiv({ cls: "tg-modal-btns" });
    const save = btns.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = () => {
      this.resolve(input.value || null);
      this.close();
    };
    const clear = btns.createEl("button", { text: "Clear" });
    clear.onclick = () => {
      this.resolve(null);
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.resolve(input.value || null);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function promptDate(app: App, label: string, initial?: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const modal = new DateModal(app, label, initial, (v) => {
      settled = true;
      resolve(v);
    });
    const origClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      origClose();
      if (!settled) resolve(undefined);
    };
    modal.open();
  });
}
