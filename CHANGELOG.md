# Changelog

## 2.0.2

### Changed
- Documentation only. Rewrote the README around the "works the way you already work" positioning (no separate database, no special task files, no syntax or rules to adopt) and replaced the wireframes with real screenshots. Released to refresh the README shown on directory and mirror sites. No functional changes.

## 2.0.1

### Fixed
- Context sidebar **Section** and **Reference** tabs no longer leak sibling files' tasks when viewing a regular page. Subtree expansion now applies only on a folder note (`Folder/Folder.md`). On a regular page like `Folder/File1.md`, Section is empty and Reference lists only tasks that link to that exact file.

## 2.0.0

Major reorganization of the plugin's UI into three surfaces that share one index.

### Added
- **Navigator** view in the left sidebar: smart lists and the context roll-up tree, docked next to Files and Search (replaces the ribbon icon). Selecting an item drives the task list.
- **Context sidebar** (right): follows the active note and shows its tasks, with **Page / Section / Reference / All** filter tabs. Defaults to Page.
- Shared view state so a selection made in the navigator is reflected by the list, and sort/group/collapse survive re-renders.

### Changed
- Split the old two-pane panel into a left-dock navigator plus a center task list. The list now uses the full main area.
- Removed the left ribbon icon; the navigator auto-docks in the left sidebar on load.
- Context sidebar clears when a Taskgregator view is focused (a plugin view isn't a note, so it no longer strands the previous page's tasks), including when the page has no tasks.
- README trimmed: core ideas moved up, install/BRAT/roadmap/development sections removed for the Community Plugins listing.

### Notes
- Tasks remain plain markdown checkboxes in your notes; no data migration is needed when upgrading from 1.x.
