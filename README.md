# Bookmarks-In-Bases

Adds Bases formula objects for the bookmarks of the current file.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Setup](#setup)
- [Usage](#usage)
- [Build](#build)
- [Configuration](#configuration)
- [Compatibility](#compatibility)
- [License](#license)
- [Support](#support)
- [Author](#author)

## Features

- Exposes `file.bookmarks` as a Bases formula instance function. Returns a sorted, deduplicated list of `bookmark` objects for the file represented by the current Bases row. Each bookmark displays as its final segment only (e.g. `Bases` for path `Projects/Obsidian/Bases`). If a file is bookmarked in multiple groups, the list contains one object per bookmark.
  - Why: Bases has no native way to filter or group by bookmark membership. This object enables bookmark-based views with per-bookmark operations.
  - How: Use `file.bookmarks` in any Bases formula property. The function is called on the `file` value of the row and requires no arguments: `file.bookmarks`.
- Each `bookmark` is a `Value` of type `bookmark`. Isolating an element (e.g. `file.bookmarks[0]` or `file.bookmarks.map(value)`) allows per-bookmark operations.
  - Why: Enable filtering, grouping and display based on individual bookmarks.
  - How: Use list operations like `map` or index access, then call bookmark methods on the isolated value.
- `bookmark.path()` / `bookmark.fullPath()` returns the full escaped path (groups + bookmark title) joined with `/` without spaces. A `/` inside a title is escaped as `//`.
  - Why: Provide the complete bookmark location for display or filtering.
  - How: `file.bookmarks.map(value.path())` or `file.bookmarks[0].path()`.
- `bookmark.folder()` / `bookmark.parent()` returns the immediate parent folder (single escaped segment) or `null` if the bookmark has no folder above it.
  - Why: Allow grouping or filtering by immediate container without parsing the full path.
  - How: `file.bookmarks.map(value.folder())`. Returns `null` for root bookmarks; use `value.folder() ?? ""` or `filter` to handle.
- `file.hasBookmarks()` returns a `boolean` (`true` if the file has any bookmarks, `false` otherwise).
  - Why: Quickly filter Bases views to only bookmarked files without inspecting the list.
  - How: `file.hasBookmarks()` or `file.hasBookmarks() == true`. Use in Bases filter: `hasBookmarks()`.
- Handles nested bookmark groups recursively and joins titles with `/` without spaces, escaping `/` inside titles as `//`.
  - Why: Vaults use nested bookmark groups to model hierarchies and may contain `/` in titles.
  - How: The plugin walks the Bookmarks core plugin tree (`items` / `_items`) and for each matching file bookmark builds `fullPath` from `[...groupPath, title].map(s=>s.replaceAll("/","//")).join("/")`.
- Each bookmark in the returned list renders as a clickable link (final segment, no underline, no tooltip, link colour `var(--link-color)`). Clicking reveals the **Bookmarks** view and highlights only the final file/folder bookmark as if hovered/selected (no Bases cell highlight).
  - Why: Make the bookmark actionable and provide visual feedback in the bookmarks hierarchy.
  - How: `BookmarkValue.renderTo` renders an `<a class="bookmark-path-link">` that calls `highlightBookmark`; the Bookmarks view is revealed and the matching `[data-path]` element's `.tree-item-self` is flashed with `bookmark-highlight` + `is-active`. `mousedown`/`mouseup` are cancelled and the Bases cell is blurred to prevent border highlight.
- Considers only vault-file bookmarks. Bookmarks of type `file` whose `path` equals the current file path are evaluated; other bookmark types are ignored.
  - Why: Prevent unrelated bookmark types from producing false matches.
  - How: No configuration is required; the plugin filters internally.
- Depends on internal APIs (Bookmarks and Bases core plugins) with fallback probing. Logs a warning if either core plugin is unavailable or the Bases formula registry cannot be found.
  - Why: These APIs are not part of the public `obsidian.d.ts` typings and vary across Obsidian versions.
  - How: Enable the Bookmarks and Bases core plugins. No additional setup is required.

## Requirements

- Obsidian 1.9.0 or later (tested on 1.13.7).
- Node.js 18 or later and npm for development.
- The Bookmarks and Bases core plugins must be enabled for the formula function to resolve data.

## Setup

1. Install Node.js 18 or later.
2. Clone the repository.
3. Install dependencies:

```bash
npm install
```

No additional configuration is required.

## Usage

1. Enable the plugin in **Settings → Community plugins** after installing `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/bookmarks-in-bases/`.
2. Create or open a Bases view.
3. Add a formula property using `file.bookmarks`. Examples:

```
file.bookmarks
file.hasBookmarks()
file.bookmarks.map(value.path())
file.bookmarks.map(value.folder())
file.bookmarks[0].path()
file.bookmarks[0].folder()
file.hasBookmarks()
file.bookmarks.map(value.path()).contains("Projects/Obsidian/Bases")
```

Behavior:

- `file.bookmarks` returns `[]` if the file cannot be resolved, if the Bookmarks plugin is unavailable, or if the file has no file-type bookmarks. Otherwise returns a sorted list of `bookmark` objects; display is the final segment only (e.g. `Bases`), escaped with `//` inside titles.
- `file.hasBookmarks()` returns `true` if the file has at least one bookmark, `false` otherwise (boolean, not list).
- `bookmark.path()` / `bookmark.fullPath()` returns the full escaped path including the final bookmark title (e.g. `Projects/Obsidian/Bases`). Joined with `/` without spaces.
- `bookmark.folder()` / `bookmark.parent()` returns the immediate parent folder (single escaped segment) or `null` if the bookmark is at the root (no folder above it). Use `value.folder() ?? ""` to coerce to string.
- Click any bookmark item to reveal the **Bookmarks** view and flash-highlight only the final file/folder bookmark as `is-active`/`bookmark-highlight` (hover/selected look). The Bases cell is not highlighted, and links have no underline or tooltip.

Limitations:

- Accesses internal Bookmarks/Bases data structures. A future Obsidian update may change these structures; the plugin logs a warning and returns `[]` or `null` if the structure is not found.

## Build

Compile the plugin from `src/main.ts` to `main.js`:

```bash
npm run dev      # watch mode, inline sourcemap
npm run build    # production build, minified, no sourcemap
```

Run the linter:

```bash
npm run lint
```

Manual install for testing:

1. Run `npm run build`.
2. Copy `main.js`, `manifest.json`, and `styles.css` (if present) to `<Vault>/.obsidian/plugins/bookmarks-in-bases/`.
3. Reload Obsidian and enable **Bookmarks-In-Bases** in **Settings → Community plugins**.

Versioning: update `version` in `manifest.json` and `package.json`, then run `npm version patch|minor|major` to update `versions.json`.

## Configuration

This plugin exposes no user-facing settings. There are no configuration keys, no settings tab, and no persisted data. Behavior is fully determined by the current file and the vault's bookmark tree.

## Compatibility

- `minAppVersion` is `1.9.0` as declared in `manifest.json`.
- Developed and tested against Obsidian 1.13.7.
- `isDesktopOnly` is `false`; the plugin does not use desktop-only APIs.

## License

0BSD. See [LICENSE](LICENSE).

Copyright (C) 2020-2026 by Dynalist Inc.

## Support

Report issues at https://github.com/LorenBll/Bookmarks-In-Bases/issues (or the GitHub repository associated with this plugin).

## Author

[LorenBll](https://github.com/LorenBll)
