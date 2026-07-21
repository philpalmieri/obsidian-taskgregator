import { App } from "obsidian";
import { TaskItem, TreeNode } from "./types";
import { TaskgregatorSettings } from "./settings";
import { scanVault, nodeKeyForFile } from "./parser";

export class TaskStore {
  app: App;
  settings: TaskgregatorSettings;
  tasks: Map<string, TaskItem> = new Map();

  constructor(app: App, settings: TaskgregatorSettings) {
    this.app = app;
    this.settings = settings;
  }

  async rebuild(): Promise<void> {
    const all = await scanVault(this.app, this.settings);
    this.tasks.clear();
    for (const t of all) this.tasks.set(t.id, t);
  }

  all(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  /** Open (actionable) tasks, honoring the showCompleted setting. */
  visible(): TaskItem[] {
    return this.all().filter((t) => {
      if (this.settings.showCompleted) return true;
      return t.status === "open" || t.status === "inProgress";
    });
  }

  byId(id: string): TaskItem | undefined {
    return this.tasks.get(id);
  }

  /**
   * Build the context tree: bucketRoot -> file -> tasks, with rolled-up open counts.
   * Inbox roots collapse to a single node per root (flat).
   */
  /**
   * Build the context tree: bucketRoot -> nested folders -> file -> tasks, with
   * rolled-up (deduped) open counts at every level. Inbox roots and the catch-all
   * "Other" root collapse to a single flat node.
   * Cross-index: a task that links to a file under a bucket root also appears under
   * that file's node, even when authored elsewhere.
   */
  buildContextTree(): TreeNode[] {
    const visible = this.visible();
    const rootsOrder = this.settings.bucketRoots.concat(
      this.settings.inboxRoots,
      ["Other"]
    );
    const nodeMap = new Map<string, TreeNode>();
    const directIds = new Map<string, Set<string>>();

    const ensureNode = (
      key: string,
      label: string,
      kind: TreeNode["kind"]
    ): TreeNode => {
      let n = nodeMap.get(key);
      if (!n) {
        n = { key, label, kind, children: [], taskIds: [], count: 0 };
        nodeMap.set(key, n);
        directIds.set(key, new Set());
      }
      return n;
    };

    // Resolve a file path to the node a task should attach to, creating the
    // root -> folder... -> file chain as needed.
    const fileNodeFor = (filePath: string): TreeNode => {
      const { rootName, flat } = nodeKeyForFile(filePath, this.settings);
      const root = ensureNode(rootName, rootName, "root");
      if (flat) return root;
      const parts = filePath.split("/");
      let parent = root;
      let parentKey = rootName;
      // Intermediate folders (between root and file).
      for (let i = 1; i < parts.length - 1; i++) {
        const folderKey = `${parentKey}/${parts[i]}`;
        let node = nodeMap.get(folderKey);
        if (!node) {
          node = ensureNode(folderKey, parts[i], "folder");
          parent.children.push(node);
        }
        parent = node;
        parentKey = folderKey;
      }
      const base = parts[parts.length - 1].replace(/\.md$/i, "");
      const fileKey = `${parentKey}/${base}`;
      let fileNode = nodeMap.get(fileKey);
      if (!fileNode) {
        fileNode = ensureNode(fileKey, base, "file");
        parent.children.push(fileNode);
      }
      return fileNode;
    };

    // Pass 1: authored location.
    for (const t of visible) {
      const node = fileNodeFor(t.filePath);
      directIds.get(node.key)!.add(t.id);
    }

    // Pass 2: cross-index by wikilink into the linked file's node.
    for (const t of visible) {
      for (const link of t.links) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(link, t.filePath);
        if (!dest) continue;
        const parts = dest.path.split("/");
        if (parts.length < 2 || !this.settings.bucketRoots.includes(parts[0])) continue;
        const node = fileNodeFor(dest.path);
        directIds.get(node.key)!.add(t.id);
      }
    }

    // Roll up counts (deduped) and sort, bottom-up.
    const rollup = (node: TreeNode): Set<string> => {
      const set = new Set<string>(directIds.get(node.key) || []);
      node.taskIds = Array.from(directIds.get(node.key) || []);
      for (const c of node.children) {
        for (const id of rollup(c)) set.add(id);
      }
      node.children.sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label)
      );
      node.count = set.size;
      return set;
    };

    const roots: TreeNode[] = [];
    for (const name of rootsOrder) {
      const r = nodeMap.get(name);
      if (!r) continue;
      rollup(r);
      roots.push(r);
    }
    return roots;
  }

  /** Tasks that reference a given file/person by wikilink (cross-index). */
  tasksLinking(nameOrPath: string): TaskItem[] {
    const target = nameOrPath.split("/").pop() || nameOrPath;
    return this.visible().filter((t) =>
      t.links.some((l) => l === nameOrPath || (l.split("/").pop() || l) === target)
    );
  }

  /** Tasks for a context-tree node key. */
  tasksForNode(node: TreeNode): TaskItem[] {
    const ids = new Set<string>(node.taskIds);
    const collect = (n: TreeNode) => {
      n.taskIds.forEach((id) => ids.add(id));
      n.children.forEach(collect);
    };
    collect(node);
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is TaskItem => !!t);
  }

  /** Tasks carrying a given tag (smart list). */
  tasksWithTag(tag: string): TaskItem[] {
    return this.visible().filter((t) => t.tags.includes(tag));
  }

  /** Tasks due on/before today (Today smart list core). */
  dueToday(): TaskItem[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.visible().filter((t) => t.meta.due && t.meta.due <= today);
  }

  counts() {
    const v = this.visible();
    return {
      total: v.length,
      today: this.dueToday().length,
      flagged: v.filter((t) => t.priority > 0 && t.priority <= 2).length,
    };
  }
}
