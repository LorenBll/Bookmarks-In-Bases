import { Plugin, TFile, StringValue, ListValue, FileValue, Value, NullValue, BooleanValue } from "obsidian";

/*
 * Bookmarks-In-Bases
 *
 * Exposes:
 *
 *     file.bookmarks -> list of bookmark objects (final segment)
 *     file.hasBookmarks() -> boolean
 *     bookmark.path() -> full escaped path (groups + bookmark, "/" without spaces, "/" inside title escaped as "//")
 *     bookmark.folder() -> immediate parent folder (escaped) or null if none
 *
 * Each bookmark item renders as a clickable link that highlights the
 * corresponding bookmark in the Bookmarks view as if hovered/selected.
 * The link has no underline and no tooltip, and clicking does not
 * highlight the Bases cell.
 *
 * The plugin only considers bookmarks whose target is a vault file.
 *
 * NOTE:
 * Obsidian's bookmark plugin API is currently not officially documented.
 * This plugin therefore accesses the Bookmarks core plugin's internal
 * bookmark data.
 */

interface BookmarkItem {
	type?: string;
	title?: string;
	path?: string;
	subpath?: string;
}

interface BookmarkGroup {
	type?: string;
	title?: string;
	items?: BookmarkNode[];
}

type BookmarkNode = BookmarkItem | BookmarkGroup;

interface BookmarkHighlighter {
	highlightBookmark(escapedPath: string, filePath: string): Promise<void>;
}

/**
 * Bookmark value for Bases.
 * Display is the final segment (bookmark title), but holds full path and folder.
 */
class BookmarkValue extends Value {
	static type = "bookmark";

	constructor(
		private _file: TFile,
		private _fullPath: string,
		private _folder: string | null,
		private _finalTitle: string,
		private _plugin: BookmarkHighlighter,
	) {
		super();
	}

	get fullPath(): string {
		return this._fullPath;
	}

	get folder(): string | null {
		return this._folder;
	}

	get finalTitle(): string {
		return this._finalTitle;
	}

	get file(): TFile {
		return this._file;
	}

	toString(): string {
		return this._finalTitle;
	}

	isTruthy(): boolean {
		return true;
	}

	equals(other: this): boolean {
		return other instanceof BookmarkValue && other._fullPath === this._fullPath && other._file.path === this._file.path;
	}

	renderTo(el: HTMLElement, _ctx?: unknown): void {
		el.empty();
		const label = this._finalTitle || "(root)";
		const link = el.createEl("a", { text: label, cls: "bookmark-path-link" });
		link.setAttr("href", "#");
		const stop = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			(e as MouseEvent).stopImmediatePropagation?.();
		};
		link.addEventListener("mousedown", stop);
		link.addEventListener("mouseup", stop);
		link.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			(e as MouseEvent).stopImmediatePropagation?.();
			link.blur();
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			const basesCell = el.closest('.bases-td, .bases-cell, td, [data-type="bases"]');
			if (basesCell instanceof HTMLElement) basesCell.blur();
			void this._plugin.highlightBookmark(this._fullPath, this._file.path);
		});
	}
}

interface BasesInstanceFunc {
	name: string;
	docString: () => string;
	params: unknown[];
	applyWithContext: (ctx: unknown, ...args: unknown[]) => unknown;
}

interface BasesRegistry {
	registerInstanceFunc?: (valueType: unknown, func: BasesInstanceFunc) => void;
}

export default class BookmarkPathsPlugin extends Plugin {
	async onload() {
		// Bases may not be ready at onload. Defer registration until layout is ready
		// and also try immediately for cases where it is already available.
		this.app.workspace.onLayoutReady(() => {
			this.registerBookmarkFormulaFunction();
		});
		// In case onLayoutReady already fired (reload), also try now
		this.registerBookmarkFormulaFunction();
	}

