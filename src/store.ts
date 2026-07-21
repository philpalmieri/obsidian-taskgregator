import { App } from "obsidian";
import { TaskItem, TreeNode } from "./types";
import { TaskgregatorSettings } from "./settings";
import { scanVault } from "./parser";

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
   * Build the context tree: bucketRoot -> file -> tasks, with rolled-up open counts.
   * Inbox roots collapse to a single node per root (flat).
   * Cross-index: a task that links to a file under a bucket root also appears under
   * that file's node, even when authored elsewhere.
   */
  buildContextTree(): TreeNode[] {
    const visible = this.visible();
    const rootsOrder = this.settings.bucketRoots.concat(
      this.settings.inboxRoots,
      ["Other"]
    );
    const rootMap = new Map<string, TreeNode>();
    // Track membership as Sets to dedupe authored + linked tasks per node.
    const nodeIds = new Map<string, Set<string>>();

    const getRoot = (name: string): TreeNode => {
      let r = rootMap.get(name);
      if (!r) {
        r = { key: name, label: name, kind: "root", children: [], taskIds: [], count: 0 };
        rootMap.set(name, r);
        nodeIds.set(r.key, new Set());
      }
      return r;
    };

    const getFileNode = (root: TreeNode, rootName: string, fileBase: string): TreeNode => {
      const fileKey = `${rootName}/${fileBase}`;
      let fileNode = root.children.find((c) => c.key === fileKey);
      if (!fileNode) {
        fileNode = {
          key: fileKey,
          label: fileBase,
          kind: "file",
          children: [],
          taskIds: [],
          count: 0,
        };
        root.children.push(fileNode);
        nodeIds.set(fileNode.key, new Set());
      }
      return fileNode;
    };

    // Pass 1: authored location.
    for (const t of visible) {
      const root = getRoot(t.bucketRoot);
      const isInbox = this.settings.inboxRoots.includes(t.bucketRoot);
      if (isInbox) {
        nodeIds.get(root.key)!.add(t.id);
      } else {
        const fileNode = getFileNode(root, t.bucketRoot, t.bucketFile);
        nodeIds.get(fileNode.key)!.add(t.id);
      }
    }

    // Pass 2: cross-index by wikilink into the linked file's node.
    for (const t of visible) {
      for (const link of t.links) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(link, t.filePath);
        if (!dest) continue;
        const parts = dest.path.split("/");
        if (parts.length < 2) continue;
        const rootName = parts[0];
        if (!this.settings.bucketRoots.includes(rootName)) continue;
        const fileBase = parts[parts.length - 1].replace(/\.md$/i, "");
        const root = getRoot(rootName);
        const fileNode = getFileNode(root, rootName, fileBase);
        nodeIds.get(fileNode.key)!.add(t.id);
      }
    }

    // Materialize taskIds, rollup counts, sort.
    const roots: TreeNode[] = [];
    for (const name of rootsOrder) {
      const r = rootMap.get(name);
      if (!r) continue;
      r.taskIds = Array.from(nodeIds.get(r.key) || []);
      for (const c of r.children) {
        c.taskIds = Array.from(nodeIds.get(c.key) || []);
        c.count = c.taskIds.length;
      }
      r.children.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      // Root rollup as the union of its own tasks + all children (dedupe).
      const union = new Set<string>(r.taskIds);
      for (const c of r.children) for (const id of c.taskIds) union.add(id);
      r.count = union.size;
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
