import { App, PluginSettingTab, Setting } from "obsidian";
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
  ignorePaths: ["Archive/", "Templates/", ".obsidian/"],
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Taskgregator" });

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
            this.plugin.settings.smartLists = splitList(v)
              .map((pair) => {
                const [name, tag] = pair.split(":");
                return { name: (name || "").trim(), tag: (tag || "").trim().replace(/^#/, "") };
              })
              .filter((s) => s.name && s.tag);
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