	/**
	 * Register Bases formula functions.
	 *
	 * Primary: file.bookmarks -> List<Bookmark> (instance func on FileValue)
	 * Bookmark ops: bookmark.path() / bookmark.fullPath() and bookmark.folder() / bookmark.parent()
	 */
	private registerBookmarkFormulaFunction() {
		const registry = this as unknown as BasesRegistry;
		const register = registry.registerInstanceFunc;
		if (typeof register !== "function") {
			return;
		}

		// --- file.bookmarks -> List<BookmarkValue> (final segment display) ---
		try {
			register(FileValue, {
				name: "bookmarks",
				docString: () => "Returns the list of bookmarks for the file (final segments).",
				params: [{ name: "self", type: [FileValue], optional: false }],
				applyWithContext: (ctx: unknown, self: unknown) => {
					const file = this.getFileFromValue(self) ?? this.getFileFromFormulaContext(ctx);
					if (!file) return new ListValue([]);
					return new ListValue(this.getBookmarkValues(file));
				},
			});
		} catch {
			// ignore
		}

		// --- file.hasBookmarks() -> boolean ---
		try {
			register(FileValue, {
				name: "hasBookmarks",
				docString: () => "Returns true if the file has any bookmarks.",
				params: [{ name: "self", type: [FileValue], optional: false }],
				applyWithContext: (ctx: unknown, self: unknown) => {
					const file = this.getFileFromValue(self) ?? this.getFileFromFormulaContext(ctx);
					if (!file) return new BooleanValue(false);
					return new BooleanValue(this.getBookmarkValues(file).length > 0);
				},
			});
		} catch {
			// ignore
		}

		// --- bookmark.path() / bookmark.fullPath() / bookmark.full_path() -> full escaped path ---
		try {
			const pathFunc: BasesInstanceFunc = {
				name: "path",
				docString: () => "Returns the full escaped path of the bookmark (groups + bookmark, / without spaces, // for / inside title).",
				params: [{ name: "self", type: [BookmarkValue], optional: false }],
				applyWithContext: (_ctx: unknown, self: unknown) => {
					if (self instanceof BookmarkValue) return new StringValue(self.fullPath);
					return new StringValue("");
				},
			};
			for (const name of ["path", "fullPath", "full_path"]) {
				register(BookmarkValue, { ...pathFunc, name });
			}
		} catch {
			// ignore
		}

		// --- bookmark.folder() / bookmark.parent() / bookmark.parentFolder() -> immediate parent folder or null ---
		try {
			const folderFunc: BasesInstanceFunc = {
				name: "folder",
				docString: () => "Returns the immediate parent folder of the bookmark (escaped), or null if none.",
				params: [{ name: "self", type: [BookmarkValue], optional: false }],
				applyWithContext: (_ctx: unknown, self: unknown) => {
					if (self instanceof BookmarkValue) {
						if (self.folder === null) return NullValue.value;
						return new StringValue(self.folder);
					}
					return NullValue.value;
				},
			};
			for (const name of ["folder", "parent", "parentFolder"]) {
				register(BookmarkValue, { ...folderFunc, name });
			}
		} catch {
			// ignore
		}
	}

	/**
	 * Highlight the bookmark for filePath inside group escapedPath in the Bookmarks view.
	 * Decodes escaped slashes (//) and tries to find the matching DOM node.
	 */
	public async highlightBookmark(escapedPath: string, filePath: string): Promise<void> {
		const targetGroups = this.decodeEscapedPath(escapedPath);

		// Ensure Bookmarks view is visible
		let leaf = this.app.workspace.getLeavesOfType("bookmarks")[0];
		if (!leaf) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (rightLeaf) {
				try {
					await rightLeaf.setViewState({ type: "bookmarks", active: true });
					leaf = this.app.workspace.getLeavesOfType("bookmarks")[0] ?? rightLeaf;
				} catch {
					// ignore
				}
			}
		}
		if (!leaf) {
			return;
		}
		await this.app.workspace.revealLeaf(leaf);

