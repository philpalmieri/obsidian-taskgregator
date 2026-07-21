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
import { TaskgregatorView, VIEW_TYPE_TASKGREGATOR, ViewDeps, promptDate } from "./view";

export default class Taskgregator extends Plugin {
  settings!: TaskgregatorSettings;
  store!: TaskStore;
  writer!: TaskWriter;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new TaskStore(this.app, this.settings);
    this.writer = new TaskWriter(this.app, this.settings);

    const deps: ViewDeps = {
      store: this.store,
      writer: this.writer,
      settings: this.settings,
      reindexFile: async (path: string) => this.reindexFile(path),
      refresh: () => {
        void this.reindex();
      },
    };

    this.registerView(
      VIEW_TYPE_TASKGREGATOR,
      (leaf: WorkspaceLeaf) => new TaskgregatorView(leaf, deps)
    );

    this.addRibbonIcon("check-check", "Open Taskgregator", () => this.activateView());

    this.addCommand({
      id: "open",
      name: "Open panel",
      callback: () => this.activateView(),
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
      this.refreshViews();
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TASKGREGATOR, active: true });
    }
    await this.store.rebuild();
    this.refreshViews();
    await workspace.revealLeaf(leaf);
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
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKGREGATOR)) {
      const view = leaf.view;
      if (view instanceof TaskgregatorView) view.render();
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
