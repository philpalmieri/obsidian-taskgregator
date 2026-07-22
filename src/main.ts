import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Menu, Editor, MarkdownView, MarkdownFileInfo } from "obsidian";
import { TaskgregatorSettings, DEFAULT_SETTINGS, TaskgregatorSettingTab } from "./settings";
import { TaskStore } from "./store";
import { TaskWriter } from "./writer";
import {
  isTaskLine,
  applyPriorityToLine,
  applyDueToLine,
  toggleTagInLine,
  ensureBlockIdInLine,
  sidecarPathFor,
} from "./writer";
import { parseLine } from "./parser";
import { TaskgregatorView, VIEW_TYPE_TASKGREGATOR, ViewDeps } from "./view";
import { TaskgregatorNavView, VIEW_TYPE_TASKGREGATOR_NAV } from "./navView";
import { TaskgregatorState } from "./state";
import { promptDate } from "./ui";
import { TaskgregatorContextView, VIEW_TYPE_TASKGREGATOR_CONTEXT } from "./contextView";

export default class Taskgregator extends Plugin {
  settings!: TaskgregatorSettings;
  store!: TaskStore;
  writer!: TaskWriter;
  state!: TaskgregatorState;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new TaskStore(this.app, this.settings);
    this.writer = new TaskWriter(this.app, this.settings);
    this.state = new TaskgregatorState();

    const deps: ViewDeps = {
      store: this.store,
      writer: this.writer,
      settings: this.settings,
      state: this.state,
      reindexFile: async (path: string) => this.reindexFile(path),
      refresh: () => {
        void this.reindex();
      },
      openList: () => this.openList(),
      rerenderAll: () => this.refreshViews(),
    };

    this.registerView(
      VIEW_TYPE_TASKGREGATOR,
      (leaf: WorkspaceLeaf) => new TaskgregatorView(leaf, deps)
    );

    this.registerView(
      VIEW_TYPE_TASKGREGATOR_NAV,
      (leaf: WorkspaceLeaf) => new TaskgregatorNavView(leaf, deps)
    );

    this.registerView(
      VIEW_TYPE_TASKGREGATOR_CONTEXT,
      (leaf: WorkspaceLeaf) => new TaskgregatorContextView(leaf, deps)
    );

    this.addCommand({
      id: "open",
      name: "Open panel",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "open-context",
      name: "Open context sidebar",
      callback: () => this.activateContextView(),
    });

    this.addCommand({
      id: "reindex",
      name: "Reindex tasks",
      callback: () => this.reindex(),
    });

    this.addSettingTab(new TaskgregatorSettingTab(this.app, this));

