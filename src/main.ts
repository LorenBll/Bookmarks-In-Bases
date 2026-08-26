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
 * Legacy:
 *
 *     file.bookmark_paths() -> list of full paths (kept for compat)
 *
 * Each bookmark item renders as a clickable link that highlights the
 * corresponding bookmark in the Bookmarks view as if hovered/selected.
 * The link has no underline and no tooltip, and clicking does not
 * highlight the Bases cell.
 *
 * The function only considers bookmarks whose target is a vault file.
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
		private _plugin: any,
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
			(link as HTMLElement).blur();
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			const basesCell = el.closest('.bases-td, .bases-cell, td, [data-type="bases"]');
			if (basesCell instanceof HTMLElement) (basesCell as HTMLElement).blur?.();
			void this._plugin.highlightBookmark(this._fullPath, this._file.path);
		});
	}
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
		const anyPlugin = this as unknown as {
			registerGlobalFunc?: (func: {
				name: string;
				docString: () => string;
				params: unknown[];
				applyWithContext: (ctx: unknown, ...args: unknown[]) => unknown;
			}) => void;
			registerInstanceFunc?: (
				valueType: unknown,
				func: {
					name: string;
					docString: () => string;
					params: unknown[];
					applyWithContext: (ctx: unknown, ...args: unknown[]) => unknown;
				},
			) => void;
		};

		let registered = false;

		// --- file.bookmarks -> List<BookmarkValue> (final segment display) ---
		if (typeof anyPlugin.registerInstanceFunc === "function") {
			try {
				anyPlugin.registerInstanceFunc(FileValue, {
					name: "bookmarks",
					docString: () => "Returns the list of bookmarks for the file (final segments).",
					params: [{ name: "self", type: [FileValue], optional: false }],
					applyWithContext: (ctx: unknown, self: unknown) => {
						const file = this.getFileFromValue(self) ?? this.getFileFromFormulaContext(ctx);
						if (!file) return new ListValue([]);
						const values = this.getBookmarkValues(file);
						return new ListValue(values);
					},
				} as unknown as Parameters<NonNullable<typeof anyPlugin.registerInstanceFunc>>[1]);
				console.log("[Bookmarks-In-Bases] Registered file.bookmarks via registerInstanceFunc");
				registered = true;
			} catch (error) {
				console.error("[Bookmarks-In-Bases] registerInstanceFunc file.bookmarks failed:", error);
			}

			// --- file.hasBookmarks() -> boolean ---
			try {
				anyPlugin.registerInstanceFunc(FileValue, {
					name: "hasBookmarks",
					docString: () => "Returns true if the file has any bookmarks.",
					params: [{ name: "self", type: [FileValue], optional: false }],
					applyWithContext: (ctx: unknown, self: unknown) => {
						const file = this.getFileFromValue(self) ?? this.getFileFromFormulaContext(ctx);
						if (!file) return new BooleanValue(false);
						const has = this.getBookmarkValues(file).length > 0;
						return new BooleanValue(has);
					},
				} as unknown as Parameters<NonNullable<typeof anyPlugin.registerInstanceFunc>>[1]);
				console.log("[Bookmarks-In-Bases] Registered file.hasBookmarks() via registerInstanceFunc");
				registered = true;
			} catch (error) {
				console.error("[Bookmarks-In-Bases] registerInstanceFunc file.hasBookmarks failed:", error);
			}

			// --- bookmark.path() / bookmark.fullPath() -> full escaped path ---
			try {
				const pathDoc = () => "Returns the full escaped path of the bookmark (groups + bookmark, / without spaces, // for / inside title).";
				const pathImpl = (ctx: unknown, self: unknown) => {
					const bv = self as BookmarkValue;
					if (bv instanceof BookmarkValue) return new StringValue(bv.fullPath);
					return new StringValue(String(self ?? ""));
				};
				const folderDoc = () => "Returns the immediate parent folder of the bookmark (escaped), or null if none.";
				const folderImpl = (ctx: unknown, self: unknown) => {
					const bv = self as BookmarkValue;
					if (bv instanceof BookmarkValue) {
						if (bv.folder === null) return (NullValue as unknown as { value: Value }).value ?? new (NullValue as unknown as new () => Value)();
						return new StringValue(bv.folder);
					}
					return (NullValue as unknown as { value: Value }).value ?? new (NullValue as unknown as new () => Value)();
				};

				// Register under several aliases for ergonomics
				for (const name of ["path", "fullPath", "full_path"]) {
					anyPlugin.registerInstanceFunc(BookmarkValue as unknown as typeof Value, {
						name,
						docString: pathDoc,
						params: [{ name: "self", type: [BookmarkValue as unknown as typeof Value], optional: false }],
						applyWithContext: pathImpl,
					} as unknown as Parameters<NonNullable<typeof anyPlugin.registerInstanceFunc>>[1]);
				}
				for (const name of ["folder", "parent", "parentFolder"]) {
					anyPlugin.registerInstanceFunc(BookmarkValue as unknown as typeof Value, {
						name,
						docString: folderDoc,
						params: [{ name: "self", type: [BookmarkValue as unknown as typeof Value], optional: false }],
						applyWithContext: folderImpl,
					} as unknown as Parameters<NonNullable<typeof anyPlugin.registerInstanceFunc>>[1]);
				}
				console.log("[Bookmarks-In-Bases] Registered bookmark.path()/folder() via registerInstanceFunc");
			} catch (error) {
				console.error("[Bookmarks-In-Bases] bookmark instance funcs failed:", error);
			}
		}

		if (!registered) {
			console.warn("[Bookmarks-In-Bases] Bases formula registry not available, file.bookmarks not registered");
		}
	}

	/**
	 * Create a StringValue that renders as a clickable link to highlight the bookmark.
	 * The link has no underline and no tooltip, keeps the previous link colour,
	 * and clicking highlights only the final file/folder bookmark in the Bookmarks view
	 * as if hovered/selected without highlighting the Bases cell.
	 
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
			console.warn("[Bookmarks-In-Bases] Bookmarks view not found");
			return;
		}
		await this.app.workspace.revealLeaf(leaf);

		window.setTimeout(() => {
			try {
				const view = (leaf as unknown as { view?: { containerEl?: HTMLElement } }).view;
				const container: HTMLElement | null = view?.containerEl ?? (leaf as unknown as { containerEl?: HTMLElement }).containerEl ?? document.querySelector('[data-type="bookmarks"]') as HTMLElement | null;
				if (!container) return;

				// Find file bookmark elements via [data-path] or similar
				const candidates = Array.from(container.querySelectorAll<HTMLElement>('[data-path]')).filter(
					(el) => el.getAttribute("data-path") === filePath,
				);

				// If no data-path candidates, fallback to searching tree items by file name
				let target: HTMLElement | null = null;

				if (candidates.length === 0) {
					// Fallback: search all tree items for file path text
					const all = Array.from(container.querySelectorAll<HTMLElement>('.tree-item, .nav-file, [data-type="bookmarks"] *'));
					// Try to find element whose text matches file basename
					target = null;
				} else if (candidates.length === 1) {
					target = candidates[0] ?? null;
				} else {
					// Multiple bookmarks for same file in different groups: disambiguate by parent group path
					// targetGroups includes final bookmark title, while collectBookmarkGroups returns only parent groups
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

				if (target) {
					target.scrollIntoView({ behavior: "smooth", block: "center" });
					// Only the final file/folder bookmark is highlighted, not the whole group path
					const highlightEl = (target.closest('.tree-item') as HTMLElement | null) ?? target;
					// Use native hover/selected styling: add is-active to the self row
					const selfEl = highlightEl.querySelector('.tree-item-self') as HTMLElement | null;
					const toHighlight = selfEl ?? highlightEl;
					toHighlight.addClass("bookmark-highlight");
					// Also add native selected-like class for accurate hover/selected look
					toHighlight.addClass("is-active");
					window.setTimeout(() => {
						toHighlight.removeClass("bookmark-highlight");
						toHighlight.removeClass("is-active");
					}, 1800);
				} else {
					// Only final bookmark should be highlighted; do not highlight group or container
					if (escapedPath) console.log(`[Bookmarks-In-Bases] Bookmark not found for highlight ${escapedPath} → ${filePath}`);
				}
			} catch (error) {
				console.error("[Bookmarks-In-Bases] highlight failed", error);
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
		let cur: HTMLElement | null = el.closest('.tree-item') as HTMLElement | null;
		// Walk up through parent tree-items to collect group titles
		// Obsidian bookmarks DOM: each group is .tree-item with .tree-item-self > .tree-item-inner
		while (cur && container.contains(cur)) {
			const parentGroup = cur.parentElement?.closest('.tree-item') as HTMLElement | null;
			if (!parentGroup) break;
			const titleEl = parentGroup.querySelector(':scope > .tree-item-self .tree-item-inner') as HTMLElement | null;
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
		if ((v["file"] as unknown) instanceof TFile) return v["file"] as TFile;
		if ((v["data"] as unknown) instanceof TFile) return v["data"] as TFile;
		if ((v["_file"] as unknown) instanceof TFile) return v["_file"] as TFile;

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
				const val = (v as Record<string, unknown>)[key];
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
		if (c["file"] instanceof TFile) {
			return c["file"] as TFile;
		}

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
	private getBookmarksPlugin(): unknown | null {
		const internalPlugins = (this.app as unknown as { internalPlugins?: { getPluginById?: (id: string) => unknown } }).internalPlugins;
		if (!internalPlugins) {
			return null;
		}
		const plugin = internalPlugins.getPluginById?.("bookmarks") as
			| { instance?: unknown; _instance?: unknown }
			| undefined;
		if (!plugin) {
			return null;
		}
		return (plugin as { instance?: unknown }).instance ?? (plugin as { _instance?: unknown })._instance ?? null;
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
			(bookmarks as { items?: BookmarkNode[] }).items ??
			(bookmarks as { _items?: BookmarkNode[] })._items ??
			(bookmarks as { instance?: { items?: BookmarkNode[] } }).instance?.items ??
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
