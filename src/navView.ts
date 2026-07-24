import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { TreeNode } from "./types";
import { ViewDeps } from "./view";

export const VIEW_TYPE_TASKGREGATOR_NAV = "taskgregator-nav-view";

/**
 * The navigator (left dock): smart lists (Today/Flagged/All + tag lists) and the
 * context tree. Choosing an item sets the shared selection and opens/reveals the
 * center list view.
 */
export class TaskgregatorNavView extends ItemView {
  deps: ViewDeps;
  private searchInput: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  private get state() {
    return this.deps.state;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKGREGATOR_NAV;
  }
  getDisplayText(): string {
    return "Tasks";
  }
  getIcon(): string {
    return "check-check";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("taskgregator", "tg-nav-view");
    this.render();
  }

  /** Set the selection, reveal the list, and re-render all views. */
  private choose(): void {
    void this.deps.openList();
    this.deps.rerenderAll();
  }

  render(): void {
    const el = this.contentEl;
    // Preserve search-box focus + caret across re-renders (e.g. background reindex).
    const prev = this.searchInput;
    const keepFocus = prev != null && document.activeElement === prev;
    const caret = prev ? prev.selectionStart : null;
    el.empty();
    const c = this.deps.store.counts();

    const header = el.createDiv({ cls: "tg-side-header" });
    header.createSpan({ text: "Taskgregator" });
    const reload = header.createSpan({ cls: "tg-icon-btn" });
    setIcon(reload, "refresh-cw");
    reload.setAttr("aria-label", "Reindex");
    reload.onclick = () => this.deps.refresh();

    this.renderSearch(el, keepFocus, caret);

    const smart = el.createDiv({ cls: "tg-section" });
    this.sideItem(smart, "star", "Today", c.today, this.state.selection.type === "today", () => {
      this.state.selection = { type: "today" };
      this.choose();
    });
    this.sideItem(smart, "sun", "Tomorrow", c.tomorrow, this.state.selection.type === "tomorrow", () => {
      this.state.selection = { type: "tomorrow" };
      this.choose();
    });
    this.sideItem(smart, "calendar-clock", "Soon", c.soon, this.state.selection.type === "soon", () => {
      this.state.selection = { type: "soon" };
      this.choose();
    });
    this.sideItem(smart, "flag", "Flagged", c.flagged, this.state.selection.type === "flagged", () => {
      this.state.selection = { type: "flagged" };
      this.choose();
    });
    this.sideItem(smart, "inbox", "All", c.total, this.state.selection.type === "all", () => {
      this.state.selection = { type: "all" };
      this.choose();
    });

    // Tag-driven smart lists.
    const lists = el.createDiv({ cls: "tg-section" });
    lists.createDiv({ cls: "tg-section-title", text: "Lists" });
    for (const sl of this.deps.settings.smartLists) {
      const n = this.deps.store.tasksWithTag(sl.tag).length;
      const active = this.state.selection.type === "smart" && this.state.selection.tag === sl.tag;
      this.sideItem(lists, sl.icon || "hash", sl.name, n, active, () => {
        this.state.selection = { type: "smart", tag: sl.tag, label: sl.name };
        this.choose();
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

  /** The search box (under the title). Filters the current selection's tasks. */
  private renderSearch(el: HTMLElement, keepFocus: boolean, caret: number | null): void {
    const wrap = el.createDiv({ cls: "tg-search" });
    const input = wrap.createEl("input", {
      cls: "tg-search-input",
      attr: { type: "text", placeholder: "Search tasks…", spellcheck: "false" },
    });
    input.value = this.state.searchQuery;
    this.searchInput = input;

    const clearBtn = wrap.createSpan({ cls: "tg-search-x", attr: { "aria-label": "Clear search" } });
    setIcon(clearBtn, "x");
    clearBtn.toggle(this.state.searchQuery.length > 0);

    const apply = (query: string): void => {
      this.state.searchQuery = query;
      clearBtn.toggle(query.length > 0);
      // Ensure the list is visible, then re-render only the list so this input
      // keeps focus while typing.
      void this.deps.openList();
      this.deps.rerenderList();
    };

    const clear = (): void => {
      input.value = "";
      this.state.searchQuery = "";
      this.deps.rerenderAll();
    };

    input.addEventListener("input", () => apply(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") clear();
    });
    clearBtn.onclick = () => clear();

    if (keepFocus) {
      input.focus();
      const pos = caret ?? input.value.length;
      input.setSelectionRange(pos, pos);
    }
  }

  private renderTreeNode(parent: HTMLElement, node: TreeNode, depth: number): void {
    const active = this.state.selection.type === "node" && this.state.selection.key === node.key;
    const hasChildren = node.children.some((c) => c.count > 0);
    const isCollapsed = this.state.collapsed.has(node.key);

    const row = parent.createDiv({ cls: "tg-tree-row" + (active ? " is-active" : "") });
    row.style.paddingLeft = 8 + depth * 14 + "px";

    // Twisty (caret) toggles collapse without changing selection.
    const twisty = row.createSpan({ cls: "tg-twisty" });
    if (hasChildren) {
      setIcon(twisty, isCollapsed ? "chevron-right" : "chevron-down");
      twisty.onclick = (e) => {
        e.stopPropagation();
        if (isCollapsed) this.state.collapsed.delete(node.key);
        else this.state.collapsed.add(node.key);
        this.render();
      };
    } else {
      twisty.addClass("tg-twisty-empty");
    }

    const icon = node.kind === "root" || node.kind === "folder" ? "folder" : "file-text";
    const ic = row.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, icon);
    row.createSpan({ cls: "tg-tree-label", text: node.label });
    row.createSpan({ cls: "tg-badge", text: String(node.count) });
    row.onclick = () => {
      this.state.selection = { type: "node", key: node.key, label: node.label };
      this.choose();
    };

    if (isCollapsed) return;
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
}
