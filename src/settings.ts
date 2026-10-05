import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type Taskgregator from "./main";

export type StartupView = "disabled" | "today" | "all" | "flagged";
export type ScanScope = "contextRoots" | "wholeVault";

// How Taskgregator writes task metadata. "auto" defers to the Tasks plugin's
// configured format (falling back to emoji when Tasks isn't installed/readable).
export type TaskFormatSetting = "auto" | "emoji" | "dataview";

export interface SmartList {
  name: string;
  tag: string; // tag without leading '#'
  icon?: string;
}

export interface TaskgregatorSettings {
  // Folders whose files become top-level context buckets.
  bucketRoots: string[];
  // Whether to scan only configured roots or every markdown file in the vault.
  scanScope: ScanScope;
  // Whether to show the context tree in the navigator.
  showContextTree: boolean;
  // Glob-ish path prefixes to ignore entirely.
  ignorePaths: string[];
  // Frontmatter tags that exclude an entire file from task scanning.
  ignoreFileTags: string[];
  // Exact frontmatter property rules in key=value form.
  ignoreFileProperties: string[];
  // Treat these bucket roots as "inbox" style (group all tasks flat, not per-file).
  inboxRoots: string[];
  // Priority tags in order of importance (highest first).
  priorityTags: string[];
  // Cross-cutting smart lists driven by tags.
  smartLists: SmartList[];
  // Folder for per-task detail notes (sidecars).
  sidecarFolder: string;
  // Date format used when writing dates (Tasks-plugin default is YYYY-MM-DD).
  dateFormat: string;
  // Include completed tasks in the index/UI.
  showCompleted: boolean;
  // Emoji signifiers (Tasks-plugin compatible).
  useEmojiMetadata: boolean;
  // Auto-open the context sidebar (follows the active file) on startup.
  enableContextSidebar: boolean;
  // Which list the main Taskgregator panel opens to on startup ("disabled" = don't auto-open).
  startupView: StartupView;
  // "Soon" smart-list window in days (tasks due within the next N days).
  soonDays: number;
  // "Aging" smart-list threshold in days: still-open tasks created this many
  // days ago or older are surfaced as aging.
  agingDays: number;
  // Metadata format written to task lines. "auto" follows the Tasks plugin.
  // Reading is always dual-format; this only affects lines with no existing
  // metadata (existing emoji/dataview lines keep their own format).
  taskFormat: TaskFormatSetting;
  // Pop the changelog in a modal the first time the plugin loads after an update.
  showChangelogOnUpdate: boolean;
  // Last plugin version whose changelog was shown (internal; not user-facing).
  lastSeenVersion: string;
}

export const DEFAULT_SETTINGS: TaskgregatorSettings = {
  bucketRoots: ["Projects", "People", "Areas"],
  scanScope: "contextRoots",
  showContextTree: true,
  ignorePaths: ["Archive/", "Templates/"],
  ignoreFileTags: [],
  ignoreFileProperties: [],
  inboxRoots: ["Dailies"],
  priorityTags: ["p1", "p2", "p3"],
  smartLists: [
    { name: "Today", tag: "today", icon: "star" },
    { name: "Follow-up", tag: "followup", icon: "reply" },
    { name: "Snippet Ideas", tag: "snippetIdea", icon: "lightbulb" },
    { name: "Someday", tag: "someday", icon: "clock" },
  ],
  sidecarFolder: "Taskgregator/tasksData",
  dateFormat: "YYYY-MM-DD",
  showCompleted: false,
  useEmojiMetadata: true,
  enableContextSidebar: true,
  startupView: "disabled",
  soonDays: 7,
  agingDays: 14,
  taskFormat: "auto",
  showChangelogOnUpdate: true,
  lastSeenVersion: "",
};

export class TaskgregatorSettingTab extends PluginSettingTab {
  plugin: Taskgregator;

