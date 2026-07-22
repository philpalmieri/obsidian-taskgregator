# Taskgregator

**An aggregator for your native Obsidian tasks, inspired by the best dedicated to-do apps (think Things, Todoist, TickTick).**

Taskgregator sucks up every checkbox task across your vault and organizes it by context (Projects, People, Areas, whatever folders you choose), without moving your notes or locking tasks into their own files. Your tasks stay exactly where you wrote them, in the markdown they already live in. Taskgregator just gives you a fast, focused place to see, prioritize, schedule, and complete them.

Think of it as a task dashboard that reads and writes your real notes, not a separate task silo.

> Works against plain markdown checkboxes and [Tasks-plugin](https://publish.obsidian.md/tasks/) style emoji metadata. No runtime dependency on Dataview or the Tasks plugin.

## Core ideas

Most task plugins either make you adopt a whole new system or isolate each task in its own document. Taskgregator takes the opposite stance:

- Tasks are just markdown checkboxes in your notes. That's the source of truth.
- Where a task lives (and what it links to) *is* its context. A task in `Projects/Website Redesign.md` belongs to that project. A task that mentions `[[People/Alex]]` also belongs to Alex.
- You should be able to see everything in one place, act on it, and jump straight back to the note it came from.

### One task, many places

A task is indexed by its location, its `[[wikilinks]]`, its `#tags`, and its dates, all at once. No duplication, no moving notes around.

![Cross-index wireframe](assets/wireframe-crossindex.png)

So a task authored in a project note that references a person shows up under **both** that project **and** that person in the navigator, and in your date-based smart lists if it has a due date.

### Right-click anywhere

Because Taskgregator understands your task lines, you get a context menu on any task line in the normal editor, not just inside the plugin panel. Set priority, add a due date, toggle `#today`, open a detail note, or reveal the task in the task list.

![Context menu wireframe](assets/wireframe-contextmenu.png)

## What it looks like

Three surfaces that share one index:

- **Navigator** (left sidebar): smart lists plus a roll-up tree of your context folders. Pick one to drive the list.
- **Task list** (main area): the tasks for the current selection, with sort and grouping controls.
- **Context sidebar** (right sidebar): follows the note you're editing and shows its tasks, filtered by **Page / Section / Reference** (or **All**).

![Main view wireframe](assets/wireframe-main.png)

*(Wireframes are intentionally low-fidelity. Names and projects shown are fictional.)*

## Features

- **Context tree** with roll-up counts. Configure which top-level folders become buckets (default: `Projects`, `People`, `Areas`). Files become sub-nodes; parent nodes aggregate everything beneath them.
- **Cross-indexing by wikilink.** A task that links `[[People/Alex]]` appears under Alex's node even though it was authored elsewhere.
- **Context sidebar** that follows the active note and scopes its tasks by Page, Section (folder subtree / folder note), or Reference.
- **Smart lists** driven by tags: Today, Follow-up, Snippet Ideas, Someday (all configurable). Plus built-in Today (by due date), Flagged (by priority), and All.
- **Inline editing** from the panel: toggle done/cancelled, cycle priority, set due/start dates, add tags, jump to source, all written back to the original markdown line.
- **Priority** using Tasks-plugin emoji signifiers (🔺 ⏫ 🔼) so it stays compatible with what you already use.
- **Per-task detail notes (sidecars).** Optionally attach a full markdown note to any task for extended context, links, and history. The task gets a lightweight block id (`^id`) only when you enrich it, and the sidecar backlinks to the source line. A 📝 chip on the card opens it.
- **Native right-click menu** on task lines across your whole vault.
- **Self-contained.** Reads and writes markdown directly. No dependency on Dataview or the Tasks plugin at runtime.

## Task format

Taskgregator reads standard markdown checkboxes and Tasks-plugin emoji metadata:

```markdown
- [ ] Open task
- [/] In progress
- [x] Done ✅ 2026-06-30
- [-] Cancelled ❌ 2026-06-30

- [ ] With metadata 📅 2026-07-01 🛫 2026-06-25 🔼 #followup
- [ ] Linked to a person [[People/Alex]] and a project [[Projects/Website Redesign]]
```

Recognized signifiers:

| Signifier | Meaning |
|-----------|---------|
| `📅 YYYY-MM-DD` | Due date |
| `🛫 YYYY-MM-DD` | Start date |
| `⏳ YYYY-MM-DD` | Scheduled |
| `➕ YYYY-MM-DD` | Created |
| `✅ YYYY-MM-DD` | Completed |
| `❌ YYYY-MM-DD` | Cancelled |
| `🔺 ⏫ 🔼 🔽 ⏬` | Priority (highest → lowest) |
| `#tag` | Smart-list membership |
| `[[link]]` | Cross-index target |
| `^blockid` | Stable identity (added lazily) |

## Usage

- The **navigator** opens in the left sidebar (its ✓✓ tab sits next to Files and Search). You can also run **Taskgregator: Open panel** from the command palette.
- Click a smart list or a tree node to load its tasks in the main list.
- On a task card: click the checkbox to complete, the flag to cycle priority, the `⋯` menu for dates/detail-note/cancel, a chip to jump to its source, or the 📝 chip to open its detail note.
- The **context sidebar** (right) tracks the note you're editing; use the Page / Section / Reference tabs to change scope.
- Right-click any task line in the editor for the same actions inline.

## Settings

- **Bucket roots**: folders that become top-level context buckets (default `Projects, People, Areas`).
- **Inbox roots**: folders treated as a flat inbox instead of per-file (default `Dailies`).
- **Ignore paths**: path prefixes to exclude from indexing.
- **Priority tags**: fallback priority tags (default `p1, p2, p3`).
- **Smart lists**: cross-cutting tag lists (`Name:tag` pairs).
- **Detail-note folder**: where sidecars are stored (default `Taskgregator/tasksData`).
- **Show completed tasks**: include done/cancelled tasks in the index.
- **Context sidebar**: enable the right-sidebar panel that follows the active note.

## What data it touches

Taskgregator only reads markdown files inside the folders you configure as bucket roots and inbox roots (by default `Projects`, `People`, `Areas`, and `Dailies`). It walks those folders directly rather than enumerating your whole vault, so files outside your configured roots are never opened. It does not make network requests, and it only writes back to the specific task lines and optional per-task detail notes you act on.

## License

[MIT](LICENSE) © Phil Palmieri