		window.setTimeout(() => {
			try {
				const view = (leaf as unknown as { view?: { containerEl?: HTMLElement } }).view;
				const container =
					view?.containerEl ??
					(leaf as unknown as { containerEl?: HTMLElement }).containerEl ??
					document.querySelector<HTMLElement>('[data-type="bookmarks"]');
				if (!container) return;

				// Find file bookmark elements via [data-path]
				const candidates = Array.from(container.querySelectorAll<HTMLElement>('[data-path]')).filter(
					(el) => el.getAttribute("data-path") === filePath,
				);

				let target: HTMLElement | null = null;

				if (candidates.length === 1) {
					target = candidates[0] ?? null;
				} else if (candidates.length > 1) {
					// Multiple bookmarks for same file in different groups: disambiguate by parent group path.
					// targetGroups includes the final bookmark title; collectBookmarkGroups returns only parent groups.
					const parentTarget = targetGroups.slice(0, -1);
					for (const cand of candidates) {
						const groups = this.collectBookmarkGroups(cand, container);
						if (this.arraysEqual(groups, parentTarget)) {
							target = cand;
							break;
						}
					}
					if (!target) target = candidates[0] ?? null;
				}

				if (!target) return;

				target.scrollIntoView({ behavior: "smooth", block: "center" });
				// Only the final file/folder bookmark is highlighted, not the whole group path.
				// Use native hover/selected styling: add is-active to the self row.
				const highlightEl = target.closest<HTMLElement>('.tree-item') ?? target;
				const selfEl = highlightEl.querySelector<HTMLElement>('.tree-item-self');
				const toHighlight = selfEl ?? highlightEl;
				toHighlight.addClass("bookmark-highlight");
				toHighlight.addClass("is-active");
				window.setTimeout(() => {
					toHighlight.removeClass("bookmark-highlight");
					toHighlight.removeClass("is-active");
				}, 1800);
			} catch {
				// ignore
			}
		}, 180);
	}

	private decodeEscapedPath(escaped: string): string[] {
		if (escaped === "") return [];
		const result: string[] = [];
		let cur = "";
		for (let i = 0; i < escaped.length; i++) {
			const ch = escaped[i];
			if (ch === "/") {
				if (escaped[i + 1] === "/") {
					cur += "/";
					i++;
				} else {
					result.push(cur);
					cur = "";
				}
			} else {
				cur += ch;
			}
		}
		result.push(cur);
		return result;
	}

	private collectBookmarkGroups(el: HTMLElement, container: HTMLElement): string[] {
		const groups: string[] = [];
		let cur: HTMLElement | null = el.closest<HTMLElement>('.tree-item');
		// Walk up through parent tree-items to collect group titles.
		// Obsidian bookmarks DOM: each group is a .tree-item with .tree-item-self > .tree-item-inner.
		while (cur && container.contains(cur)) {
			const parentGroup = cur.parentElement?.closest<HTMLElement>('.tree-item') ?? null;
			if (!parentGroup) break;
			const titleEl = parentGroup.querySelector<HTMLElement>(':scope > .tree-item-self .tree-item-inner');
			if (titleEl) {
				const title = titleEl.textContent?.trim() ?? "";
				if (title) groups.unshift(title);
			}
			cur = parentGroup;
		}
		return groups;
	}

	private arraysEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}

	/**
	 * Try to extract TFile from a FileValue or similar wrapper.
	 * FileValue is opaque and not documented; probe several shapes.
	 */
	private getFileFromValue(value: unknown): TFile | null {
		if (!value) return null;
		if (value instanceof TFile) return value;

		const v = value as Record<string, unknown>;

		// Direct wrapped file properties
		const wrappedFile = v["file"];
		if (wrappedFile instanceof TFile) return wrappedFile;
		const wrappedData = v["data"];
		if (wrappedData instanceof TFile) return wrappedData;
		const wrappedUnderscore = v["_file"];
		if (wrappedUnderscore instanceof TFile) return wrappedUnderscore;

		// Path strings - try common keys
		const pathCandidates: unknown[] = [
			v["path"],
			(v["file"] as Record<string, unknown> | undefined)?.["path"],
			(v["data"] as Record<string, unknown> | undefined)?.["path"],
			(v["value"] as Record<string, unknown> | undefined)?.["path"],
		];
		for (const p of pathCandidates) {
			if (typeof p === "string") {
				const f = this.app.vault.getAbstractFileByPath(p);
				if (f instanceof TFile) return f;
			}
		}

		// Scan own properties for a TFile
		try {
			for (const key of Object.keys(v)) {
				const val = v[key];
				if (val instanceof TFile) return val;
				if (val && typeof (val as Record<string, unknown>)["path"] === "string") {
					const p = (val as Record<string, unknown>)["path"] as string;
					const f = this.app.vault.getAbstractFileByPath(p);
					if (f instanceof TFile) return f;
				}
			}
			for (const key of Object.getOwnPropertyNames(v)) {
				const val = v[key];
				if (val instanceof TFile) return val;
			}
		} catch {
			// ignore
		}

		// Some FileValue implementations expose file via hidden symbol or via toString not usable
		return null;
	}

	/**
	 * Extract the current TFile from the Bases formula context.
	 *
	 * Bases passes a context object containing the current file/entity.
	 * Because this is an internal API, support several possible shapes.
	 * Modern BasesEntry has .file directly.
	 */
	private getFileFromFormulaContext(ctx: unknown): TFile | null {
		if (!ctx || typeof ctx !== "object") {
			return null;
		}
		const c = ctx as Record<string, unknown>;

		// Modern BasesEntry: ctx.file is TFile
		const direct = c["file"];
		if (direct instanceof TFile) return direct;

		const candidates = [
			(c as { file?: unknown }).file,
			(c as { currentFile?: unknown }).currentFile,
			(c as { entity?: { file?: unknown } }).entity?.file,
			(c as { current?: { file?: unknown } }).current?.file,
			(c as { row?: { file?: unknown } }).row?.file,
			(c as { row?: { value?: { file?: unknown } } }).row?.value?.file,
		];

		for (const candidate of candidates) {
			if (candidate instanceof TFile) {
				return candidate;
			}
			if (candidate && typeof (candidate as { path?: unknown }).path === "string") {
				const path = (candidate as { path: string }).path;
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					return file;
				}
			}
		}

		return null;
	}

	/**
	 * Get the internal Bookmarks core plugin.
	 */
	private getBookmarksPlugin(): unknown {
		const internalPlugins = (this.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => unknown } }).internalPlugins;
		if (!internalPlugins) return null;
		const plugin = internalPlugins.getPluginById?.("bookmarks");
		if (!plugin) return null;
		const record = plugin as { instance?: unknown; _instance?: unknown };
		return record.instance ?? record._instance ?? null;
	}

	/**
	 * Return BookmarkValue objects for a file.
	 * Each value display is the final segment, holds fullPath and folder.
	 */
	private getBookmarkValues(file: TFile): BookmarkValue[] {
		const bookmarks = this.getBookmarksPlugin() as
			| { items?: BookmarkNode[]; _items?: BookmarkNode[]; instance?: { items?: BookmarkNode[] } }
			| null;
		if (!bookmarks) return [];

		const rootItems: BookmarkNode[] =
			bookmarks.items ??
			bookmarks._items ??
			bookmarks.instance?.items ??
			[];

		if (!Array.isArray(rootItems)) return [];

		const results: BookmarkValue[] = [];
		this.walkBookmarkTreeForValues(rootItems, [], file.path, file, results);
		// Deduplicate by fullPath and sort
		const seen = new Set<string>();
		const deduped: BookmarkValue[] = [];
		for (const v of results.sort((a, b) => a.fullPath.localeCompare(b.fullPath))) {
			if (!seen.has(v.fullPath)) {
				seen.add(v.fullPath);
				deduped.push(v);
			}
		}
		return deduped;
	}

	/**
	 * Recursively walk bookmark groups collecting BookmarkValue.
	 */
	private walkBookmarkTreeForValues(items: BookmarkNode[], groupPath: string[], filePath: string, file: TFile, results: BookmarkValue[]) {
		for (const item of items) {
			if (!item) continue;

			if (item.type === "group" || Array.isArray((item as BookmarkGroup).items)) {
				const group = item as BookmarkGroup;
				const title = typeof group.title === "string" ? group.title : "";
				const nextPath = title ? [...groupPath, title] : groupPath;
				if (Array.isArray(group.items)) {
					this.walkBookmarkTreeForValues(group.items, nextPath, filePath, file, results);
				}
				continue;
			}

			const bookmark = item as BookmarkItem;
			if (bookmark.type === "file" && bookmark.path === filePath) {
				const rawTitle =
					typeof bookmark.title === "string" && bookmark.title.length > 0
						? bookmark.title
						: (filePath.split("/").pop() ?? filePath);
				const escapedGroups = groupPath.map((s) => s.replaceAll("/", "//"));
				const escapedTitle = rawTitle.replaceAll("/", "//");
				const fullPath = escapedGroups.length > 0 ? escapedGroups.join("/") + "/" + escapedTitle : escapedTitle;
				const folder = escapedGroups.length > 0 ? (escapedGroups[escapedGroups.length - 1] ?? null) : null;
				const finalTitle = escapedTitle;
				results.push(new BookmarkValue(file, fullPath, folder, finalTitle, this));
			}
		}
	}
}