  constructor(app: App, plugin: Taskgregator) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings for Obsidian 1.13+. display() below keeps compatibility
   * with older app versions. Array-backed values are translated by the control
   * accessors.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Indexing",
        items: [
          {
            name: "Indexing scope",
            desc: "Scan configured context roots or every Markdown file in the vault.",
            control: {
              type: "dropdown",
              key: "scanScope",
              options: { contextRoots: "Context roots", wholeVault: "Whole vault" },
            },
          },
          {
            name: "Context roots",
            desc: "Comma-separated top-level folders whose files become navigation contexts.",
            control: { type: "text", key: "bucketRoots" },
            visible: () => this.plugin.settings.scanScope === "contextRoots",
          },
          {
            name: "Inbox roots",
            desc: "Folders treated as a flat inbox (tasks grouped together, not per file). E.g. Dailies.",
            control: { type: "text", key: "inboxRoots" },
            visible: () => this.plugin.settings.scanScope === "contextRoots",
          },
        ],
      },
      {
        type: "group",
        heading: "Exclusions",
        items: [
          {
            name: "Ignore paths",
            desc: "Comma-separated path prefixes to exclude from indexing.",
            control: { type: "text", key: "ignorePaths" },
          },
          {
            name: "Ignore file tags",
            desc: "Comma-separated frontmatter tags whose files should not be scanned.",
            control: { type: "text", key: "ignoreFileTags" },
          },
          {
            name: "Ignore file properties",
            desc: "Frontmatter rules in key=value form, one per line. Any match excludes the file.",
            control: { type: "textarea", key: "ignoreFileProperties" },
          },
        ],
      },
      {
        type: "group",
        heading: "Lists and task behavior",
        items: [
          {
            name: "Priority tags",
            desc: "Highest-first, comma-separated (without #). E.g. p1, p2, p3.",
            control: { type: "text", key: "priorityTags" },
          },
          {
            name: "Smart lists",
            desc: "Cross-cutting tag lists. Format: Name:tag, comma-separated.",
            control: { type: "textarea", key: "smartLists" },
          },
          {
            name: "Detail-note folder",
            desc: "Where per-task detail notes (sidecars) are stored.",
            control: { type: "text", key: "sidecarFolder" },
          },
          {
            name: "Soon window (days)",
            desc: "Soon list shows tasks due within this many days (default 7).",
            control: { type: "text", key: "soonDays" },
          },
          {
            name: "Aging threshold (days)",
            desc: "Aging list shows still-open tasks created this many days ago or older (default 14).",
            control: { type: "text", key: "agingDays" },
          },
          {
            name: "Show completed tasks",
            control: { type: "toggle", key: "showCompleted" },
          },
          {
            name: "Task metadata format",
            desc: "How new dates/priority are written. Auto follows the Tasks plugin (emoji if not installed). Reading always supports both.",
            control: {
              type: "dropdown",
              key: "taskFormat",
              options: {
                auto: "Auto (follow Tasks plugin)",
                emoji: "Emoji (Tasks)",
                dataview: "Dataview",
              },
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Interface",
        items: [
          {
            name: "Show context tree",
            desc: "Show configured contexts and their nested task counts in the navigator.",
            control: { type: "toggle", key: "showContextTree" },
            visible: () => this.plugin.settings.scanScope === "contextRoots",
          },
          {
            name: "Context sidebar",
            desc: "Auto-open the file-context task panel in the right sidebar on startup.",
            control: { type: "toggle", key: "enableContextSidebar" },
          },
          {
            name: "Show changelog on update",
            desc: "Show the changelog automatically the first time the plugin loads after an update.",
            control: { type: "toggle", key: "showChangelogOnUpdate" },
          },
          {
            name: "Load Taskgregator on startup",
            desc: "Open the main Taskgregator panel to a list automatically when Obsidian starts.",
            control: {
              type: "dropdown",
              key: "startupView",
              options: {
                disabled: "Disabled",
                today: "Today",
                all: "All",
                flagged: "Flagged",
              },
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    switch (key) {
      case "scanScope":
        return s.scanScope;
      case "bucketRoots":
        return s.bucketRoots.join(", ");
      case "showContextTree":
        return s.showContextTree;
      case "inboxRoots":
        return s.inboxRoots.join(", ");
      case "ignorePaths":
        return s.ignorePaths.join(", ");
      case "ignoreFileTags":
        return s.ignoreFileTags.join(", ");
      case "ignoreFileProperties":
        return s.ignoreFileProperties.join("\n");
      case "priorityTags":
        return s.priorityTags.join(", ");
      case "smartLists":
        return s.smartLists.map((x) => `${x.name}:${x.tag}`).join(", ");
      case "sidecarFolder":
        return s.sidecarFolder;
      case "soonDays":
        return String(s.soonDays);
      case "agingDays":
        return String(s.agingDays);
      case "showCompleted":
        return s.showCompleted;
      case "enableContextSidebar":
        return s.enableContextSidebar;
      case "showChangelogOnUpdate":
        return s.showChangelogOnUpdate;
      case "startupView":
        return s.startupView;
      case "taskFormat":
        return s.taskFormat;
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case "scanScope":
        s.scanScope = normalizeScanScope(value);
        break;
      case "bucketRoots":
        s.bucketRoots = splitList(String(value));
        break;
      case "showContextTree":
        s.showContextTree = Boolean(value);
        break;
      case "inboxRoots":
        s.inboxRoots = splitList(String(value));
        break;
      case "ignorePaths":
        s.ignorePaths = splitList(String(value));
        break;
      case "ignoreFileTags":
        s.ignoreFileTags = splitList(String(value)).map(normalizeTag);
        break;
      case "ignoreFileProperties":
        s.ignoreFileProperties = splitRules(String(value));
        break;
      case "priorityTags":
        s.priorityTags = splitList(String(value)).map((x) => x.replace(/^#/, ""));
        break;
      case "smartLists":
        s.smartLists = parseSmartLists(String(value));
        break;
      case "sidecarFolder":
        s.sidecarFolder = String(value).trim().replace(/\/$/, "");
        break;
      case "soonDays":
        s.soonDays = clampDays(value);
        break;
      case "agingDays":
        s.agingDays = clampDays(value, 14);
        break;
      case "showCompleted":
        s.showCompleted = Boolean(value);
        break;
      case "enableContextSidebar":
        s.enableContextSidebar = Boolean(value);
        break;
      case "showChangelogOnUpdate":
        s.showChangelogOnUpdate = Boolean(value);
        break;
      case "startupView":
        s.startupView = normalizeStartupView(value);
        break;
      case "taskFormat":
        s.taskFormat = normalizeTaskFormat(value);
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
    if (key === "scanScope") {
      (this as unknown as { refreshDomState?: () => void }).refreshDomState?.();
    }
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Indexing").setHeading();

    new Setting(containerEl)
      .setName("Indexing scope")
      .setDesc("Scan configured context roots or every Markdown file in the vault.")
      .addDropdown((dd) =>
        dd
          .addOption("contextRoots", "Context roots")
          .addOption("wholeVault", "Whole vault")
          .setValue(this.plugin.settings.scanScope)
          .onChange(async (v) => {
            this.plugin.settings.scanScope = normalizeScanScope(v);
            await this.plugin.saveSettings();
            this.renderSettings();
          })
      );

    if (this.plugin.settings.scanScope === "contextRoots") {
      new Setting(containerEl)
        .setName("Context roots")
        .setDesc("Comma-separated top-level folders whose files become navigation contexts.")
        .addText((t) =>
          t
            .setValue(this.plugin.settings.bucketRoots.join(", "))
            .onChange(async (v) => {
              this.plugin.settings.bucketRoots = splitList(v);
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Inbox roots")
        .setDesc("Folders treated as a flat inbox (tasks grouped together, not per file). E.g. Dailies.")
        .addText((t) =>
          t
            .setValue(this.plugin.settings.inboxRoots.join(", "))
            .onChange(async (v) => {
              this.plugin.settings.inboxRoots = splitList(v);
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl).setName("Exclusions").setHeading();

    new Setting(containerEl)
      .setName("Ignore paths")
      .setDesc("Comma-separated path prefixes to exclude from indexing.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.ignorePaths.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.ignorePaths = splitList(v);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ignore file tags")
      .setDesc(
        "Comma-separated frontmatter tags whose files should not be scanned. " +
          "For example: template, checklist, reference."
      )
      .addText((t) =>
        t
          .setValue(this.plugin.settings.ignoreFileTags.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.ignoreFileTags = splitList(v).map(normalizeTag);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ignore file properties")
      .setDesc(
        "Exact frontmatter rules in key=value form, one per line. " +
          "For example: type=template or tasks=false. Any match excludes the entire file."
      )
      .addTextArea((t) =>
        t
          .setValue(this.plugin.settings.ignoreFileProperties.join("\n"))
          .onChange(async (v) => {
            this.plugin.settings.ignoreFileProperties = splitRules(v);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Lists and task behavior").setHeading();

    new Setting(containerEl)
      .setName("Priority tags")
      .setDesc("Highest-first, comma-separated without #, for example p1, p2, p3.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.priorityTags.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.priorityTags = splitList(v).map((s) => s.replace(/^#/, ""));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Smart lists")
      .setDesc("Cross-cutting tag lists as name:tag pairs, comma-separated. For example: today:today, followup:someday.")
      .addTextArea((t) =>
        t
          .setValue(
            this.plugin.settings.smartLists.map((s) => `${s.name}:${s.tag}`).join(", ")
          )
          .onChange(async (v) => {
            this.plugin.settings.smartLists = parseSmartLists(v);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Detail-note folder")
      .setDesc("Where per-task detail notes (sidecars) are stored.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.sidecarFolder)
          .onChange(async (v) => {
            this.plugin.settings.sidecarFolder = v.trim().replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Soon window (days)")
      .setDesc("Soon list shows tasks due within this many days (default 7).")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.soonDays))
          .onChange(async (v) => {
            this.plugin.settings.soonDays = clampDays(v);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Aging threshold (days)")
      .setDesc("Aging list shows still-open tasks created this many days ago or older (default 14).")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.agingDays))
          .onChange(async (v) => {
            this.plugin.settings.agingDays = clampDays(v, 14);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show completed tasks")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showCompleted).onChange(async (v) => {
          this.plugin.settings.showCompleted = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Task metadata format")
      .setDesc(
        "How Taskgregator writes dates and priority on new/edited tasks. " +
          "Auto follows the Tasks plugin's format (emoji if Tasks isn't installed). " +
          "Reading always understands both emoji and Dataview; existing lines keep their own format."
      )
      .addDropdown((dd) =>
        dd
          .addOption("auto", "Auto (follow Tasks plugin)")
          .addOption("emoji", "Emoji (Tasks)")
          .addOption("dataview", "Dataview")
          .setValue(this.plugin.settings.taskFormat)
          .onChange(async (v) => {
            this.plugin.settings.taskFormat = normalizeTaskFormat(v);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Interface").setHeading();

    if (this.plugin.settings.scanScope === "contextRoots") {
      new Setting(containerEl)
        .setName("Show context tree")
        .setDesc("Show configured contexts and their nested task counts in the navigator.")
        .addToggle((tg) =>
          tg.setValue(this.plugin.settings.showContextTree).onChange(async (v) => {
            this.plugin.settings.showContextTree = v;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(containerEl)
      .setName("Context sidebar")
      .setDesc(
        "Auto-open the file-context task panel in the right sidebar on startup. " +
          "The panel follows the active note; for a folder note (filename matches its folder) it scopes to the whole folder subtree."
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableContextSidebar).onChange(async (v) => {
          this.plugin.settings.enableContextSidebar = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show changelog on update")
      .setDesc("Show the changelog automatically the first time the plugin loads after an update.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showChangelogOnUpdate).onChange(async (v) => {
          this.plugin.settings.showChangelogOnUpdate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Load Taskgregator on startup")
      .setDesc("Open the main Taskgregator panel to a list automatically when Obsidian starts.")
      .addDropdown((dd) =>
        dd
          .addOption("disabled", "Disabled")
          .addOption("today", "Today")
          .addOption("all", "All")
          .addOption("flagged", "Flagged")
          .setValue(this.plugin.settings.startupView)
          .onChange(async (v) => {
            this.plugin.settings.startupView = normalizeStartupView(v);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Maintenance").setHeading();

    new Setting(containerEl)
      .setName("Reindex now")
      .setDesc("Rescan the vault for tasks.")
      .addButton((b) =>
        b.setButtonText("Reindex").onClick(async () => {
          await this.plugin.reindex();
        })
      );
  }
}

function normalizeStartupView(value: unknown): StartupView {
  const v = String(value);
  return v === "today" || v === "all" || v === "flagged" ? v : "disabled";
}

function normalizeScanScope(value: unknown): ScanScope {
  return value === "wholeVault" ? "wholeVault" : "contextRoots";
}

function normalizeTaskFormat(value: unknown): TaskFormatSetting {
  const v = String(value);
  return v === "emoji" || v === "dataview" ? v : "auto";
}

function clampDays(value: unknown, fallback = 7): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 365);
}

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitRules(v: string): string[] {
  return v
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s.includes("=") && s.length > 2);
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, "").toLowerCase();
}

function parseSmartLists(v: string): SmartList[] {
  return splitList(v)
    .map((pair) => {
      const [name, tag] = pair.split(":");
      return { name: (name || "").trim(), tag: (tag || "").trim().replace(/^#/, "") };
    })
    .filter((s) => s.name && s.tag);
}
