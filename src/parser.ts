import { App, TFile, TFolder } from "obsidian";
import { RawTaskMeta, TaskItem, TaskStatus } from "./types";
import { TaskgregatorSettings } from "./settings";

const TASK_RE = /^(\s*)[-*+]\s+\[(.)\]\s?(.*)$/;

const EMOJI = {
  due: "📅",
  start: "🛫",
  scheduled: "⏳",
  created: "➕",
  done: "✅",
  cancelled: "❌",
  recurrence: "🔁",
};

const PRIORITY_EMOJI: Record<string, number> = {
  "🔺": 1, // highest
  "⏫": 2, // high
  "🔼": 3, // medium
  "🔽": 5, // low
  "⏬": 6, // lowest
};

const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const BLOCKID_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z][\w\-/]*)/g;

export function statusFromChar(c: string): TaskStatus {
  switch (c) {
    case "x":
    case "X":
      return "done";
    case "-":
      return "cancelled";
    case "/":
      return "inProgress";
    case ">":
      return "forwarded";
    default:
      return "open";
  }
}

function normalizeLink(target: string): string {
  // Strip alias and heading/block refs, drop .md, keep the last path segment as name.
  let t = target.split("|")[0].split("#")[0].trim();
  t = t.replace(/\.md$/i, "");
  return t;
}

function dateAfter(text: string, emoji: string): string | undefined {
  const re = new RegExp(emoji + "\\s*" + DATE);
  const m = text.match(re);
  return m ? m[1] : undefined;
}

/**
 * Parse a single markdown line into a TaskItem, or null if it is not a task.
 */
export function parseLine(
  raw: string,
  filePath: string,
  line: number,
  settings: TaskgregatorSettings
): TaskItem | null {
  const m = raw.match(TASK_RE);
  if (!m) return null;

  const indent = m[1].length;
  const statusChar = m[2];
  let body = m[3];

  const status = statusFromChar(statusChar);

  // Block id.
  let blockId: string | undefined;
  const bidMatch = raw.match(BLOCKID_RE);
  if (bidMatch) blockId = bidMatch[1];
  body = body.replace(BLOCKID_RE, "");

  // Metadata dates.
  const meta: RawTaskMeta = {
    due: dateAfter(body, EMOJI.due),
    start: dateAfter(body, EMOJI.start),
    scheduled: dateAfter(body, EMOJI.scheduled),
    created: dateAfter(body, EMOJI.created),
    doneDate: dateAfter(body, EMOJI.done),
    cancelledDate: dateAfter(body, EMOJI.cancelled),
  };
  const recMatch = body.match(new RegExp(EMOJI.recurrence + "\\s*([^📅🛫⏳➕✅❌🔺⏫🔼🔽⏬]+)", "u"));
  if (recMatch) meta.recurrence = recMatch[1].trim();

  // Tags.
  const tags: string[] = [];
  let tm: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((tm = TAG_RE.exec(body)) !== null) {
    tags.push(tm[1]);
  }

  // Priority: emoji first, then priority tags.
  let priority = 0;
  for (const [em, p] of Object.entries(PRIORITY_EMOJI)) {
    if (body.includes(em)) {
      priority = p;
      break;
    }
  }
  if (priority === 0) {
    for (let i = 0; i < settings.priorityTags.length; i++) {
      if (tags.includes(settings.priorityTags[i])) {
        priority = i + 1;
        break;
      }
    }
  }

  // Links.
  const links: string[] = [];
  let lm: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((lm = WIKILINK_RE.exec(body)) !== null) {
    links.push(normalizeLink(lm[1]));
  }

  // Clean display text: strip emoji metadata + trailing dates + priority glyphs + tags.
  let text = body;
  for (const emoji of Object.values(EMOJI)) {
    text = text.replace(new RegExp(emoji + "\\s*" + DATE, "g"), "");
    text = text.replace(new RegExp(emoji, "g"), "");
  }
  for (const em of Object.keys(PRIORITY_EMOJI)) text = text.split(em).join("");
  text = text.replace(/\s{2,}/g, " ").trim();

  // Bucket context from the path.
  const { bucketRoot, bucketFile } = deriveBucket(filePath, settings);

  const id = blockId ? `${filePath}#^${blockId}` : `${filePath}:${line}`;

  return {
    id,
    blockId,
    hasBlockId: !!blockId,
    filePath,
    line,
    indent,
    statusChar,
    status,
    text,
    rawText: raw,
    tags,
    links,
    priority,
    meta,
    bucketRoot,
    bucketFile,
  };
}

