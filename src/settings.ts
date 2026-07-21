import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type Taskgregator from "./main";

export interface SmartList {
  name: string;
  tag: string; // tag without leading '#'
  icon?: string;
}

export interface TaskgregatorSettings {
  // Folders whose files become top-level context buckets.
  bucketRoots: string[];
  // Glob-ish path prefixes to ignore entirely.
  ignorePaths: string[];
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
}

export const DEFAULT_SETTINGS: TaskgregatorSettings = {
  bucketRoots: ["Projects", "People", "Areas"],
  ignorePaths: ["Archive/", "Templates/"],
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
};

export class TaskgregatorSettingTab extends PluginSettingTab {
  plugin: Taskgregator;

  constructor(app: App, plugin: Taskgregator) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative definitions so the settings are indexed by Obsidian's settings
   * search on 1.13.0+. Rendering is still handled by display() below (which
   * keeps compatibility with older app versions). The array/CSV-backed values
   * are translated by getControlValue/setControlValue.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Bucket roots",
        desc: "Comma-separated top-level folders whose files become context buckets.",
        control: { type: "text", key: "bucketRoots" },
      },
      {
        name: "Inbox roots",
        desc: "Folders treated as a flat inbox (tasks grouped together, not per file). e.g. Dailies.",
        control: { type: "text", key: "inboxRoots" },
      },
      {
        name: "Ignore paths",
        desc: "Comma-separated path prefixes to exclude from indexing.",
        control: { type: "text", key: "ignorePaths" },
      },
      {
        name: "Priority tags",
        desc: "Highest-first, comma-separated (without #). e.g. p1, p2, p3.",
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
        name: "Show completed tasks",
        control: { type: "toggle", key: "showCompleted" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    switch (key) {
      case "bucketRoots":
        return s.bucketRoots.join(", ");
      case "inboxRoots":
        return s.inboxRoots.join(", ");
      case "ignorePaths":
        return s.ignorePaths.join(", ");
      case "priorityTags":
        return s.priorityTags.join(", ");
      case "smartLists":
        return s.smartLists.map((x) => `${x.name}:${x.tag}`).join(", ");
      case "sidecarFolder":
        return s.sidecarFolder;
      case "showCompleted":
        return s.showCompleted;
      default:
        return super.getControlValue(key);
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case "bucketRoots":
        s.bucketRoots = splitList(String(value));
        break;
      case "inboxRoots":
        s.inboxRoots = splitList(String(value));
        break;
      case "ignorePaths":
        s.ignorePaths = splitList(String(value));
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
      case "showCompleted":
        s.showCompleted = Boolean(value);
        break;
      default:
        await super.setControlValue(key, value);
        return;
    }
    await this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Context").setHeading();

    new Setting(containerEl)
      .setName("Bucket roots")
      .setDesc("Comma-separated top-level folders whose files become context buckets.")
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
      .setDesc("Folders treated as a flat inbox (tasks grouped together, not per file). e.g. Dailies.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.inboxRoots.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.inboxRoots = splitList(v);
            await this.plugin.saveSettings();
          })
      );

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
      .setName("Priority tags")
      .setDesc("Highest-first, comma-separated (without #). e.g. p1, p2, p3.")
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
      .setDesc("Cross-cutting tag lists. Format: Name:tag, comma-separated. e.g. Today:today, Follow-up:followup.")
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
      .setName("Show completed tasks")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showCompleted).onChange(async (v) => {
          this.plugin.settings.showCompleted = v;
          await this.plugin.saveSettings();
        })
      );

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

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSmartLists(v: string): SmartList[] {
  return splitList(v)
    .map((pair) => {
      const [name, tag] = pair.split(":");
      return { name: (name || "").trim(), tag: (tag || "").trim().replace(/^#/, "") };
    })
    .filter((s) => s.name && s.tag);
}
