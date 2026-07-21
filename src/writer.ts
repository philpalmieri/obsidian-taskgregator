import { App, TFile, normalizePath } from "obsidian";
import { TaskItem } from "./types";
import { TaskgregatorSettings } from "./settings";
import { statusFromChar } from "./parser";

export const EMOJI_DUE = "📅";
export const EMOJI_START = "🛫";
const EMOJI_DONE = "✅";
const EMOJI_CANCELLED = "❌";
const DATE_G = "\\d{4}-\\d{2}-\\d{2}";
// Tasks-plugin priority signifiers, highest first. Index 0 => level 1.
const PRIORITY_EMOJI = ["🔺", "⏫", "🔼"];
const ALL_PRIORITY_EMOJI = ["🔺", "⏫", "🔼", "🔽", "⏬"];
const CHECKBOX_RE = /^(\s*[-*+]\s+\[)(.)(\])/;

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isTaskLine(line: string): boolean {
  return CHECKBOX_RE.test(line);
}

export function generateBlockId(): string {
  return "tg" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export function blockIdOf(line: string): string | undefined {
  const m = line.match(/\s\^([A-Za-z0-9-]+)\s*$/);
  return m ? m[1] : undefined;
}

/** Append a signifier before a trailing block id, keeping ^id last. */
export function appendSignifier(line: string, sig: string): string {
  const m = line.match(/^(.*?)(\s\^[A-Za-z0-9-]+)\s*$/);
  if (m) {
    return `${m[1].trimEnd()} ${sig}${m[2]}`;
  }
  return `${line.trimEnd()} ${sig}`;
}

function stripDateSignifier(line: string, emoji: string): string {
  return line
    .replace(new RegExp(`\\s*${emoji}\\s*${DATE_G}`, "g"), "")
    .replace(new RegExp(`\\s*${emoji}`, "g"), "")
    .trimEnd();
}

function setDateSignifier(line: string, emoji: string, date: string | null): string {
  const stripped = stripDateSignifier(line, emoji);
  if (!date) return stripped;
  return appendSignifier(stripped, `${emoji} ${date}`);
}

// --- Pure line transforms (usable on raw strings, editor lines, or via vault) ---

export function applyStatusToLine(line: string, statusChar: string): string {
  let out = line.replace(CHECKBOX_RE, `$1${statusChar}$3`);
  const status = statusFromChar(statusChar);
  out = stripDateSignifier(out, EMOJI_DONE);
  out = stripDateSignifier(out, EMOJI_CANCELLED);
  if (status === "done") out = appendSignifier(out, `${EMOJI_DONE} ${todayStr()}`);
  if (status === "cancelled") out = appendSignifier(out, `${EMOJI_CANCELLED} ${todayStr()}`);
  return out;
}

export function applyPriorityToLine(
  line: string,
  priority: number,
  priorityTags: string[]
): string {
  let out = line;
  for (const tag of priorityTags) {
    out = out.replace(new RegExp(`(?:^|\\s)#${tag}\\b`, "g"), "");
  }
  for (const em of ALL_PRIORITY_EMOJI) out = out.split(em).join("");
  out = out.replace(/\s{2,}/g, " ").trimEnd();
  if (priority >= 1 && priority <= PRIORITY_EMOJI.length) {
    out = appendSignifier(out, PRIORITY_EMOJI[priority - 1]);
  }
  return out;
}

export function applyDueToLine(line: string, date: string | null): string {
  return setDateSignifier(line, EMOJI_DUE, date);
}

export function applyStartToLine(line: string, date: string | null): string {
  return setDateSignifier(line, EMOJI_START, date);
}

export function toggleTagInLine(line: string, tag: string): string {
  const bare = tag.replace(/^#/, "");
  const re = new RegExp(`(?:^|\\s)#${bare}\\b`);
  if (re.test(line)) {
    return line.replace(re, "").replace(/\s{2,}/g, " ").trimEnd();
  }
  return appendSignifier(line, `#${bare}`);
}

export function ensureBlockIdInLine(line: string): { line: string; blockId: string } {
  const existing = blockIdOf(line);
  if (existing) return { line, blockId: existing };
  const id = generateBlockId();
  return { line: line.trimEnd() + " ^" + id, blockId: id };
}

export function sidecarPathFor(settings: TaskgregatorSettings, blockId: string): string {
  return normalizePath(`${normalizePath(settings.sidecarFolder)}/task-${blockId}.md`);
}

/** Locate the exact line index for a task, resilient to small shifts. */
function findLine(lines: string[], task: TaskItem): number {
  if (task.blockId) {
    const needle = "^" + task.blockId;
    const idx = lines.findIndex((l) => l.trimEnd().endsWith(needle));
    if (idx >= 0) return idx;
  }
  if (lines[task.line] === task.rawText) return task.line;
  const byRaw = lines.findIndex((l) => l === task.rawText);
  if (byRaw >= 0) return byRaw;
  const bodyIdx = lines.findIndex((l) => l.includes(task.text) && /\[.\]/.test(l));
  return bodyIdx;
}

export class TaskWriter {
  app: App;
  settings: TaskgregatorSettings;

  constructor(app: App, settings: TaskgregatorSettings) {
    this.app = app;
    this.settings = settings;
  }

  private async editLine(
    task: TaskItem,
    transform: (line: string) => string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const idx = findLine(lines, task);
      if (idx < 0) return data;
      lines[idx] = transform(lines[idx]);
      return lines.join("\n");
    });
  }

  async setStatus(task: TaskItem, statusChar: string): Promise<void> {
    await this.editLine(task, (line) => applyStatusToLine(line, statusChar));
  }

  async toggleDone(task: TaskItem): Promise<void> {
    const next = task.status === "done" ? " " : "x";
    await this.setStatus(task, next);
  }

  async setDue(task: TaskItem, date: string | null): Promise<void> {
    await this.editLine(task, (line) => applyDueToLine(line, date));
  }

  async setStart(task: TaskItem, date: string | null): Promise<void> {
    await this.editLine(task, (line) => applyStartToLine(line, date));
  }

  async setPriority(task: TaskItem, priority: number): Promise<void> {
    await this.editLine(task, (line) =>
      applyPriorityToLine(line, priority, this.settings.priorityTags)
    );
  }

  async toggleTag(task: TaskItem, tag: string): Promise<void> {
    await this.editLine(task, (line) => toggleTagInLine(line, tag));
  }

  /** Ensure the task line carries a block id; returns the block id. */
  async ensureBlockId(task: TaskItem): Promise<string> {
    if (task.blockId) return task.blockId;
    const id = generateBlockId();
    await this.editLine(task, (line) => {
      if (blockIdOf(line)) return line;
      return line.trimEnd() + " ^" + id;
    });
    task.blockId = id;
    task.hasBlockId = true;
    task.id = `${task.filePath}#^${id}`;
    return id;
  }

  /** Ensure a sidecar detail note exists and return its path. */
  async ensureSidecar(task: TaskItem): Promise<string> {
    const blockId = await this.ensureBlockId(task);
    const path = await this.ensureSidecarFor(blockId, task.text, task.filePath);
    task.sidecarPath = path;
    return path;
  }

  /** Create (if missing) a sidecar for a known block id + source, return its path. */
  async ensureSidecarFor(
    blockId: string,
    title: string,
    sourcePath: string
  ): Promise<string> {
    const folder = normalizePath(this.settings.sidecarFolder);
    await this.ensureFolder(folder);
    const path = sidecarPathFor(this.settings, blockId);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!existing) {
      const link = `${sourcePath.replace(/\.md$/i, "")}#^${blockId}`;
      const body =
        `---\n` +
        `type: task-detail\n` +
        `task: "[[${link}]]"\n` +
        `source: "${sourcePath}"\n` +
        `blockId: "${blockId}"\n` +
        `created: ${todayStr()}\n` +
        `---\n\n` +
        `# ${title}\n\n` +
        `Source: [[${link}|open task]]\n\n` +
        `## Notes\n\n`;
      await this.app.vault.create(path, body);
    }
    return path;
  }

  async openSidecar(task: TaskItem): Promise<void> {
    const path = await this.ensureSidecar(task);
    await this.openPath(path);
  }

  async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e) {
          // Already exists / race; ignore.
        }
      }
    }
  }
}
