# Bookmarks-in-Bases

Adds Bases formula objects for the bookmarks of the current file.

User documentation: [README.md](README.md). Repository rules for contributors and agents: [AGENTS.md](AGENTS.md).

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Project Structure](#project-structure)
- [Endpoints](#endpoints)
- [Setup](#setup)
- [Usage](#usage)
- [Run](#run)
- [Build](#build)
- [Logging](#logging)
- [Configuration](#configuration)
- [Compatibility](#compatibility)
- [Licence](#licence)
- [Support](#support)
- [Author](#author)

## Features

- `file.bookmarks` exposes the bookmarks of the current Bases row as a list of values of type `bookmark`.
  - Why: Bases has no native way to filter, group or display rows by bookmark membership. This list makes bookmark-based views possible, with per-bookmark operations on top.
  - How: use `file.bookmarks` in a Bases formula property. It is registered as an instance function on `FileValue` whose `self` parameter is not optional, so it is read as a property without parentheses: `file.bookmarks`. The list is sorted ascending by escaped path and deduplicated by escaped path; each element displays only its own segment (the bookmark title, or the file name when the bookmark has no title), so a bookmark for `Projects/Obsidian/Bases` displays as `Bases`. A file bookmarked in several groups yields one element per bookmark.
- Each element is a `Value` of type `bookmark`, which can be isolated and queried on its own.
  - Why: per-bookmark filtering, grouping and display need access to a single bookmark rather than the whole list.
  - How: use list operations, for example `file.bookmarks[0]` or `file.bookmarks.map(value.folder())`, then call bookmark methods on the isolated value.
- `bookmark.path()`, `bookmark.fullPath()` and `bookmark.full_path()` return the full escaped path of the bookmark.
  - Why: display or filter on the complete location of a bookmark inside the bookmark tree.
  - How: `file.bookmarks.map(value.path())` or `file.bookmarks[0].path()`. The group titles and the bookmark's own title are joined with `/`; a `/` inside a title is escaped as `//`. A bookmark titled `Bases` inside the group `Obsidian` inside the group `Projects` returns `Projects/Obsidian/Bases`. The three names are aliases and behave identically. A receiver that is not a `bookmark` returns the empty string.
- `bookmark.folder()`, `bookmark.parent()` and `bookmark.parentFolder()` return the immediate parent segment of the bookmark, or `null` when the bookmark lies outside every group.
  - Why: group or filter by the immediate container without parsing the full path.
  - How: `file.bookmarks.map(value.folder())`. The parent title is escaped in the same way as a path segment. Coerce the result with `value.folder() ?? ""` when a string is required. A receiver that is not a `bookmark` returns `null`. The three names are aliases and behave identically.
- `file.hasBookmarks()` returns a boolean that states whether the current file has at least one bookmark.
  - Why: filter a view down to bookmarked files without materialising and testing the list.
  - How: `file.hasBookmarks()` in a formula property or in a Bases filter. It returns `false` when the row's file cannot be resolved or when the Bookmarks core plugin is unavailable.
- The plugin reads the Bookmarks core plugin's internal bookmark tree and registers into the Bases formula registry.
  - Why: neither the Bookmarks bookmark tree nor the Bases instance-function registry is part of the public `obsidian.d.ts` typings.
  - How: enable the **Bookmarks** and **Bases** core plugins in **Settings → Core plugins**. Registration runs when the workspace layout is ready, which is after Bases is available. If the plugin exposes no `registerInstanceFunc`, no formula is registered at all; if a single registration throws, only that function is skipped; if the Bookmarks plugin is missing, every function returns its empty value.
- Nested bookmark groups are walked recursively, and the titles of every group on the path are collected.
  - Why: vaults model hierarchies with nested bookmark groups, and a bookmark's location is the full chain of groups above it.
  - How: nothing to configure. Each group contributes its escaped title to the path; the immediate parent is the last collected group.
- Only bookmarks whose target is a vault file are considered.
  - Why: a bookmark that does not target a vault file would otherwise produce a false match.
  - How: nothing to configure. A bookmark becomes a value only when its `type` is `file` and its `path` equals the current file path.
- Every returned bookmark renders as a clickable link in the Bases cell, and selecting it locates the bookmark in the **Bookmarks** view.
  - Why: a bookmark that cannot be acted on is only half useful, and a bookmark nested in a collapsed group is otherwise hard to find. The feedback makes it findable without leaving the tree.
  - How: select the link. The label is the bookmark's own segment, rendered without underline and without tooltip in `var(--link-color)` (`var(--link-color-hover)` on hover, falling back to the link colour). Selecting it reveals the **Bookmarks** view, opens every collapsed group on the path, scrolls the bookmark into view and flashes it as hovered/selected using the `bookmark-highlight` and `is-active` classes for 2.2 seconds. The Bases cell is not highlighted: `mousedown` and `mouseup` are cancelled and the cell is blurred.
  - Retries: the Bookmarks view renders asynchronously, so the lookup is retried up to three times at 350 ms (380 ms after expanding a group) before giving up, and any highlight left by an earlier selection is cleared first.
- Failures are silent: the plugin returns an empty list, `false` or `null` rather than throwing, and writes nothing to the developer console.
  - Why: the internal structures it depends on vary between Obsidian versions, and a thrown error would break the whole Bases view.
  - How: nothing to configure. A formula that returns an empty list or `null` in a vault known to have bookmarks indicates that an internal structure is missing.

## Requirements

- Obsidian `1.13.7` or later, as declared by `minAppVersion` in `manifest.json`. Developed and tested against Obsidian 1.13.7.
- Node.js 18 or later and npm, for development only. The continuous integration workflow builds and lints on Node.js 20.x, 22.x and 24.x.
- The **Bookmarks** and **Bases** core plugins, both enabled in **Settings → Core plugins**. Without them the plugin registers no formula functions and the formulas return empty values.

## Project Structure

The plugin is a TypeScript project bundled by esbuild into a single `main.js`. `src/main.ts` is the plugin entry point; every feature module lives beside it under `src/`.

```
Bookmarks-in-Bases/
├── src/
│   ├── main.ts            entry point; registers the formulas once the workspace layout is ready
│   ├── formulas.ts        registers the Bases instance functions
│   ├── bookmarks.ts       resolves the row's file and walks the bookmark tree into BookmarkValue objects
│   ├── bookmark-value.ts  BookmarkValue, a Value of type bookmark, with its clickable renderer
│   ├── highlight.ts       BookmarkViewHighlighter, which locates and flashes a bookmark in the Bookmarks view
│   └── types.ts           interfaces for the internal Bookmarks and Bases structures
├── .github/workflows/
│   ├── lint.yml           builds and lints on every push and pull request (Node.js 20.x, 22.x, 24.x)
│   └── release.yml        builds and creates a draft GitHub release on every tag
├── esbuild.config.mjs     bundler configuration; a second `production` argument builds once and exits
├── eslint.config.mts      ESLint configuration using the eslint-plugin-obsidianmd recommended set
├── tsconfig.json          TypeScript configuration, strict, target ES2021
├── version-bump.mjs       `npm version` hook that syncs manifest.json and versions.json
├── versions.json          map of plugin version to minAppVersion
├── manifest.json          plugin metadata, including the canonical version
├── package.json           scripts and development dependencies
├── styles.css             styles for the bookmark link and the highlight
├── main.js                generated bundle; not committed, attached to releases instead
├── LICENSE                licence text
├── README.md              user documentation
└── README-DEV.md          this file
```

Release artefacts: the files installed into `<Vault>/.obsidian/plugins/bookmarks-in-bases/` are `main.js`, `manifest.json` and `styles.css`. `main.js` is listed in `.gitignore` and is produced by the build.

## Endpoints

The plugin exposes no HTTP endpoints. It runs inside Obsidian, starts no server and makes no network request; it communicates only with the Bases formula registry and the Bookmarks core plugin's internal bookmark tree.

## Setup

1. Install Node.js 18 or later. npm is bundled with it.
2. Clone the repository:

```bash
git clone https://github.com/LorenBll/Bookmarks-In-Bases.git
```

3. Install the development dependencies from the repository root:

```bash
npm install
```

No configuration files, environment variables or credentials are required. The plugin has no user-facing settings.

## Usage

1. Build the plugin and copy `main.js`, `manifest.json` and `styles.css` into `<Vault>/.obsidian/plugins/bookmarks-in-bases/`; see [Build](#build).
2. Reload Obsidian and enable **Bookmarks-In-Bases** in **Settings → Community plugins**.
3. Enable the **Bookmarks** and **Bases** core plugins in **Settings → Core plugins**.
4. Create or open a Bases view and add a formula property, or a filter, that uses the functions below.

Examples:

```
file.bookmarks
file.hasBookmarks()
file.bookmarks.map(value.path())
file.bookmarks.map(value.folder())
file.bookmarks[0].path()
file.bookmarks[0].folder()
file.bookmarks.map(value.path()).contains("Projects/Obsidian/Bases")
```

Behaviour:

- `file.bookmarks` returns an empty list when the row's file cannot be resolved, when the Bookmarks core plugin is unavailable, or when the file has no file-type bookmarks. Otherwise it returns the bookmarks of that file, sorted ascending by escaped path and deduplicated by escaped path.
- `file.hasBookmarks()` returns `true` when the file has at least one bookmark and `false` otherwise.
- `bookmark.path()`, `bookmark.fullPath()` and `bookmark.full_path()` return the full escaped path, including the bookmark's own title.
- `bookmark.folder()`, `bookmark.parent()` and `bookmark.parentFolder()` return the immediate parent segment, or `null` when the bookmark is not inside a group.
- Selecting a rendered bookmark reveals the **Bookmarks** view, opens the collapsed groups on its path, scrolls it into view and flashes it for 2.2 seconds. The Bases cell is not highlighted, and the link carries no underline and no tooltip.

Limitations:

- The plugin reads internal, undocumented Bookmarks and Bases structures: `app.internalPlugins.getPluginById("bookmarks")`, the `items`/`_items` bookmark tree, and the Bases `registerInstanceFunc` registry. An Obsidian update may change them, in which case the plugin registers nothing or returns empty values instead of failing.
- Values are deduplicated by escaped path, so two bookmarks that share the same group chain and the same title collapse into a single entry.
- The Bookmarks view exposes no stable per-item attribute. Highlighting therefore also falls back to matching the visible text, and may select the first match when several bookmarks share a title in the same group.

## Run

The plugin has no `run.bat` or `run.sh`. Loading it into Obsidian is the equivalent of starting it. Development loop:

1. Start the bundler in watch mode: `npm run dev`. esbuild rebuilds `main.js` at the repository root after every change, with an inline sourcemap.
2. Copy `main.js`, `manifest.json` and `styles.css` into `<Vault>/.obsidian/plugins/bookmarks-in-bases/`. Create the folder if it does not exist; its name must equal the plugin `id` from `manifest.json`.
3. Reload Obsidian, or disable and re-enable **Bookmarks-In-Bases** in **Settings → Community plugins**.
4. On first use, enable the **Bookmarks** and **Bases** core plugins in **Settings → Core plugins**.
5. Open a Bases view and add a formula property that uses `file.bookmarks`.

Repeat steps 2 and 3 after each change. A production bundle built with `npm run build` is installed the same way.

## Build

The build compiles `src/main.ts` into the bundled `main.js` at the repository root:

```bash
npm run dev      # watch mode, inline sourcemap, no minification
npm run build    # type-check with tsc, then a minified bundle without a sourcemap
npm run lint     # ESLint, using eslint-plugin-obsidianmd
```

Manual install for testing:

1. Run `npm run build`.
2. Copy `main.js`, `manifest.json` and `styles.css` into `<Vault>/.obsidian/plugins/bookmarks-in-bases/`.
3. Reload Obsidian and enable **Bookmarks-In-Bases** in **Settings → Community plugins**.

Versioning: run `npm version patch|minor|major`. The `version` script then runs `version-bump.mjs`, which copies the new version into `manifest.json` and adds the version mapped to the current `minAppVersion` in `versions.json`. `.npmrc` sets `tag-version-prefix=""`, so the resulting git tag has no leading `v` and matches `manifest.json`. `main.js` is generated, is not committed, and is attached to the GitHub release instead.

## Logging

The plugin performs no logging. `src/` contains no `console.log`, `console.warn` or `console.error` call, and the plugin writes no log file: it never calls `saveData`, so no `data.json` and no JSON log file is written into the vault. Errors are absorbed by empty `catch` blocks, and a missing internal structure is reported through the formula result: an empty list, `false` or `null`.

The JSON log files, the 14-day retention, the `--debug` option and the `run.bat`/`run.sh` requirements of the Logging Standard do not apply here: the plugin ships without run scripts, and the Obsidian Plugin Standard forbids writing JSON log files into the vault.

To debug, add temporary `console.log` calls under `src/`, run `npm run dev`, and read them in Obsidian's developer console (**View → Toggle developer tools** on desktop). Remove them before committing.

## Configuration

The plugin exposes no user-facing settings. There is no settings tab, no configuration key, and no persisted data: the plugin calls neither `loadData` nor `saveData`, and writes no `data.json`. Behaviour is determined entirely by the current file and the vault's bookmark tree.

## Compatibility

- `minAppVersion` is `1.13.7`, as declared in `manifest.json`.
- Developed and tested against Obsidian 1.13.7.
- `isDesktopOnly` is `false`. The plugin uses no desktop-only or Node.js API; it relies on DOM APIs that are present in the mobile app.

## Licence

0BSD. See [LICENSE](LICENSE).

Copyright (C) 2020-2026 by Dynalist Inc.

## Support

Report issues at https://github.com/LorenBll/Bookmarks-In-Bases/issues.

## Author

[LorenBll](https://github.com/LorenBll)
