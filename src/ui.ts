import { App, MarkdownView, Menu, Modal, TFile, setIcon } from "obsidian";
import { TaskItem } from "./types";
import { findTaskLine, TaskWriter } from "./writer";

/**
 * Shared task-row rendering used by both the full Taskgregator hub view and the
 * context sidebar. Kept UI-framework-free (just DOM) so either host can call it.
 */
export interface TaskRowCtx {
  app: App;
  writer: TaskWriter;
  reindexFile: (path: string) => Promise<void>;
  rerender: () => void;
  // Age (in days) at/above which the created-age chip turns "aged" (warning
  // color) instead of the neutral grey. Mirrors the Aging smart list threshold.
  agingDays: number;
  // Navigate to the in-plugin list for an inline #tag (host wires this to the
  // shared selection). Omitted callers fall back to Obsidian global search.
  onTagClick?: (tag: string) => void;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days between a YYYY-MM-DD date and today (0 if today, negative future). */
export function daysSince(date: string): number | undefined {
  const then = Date.parse(date + "T00:00:00");
  if (Number.isNaN(then)) return undefined;
  const now = Date.parse(todayStr() + "T00:00:00");
  return Math.round((now - then) / 86400000);
}

/** Human age label: "Today", "1 Day", "5 Days". */
export function formatAge(days: number): string {
  if (days <= 0) return "Today";
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}

export async function jumpToSource(app: App, task: TaskItem): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.filePath);
  if (!(file instanceof TFile)) return;

  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { active: true });
  if (!(leaf.view instanceof MarkdownView)) return;

  const editor = leaf.view.editor;
  const lines = editor.getValue().split("\n");
  const line = findTaskLine(lines, task);
  if (line < 0) return;

  const taskPrefix = lines[line].match(/^\s*[-*+]\s+\[.\]\s?/)?.[0];
  const cursor = { line, ch: taskPrefix?.length ?? 0 };
  editor.setCursor(cursor);
  editor.scrollIntoView(
    {
      from: { line, ch: 0 },
      to: { line, ch: lines[line].length },
    },
    true
  );
  editor.focus();
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
  renderTextWithLinks(ctx.app, textEl, task.text, task.links, ctx.onTagClick);

  // Meta row: context, dates, tags.
  const meta = body.createDiv({ cls: "tg-task-meta" });
  if (task.meta.created) {
    const days = daysSince(task.meta.created);
    if (days !== undefined) {
      const age = meta.createSpan({ cls: "tg-chip tg-age" });
      if (days >= Math.max(1, ctx.agingDays)) age.addClass("is-aged");
      age.setText("🌱 " + formatAge(days));
      age.setAttr("aria-label", "Created " + task.meta.created);
    }
  }
  const ctxChip = meta.createSpan({ cls: "tg-chip tg-ctx" });
  ctxChip.setText(`${task.bucketRoot}: ${task.bucketFile}`);
  ctxChip.onclick = () => void jumpToSource(ctx.app, task);
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

  // Actions menu (also available via right-click on the row).
  const more = row.createDiv({ cls: "tg-more" });
  setIcon(more, "more-horizontal");
  more.onclick = (e) => taskMenu(e, task, ctx);
  row.oncontextmenu = (e) => {
    e.preventDefault();
    taskMenu(e, task, ctx);
  };
}