    // Keep the index fresh as the vault changes (debounced).
    const onChange = (f: TAbstractFile) => {
      if (f instanceof TFile && f.extension === "md") this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(this.app.vault.on("rename", onChange));

    // Keep the context sidebar pointed at the active file. When one of our own
    // views is focused (nav/list), clear the sidebar instead of leaving the
    // previous page's tasks stranded (a plugin view isn't a note, so nothing
    // would otherwise refresh it).
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => this.onActiveLeafChange(leaf))
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateContextViews())
    );

    // Native right-click menu on any task line across the vault (continuity).
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        const file = info?.file;
        if (!file) return;
        const line = editor.getCursor().line;
        const text = editor.getLine(line);
        if (!isTaskLine(text)) return;
        this.addTaskMenuItems(menu, editor, line, file.path);
      })
    );

    this.app.workspace.onLayoutReady(async () => {
      await this.store.rebuild();
      // Dock the nav in the left sidebar so its tab icon sits at the top next
      // to Files/Search (no ribbon icon).
      await this.ensureNav();
      if (this.settings.enableContextSidebar) await this.activateContextView();
      this.refreshViews();
    });
  }

  /** Ensure the nav view exists in the left sidebar (without stealing focus). */
  private async ensureNav(): Promise<void> {
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR_NAV).length > 0) return;
    const nav = workspace.getLeftLeaf(false);
    if (nav) await nav.setViewState({ type: VIEW_TYPE_TASKGREGATOR_NAV });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    await this.store.rebuild();

    // Nav lives in the left dock.
    await this.ensureNav();
    const nav = workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR_NAV)[0] ?? null;

    // List lives in the center.
    await this.openList();
    this.refreshViews();
    if (nav) await workspace.revealLeaf(nav);
  }

  /** Ensure a center list leaf exists and reveal it. */
  async openList(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TASKGREGATOR, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateContextView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR_CONTEXT)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_TASKGREGATOR_CONTEXT, active: true });
    }
    this.updateContextViews();
    await workspace.revealLeaf(leaf);
  }

  private onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    const type = leaf?.view?.getViewType();
    // Focusing the plugin's own nav/list view: blank the context sidebar.
    if (type === VIEW_TYPE_TASKGREGATOR || type === VIEW_TYPE_TASKGREGATOR_NAV) {
      this.setContextFile(null);
      return;
    }
    // Focusing the context view itself: leave it on the current file.
    if (type === VIEW_TYPE_TASKGREGATOR_CONTEXT) return;
    this.updateContextViews();
  }

  private updateContextViews(): void {
    this.setContextFile(this.app.workspace.getActiveFile());
  }

  private setContextFile(file: TFile | null): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR_CONTEXT)) {
      const view = leaf.view;
      if (view instanceof TaskgregatorContextView) view.setFile(file);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.reindex();
    }, 600);
  }

  async reindex(): Promise<void> {
    await this.store.rebuild();
    this.refreshViews();
  }

  /** Rescan just one file, merging its tasks into the store, then refresh. */
  async reindexFile(_path: string): Promise<void> {
    // Simplicity + correctness: rebuild fully. Vault scans are cheap (cachedRead).
    await this.store.rebuild();
    this.refreshViews();
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR_NAV)) {
      const view = leaf.view;
      if (view instanceof TaskgregatorNavView) view.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR)) {
      const view = leaf.view;
      if (view instanceof TaskgregatorView) view.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR_CONTEXT)) {
      const view = leaf.view;
      if (view instanceof TaskgregatorContextView) view.render();
    }
  }

  private addTaskMenuItems(
    menu: Menu,
    editor: Editor,
    lineNo: number,
    filePath: string
  ): void {
    const get = () => editor.getLine(lineNo);
    const set = (l: string) => editor.setLine(lineNo, l);
    const titleOf = () => parseLine(get(), filePath, lineNo, this.settings)?.text || get();

    menu.addSeparator();

    // Priority: submenu if supported, otherwise flat items.
    menu.addItem((item) => {
      item.setTitle("Taskgregator: Priority").setIcon("flag");
      const levels: Array<[string, number]> = [
        ["None", 0],
        ["P1 (high)", 1],
        ["P2 (medium)", 2],
        ["P3 (low)", 3],
      ];
      const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      if (sub) {
        for (const [label, lvl] of levels) {
          sub.addItem((s) =>
            s.setTitle(label).onClick(() =>
              set(applyPriorityToLine(get(), lvl, this.settings.priorityTags))
            )
          );
        }
      } else {
        // Fallback: single click cycles priority.
        item.onClick(() => {
          const cur = parseLine(get(), filePath, lineNo, this.settings)?.priority ?? 0;
          const c = cur >= 1 && cur <= 3 ? cur : cur > 3 ? 3 : 0;
          set(applyPriorityToLine(get(), (c + 1) % 4, this.settings.priorityTags));
        });
      }
    });

    menu.addItem((i) =>
      i
        .setTitle("Taskgregator: Set due date…")
        .setIcon("calendar")
        .onClick(async () => {
          const d = await promptDate(this.app, "Due date");
          if (d !== undefined) set(applyDueToLine(get(), d));
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("Taskgregator: Toggle #today")
        .setIcon("star")
        .onClick(() => set(toggleTagInLine(get(), "today")))
    );

    menu.addItem((i) =>
      i
        .setTitle("Taskgregator: Open detail note")
        .setIcon("sticky-note")
        .onClick(async () => {
          const title = titleOf();
          const { line: stamped, blockId } = ensureBlockIdInLine(get());
          if (stamped !== get()) set(stamped);
          await this.writer.ensureSidecarFor(blockId, title, filePath);
          await this.writer.openPath(sidecarPathFor(this.settings, blockId));
        })
    );

    menu.addItem((i) =>
      i
        .setTitle("Taskgregator: Reveal in Taskgregator")
        .setIcon("check-check")
        .onClick(async () => {
          await this.activateView();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR)) {
            const v = leaf.view;
            if (v instanceof TaskgregatorView) v.revealTask(filePath);
          }
          this.refreshViews();
        })
    );
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<TaskgregatorSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.store) this.store.settings = this.settings;
    if (this.writer) this.writer.settings = this.settings;
    await this.reindex();
  }
}