export function deriveBucket(
  filePath: string,
  settings: TaskgregatorSettings
): { bucketRoot: string; bucketFile: string } {
  const parts = filePath.split("/");
  const base = parts[parts.length - 1].replace(/\.md$/i, "");
  const root = parts.length > 1 ? parts[0] : "Other";
  const known = settings.bucketRoots.concat(settings.inboxRoots);
  return {
    bucketRoot: known.includes(root) ? root : "Other",
    bucketFile: base,
  };
}

/**
 * Resolve a file path to its context-tree placement.
 * `flat` roots (inbox folders, and the catch-all "Other") group tasks directly
 * on the root node; everything else nests one node per folder segment down to
 * the file. `fileKey` is the key of the node the task attaches to.
 */
export function nodeKeyForFile(
  filePath: string,
  settings: TaskgregatorSettings
): { rootName: string; flat: boolean; fileKey: string } {
  const parts = filePath.split("/");
  const root = parts.length > 1 ? parts[0] : "Other";
  const inBucket = settings.bucketRoots.includes(root);
  const inInbox = settings.inboxRoots.includes(root);
  const rootName = inBucket || inInbox ? root : "Other";
  const flat = inInbox || rootName === "Other";
  const fileKey = flat ? rootName : filePath.replace(/\.md$/i, "");
  return { rootName, flat, fileKey };
}

function isIgnored(path: string, settings: TaskgregatorSettings): boolean {
  return settings.ignorePaths.some((p) => path.startsWith(p));
}

/**
 * Scan for tasks. To limit vault access to only what the plugin needs, this
 * walks the folders the user configured as bucket/inbox roots instead of
 * enumerating every file in the vault. Files outside those roots are never read.
 */
export async function scanVault(
  app: App,
  settings: TaskgregatorSettings
): Promise<TaskItem[]> {
  const files = collectScopedFiles(app, settings);
  const out: TaskItem[] = [];
  for (const file of files) {
    if (isIgnored(file.path, settings)) continue;
    const tasks = await scanFile(app, file, settings);
    out.push(...tasks);
  }
  return out;
}

/** Gather markdown files under the configured bucket/inbox roots only. */
function collectScopedFiles(app: App, settings: TaskgregatorSettings): TFile[] {
  const roots = new Set<string>([...settings.bucketRoots, ...settings.inboxRoots]);
  const seen = new Set<string>();
  const out: TFile[] = [];

  const walk = (folder: TFolder) => {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        walk(child);
      } else if (child instanceof TFile && child.extension === "md") {
        if (!seen.has(child.path)) {
          seen.add(child.path);
          out.push(child);
        }
      }
    }
  };

  for (const root of roots) {
    const dir = app.vault.getAbstractFileByPath(root.replace(/\/$/, ""));
    if (dir instanceof TFolder) walk(dir);
    else if (dir instanceof TFile && dir.extension === "md" && !seen.has(dir.path)) {
      seen.add(dir.path);
      out.push(dir);
    }
  }
  return out;
}

/** Scan a single file for tasks. */
export async function scanFile(
  app: App,
  file: TFile,
  settings: TaskgregatorSettings
): Promise<TaskItem[]> {
  if (isIgnored(file.path, settings)) return [];
  const content = await app.vault.cachedRead(file);
  const lines = content.split("\n");
  const out: TaskItem[] = [];
  const sidecarFolder = settings.sidecarFolder.replace(/\/$/, "");
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const task = parseLine(lines[i], file.path, i, settings);
    if (task) {
      if (task.blockId) {
        const sidecar = `${sidecarFolder}/task-${task.blockId}.md`;
        if (app.vault.getAbstractFileByPath(sidecar)) task.sidecarPath = sidecar;
      }
      out.push(task);
    }
  }
  return out;
}