function taskMenu(e: MouseEvent, task: TaskItem, ctx: TaskRowCtx): void {
  const menu = new Menu();

  // Priority: submenu if the platform supports it, else flat P1..P3 + None.
  menu.addItem((item) => {
    item.setTitle("Priority").setIcon("flag");
    const levels: Array<[string, number]> = [
      ["None", 0],
      ["P1 (high)", 1],
      ["P2 (medium)", 2],
      ["P3 (low)", 3],
    ];
    const setPrio = async (lvl: number) => {
      await ctx.writer.setPriority(task, lvl);
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    };
    const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
    if (sub) {
      for (const [label, lvl] of levels) {
        sub.addItem((s) =>
          s.setTitle(label).setChecked(task.priority === lvl).onClick(() => void setPrio(lvl))
        );
      }
    } else {
      item.onClick(() => {
        const cur = task.priority >= 1 && task.priority <= 3 ? task.priority : task.priority > 3 ? 3 : 0;
        void setPrio((cur + 1) % 4);
      });
    }
  });

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
    i
      .setTitle("Toggle #today")
      .setIcon("star")
      .setChecked(task.tags.includes("today"))
      .onClick(async () => {
        await ctx.writer.toggleTag(task, "today");
        await ctx.reindexFile(task.filePath);
        ctx.rerender();
      })
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Open detail note").setIcon("sticky-note").onClick(async () => {
      await ctx.writer.openSidecar(task);
      await ctx.reindexFile(task.filePath);
    })
  );
  menu.addItem((i) =>
    i
      .setTitle("Jump to source")
      .setIcon("arrow-up-right")
      .onClick(() => void jumpToSource(ctx.app, task))
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
  _links: string[],
  onTagClick?: (tag: string) => void
): void {
  // Render [[wikilinks]], Markdown inline links, and inline #tags as clickable
  // links; rest as plain text. The tag pattern mirrors the parser's TAG_RE: it
  // consumes the leading boundary (^ or whitespace) rather than a lookbehind
  // (unsupported on iOS < 16.4) and re-emits that whitespace as plain text.
  const re = /\[\[([^\]]+?)\]\]|\[([^\]\n]+?)\]\(([^)\s]+)\)|(^|\s)#([A-Za-z][\w\-/]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) el.appendText(text.slice(last, m.index));

    if (m[1] !== undefined) {
      renderWikilink(app, el, m[1]);
    } else if (m[2] !== undefined) {
      renderMarkdownLink(app, el, m[2], m[3]);
    } else if (m[5] !== undefined) {
      if (m[4]) el.appendText(m[4]);
      renderTag(app, el, m[5], onTagClick);
    }

    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

function renderWikilink(app: App, el: HTMLElement, linkText: string): void {
  const target = linkText.split("|")[0];
  const label = linkText.split("|")[1] || (target.split("/").pop() as string);
  const a = el.createEl("a", { cls: "tg-link internal-link", text: label });
  a.onclick = (ev) => {
    ev.preventDefault();
    void app.workspace.openLinkText(target, "", false);
  };
}

function renderMarkdownLink(app: App, el: HTMLElement, label: string, target: string): void {
  const external = /^(https?:|mailto:|obsidian:)/i.test(target);
  const a = el.createEl("a", {
    cls: external ? "tg-link external-link" : "tg-link internal-link",
    text: label,
  });

  if (external) {
    a.setAttr("href", target);
    a.setAttr("target", "_blank");
    a.setAttr("rel", "noopener noreferrer");
    a.onclick = (ev) => {
      ev.preventDefault();
      window.open(target, "_blank", "noopener");
    };
    return;
  }

  a.onclick = (ev) => {
    ev.preventDefault();
    void app.workspace.openLinkText(target, "", false);
  };
}

function renderTag(
  app: App,
  el: HTMLElement,
  tagName: string,
  onTagClick?: (tag: string) => void
): void {
  // Render as a native Obsidian tag pill (class "tag") so it matches how tags
  // look in normal page renders. Clicking navigates to that tag's in-plugin
  // list (via onTagClick); with no host callback we fall back to Obsidian's
  // global search, like a native tag. The compact meta-row chip is untouched.
  const a = el.createEl("a", { cls: "tag", text: "#" + tagName });
  a.setAttr("href", "#" + tagName);
  a.onclick = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (onTagClick) {
      onTagClick(tagName);
      return;
    }
    const search = (app as unknown as {
      internalPlugins?: {
        getPluginById?: (id: string) => { instance?: { openGlobalSearch?: (q: string) => void } } | null;
      };
    }).internalPlugins?.getPluginById?.("global-search")?.instance;
    search?.openGlobalSearch?.("tag:#" + tagName);
  };
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
