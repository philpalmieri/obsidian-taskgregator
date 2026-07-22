import { App, Menu, Modal, setIcon } from "obsidian";
import { TaskItem } from "./types";
import { TaskWriter } from "./writer";

/**
 * Shared task-row rendering used by both the full Taskgregator hub view and the
 * context sidebar. Kept UI-framework-free (just DOM) so either host can call it.
 */
export interface TaskRowCtx {
  app: App;
  writer: TaskWriter;
  reindexFile: (path: string) => Promise<void>;
  rerender: () => void;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function jumpToSource(app: App, task: TaskItem): void {
  const link = task.blockId ? `${task.filePath}#^${task.blockId}` : task.filePath;
  void app.workspace.openLinkText(link, "", false);
}

export function renderTaskRow(parent: HTMLElement, task: TaskItem, ctx: TaskRowCtx): void {
  const row = parent.createDiv({ cls: "tg-task" + (task.priority > 0 ? " has-prio" : "") });

  // Checkbox.
  const cb = row.createDiv({ cls: "tg-check" });
  cb.setAttr("data-status", task.statusChar);
  if (task.status === "done") cb.addClass("is-done");
  if (task.status === "inProgress") cb.addClass("is-doing");
  cb.onclick = async () => {
    await ctx.writer.toggleDone(task);
    await ctx.reindexFile(task.filePath);
    ctx.rerender();
  };

  // Body.
  const body = row.createDiv({ cls: "tg-task-body" });
  const textEl = body.createDiv({ cls: "tg-task-text" });
  if (task.status === "done" || task.status === "cancelled") textEl.addClass("is-struck");
  renderTextWithLinks(ctx.app, textEl, task.text, task.links);

  // Meta row: context, dates, tags.
  const meta = body.createDiv({ cls: "tg-task-meta" });
  const ctxChip = meta.createSpan({ cls: "tg-chip tg-ctx" });
  ctxChip.setText(`${task.bucketRoot}: ${task.bucketFile}`);
  ctxChip.onclick = () => jumpToSource(ctx.app, task);
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
      void ctx.writer.openPath(task.sidecarPath as string);
    };
  }

  // Priority flag.
  const flag = row.createDiv({ cls: "tg-prio p" + task.priority });
  setIcon(flag, "flag");
  flag.setAttr("aria-label", "Cycle priority");
  flag.onclick = async () => {
    const cur = task.priority >= 1 && task.priority <= 3 ? task.priority : task.priority > 3 ? 3 : 0;
    const next = (cur + 1) % 4;
    await ctx.writer.setPriority(task, next);
    await ctx.reindexFile(task.filePath);
    ctx.rerender();
  };

  // Actions menu.
  const more = row.createDiv({ cls: "tg-more" });
  setIcon(more, "more-horizontal");
  more.onclick = (e) => taskMenu(e, task, ctx);
}

function taskMenu(e: MouseEvent, task: TaskItem, ctx: TaskRowCtx): void {
  const menu = new Menu();
  menu.addItem((i) =>
    i.setTitle("Set due date").setIcon("calendar").onClick(async () => {
      const d = await promptDate(ctx.app, "Due date", task.meta.due);
      if (d !== undefined) {
        await ctx.writer.setDue(task, d);
        await ctx.reindexFile(task.filePath);
        ctx.rerender();
      }
    })
  );
  menu.addItem((i) =>
    i.setTitle("Set start date").setIcon("plane").onClick(async () => {
      const d = await promptDate(ctx.app, "Start date", task.meta.start);
      if (d !== undefined) {
        await ctx.writer.setStart(task, d);
        await ctx.reindexFile(task.filePath);
        ctx.rerender();
      }
    })
  );
  menu.addItem((i) =>
    i.setTitle("Open detail note").setIcon("sticky-note").onClick(async () => {
      await ctx.writer.openSidecar(task);
      await ctx.reindexFile(task.filePath);
    })
  );
  menu.addItem((i) =>
    i.setTitle("Jump to source").setIcon("arrow-up-right").onClick(() => jumpToSource(ctx.app, task))
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Cancel task").setIcon("x").onClick(async () => {
      await ctx.writer.setStatus(task, "-");
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    })
  );
  menu.showAtMouseEvent(e);
}

export function renderTextWithLinks(
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
      void app.workspace.openLinkText(target, "", false);
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
