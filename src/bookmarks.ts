import { App, TFile } from "obsidian";
import { BookmarkValue } from "./bookmark-value";
import type { BookmarkGroup, BookmarkHighlighter, BookmarkItem, BookmarkNode } from "./types";

/**
 * Get the internal Bookmarks core plugin.
 */
export function getBookmarksPlugin(app: App): unknown {
	const internalPlugins = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => unknown } }).internalPlugins;
	if (!internalPlugins) return null;
	const plugin = internalPlugins.getPluginById?.("bookmarks");
	if (!plugin) return null;
	const record = plugin as { instance?: unknown; _instance?: unknown };
	return record.instance ?? record._instance ?? null;
}

/**
 * Try to extract TFile from a FileValue or similar wrapper.
 * FileValue is opaque and not documented; probe several shapes.
 */
export function getFileFromValue(app: App, value: unknown): TFile | null {
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
			const f = app.vault.getAbstractFileByPath(p);
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
				const f = app.vault.getAbstractFileByPath(p);
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
export function getFileFromFormulaContext(app: App, ctx: unknown): TFile | null {
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
			const file = app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return file;
			}
		}
	}

	return null;
}

/**
 * Return BookmarkValue objects for a file.
 * Each value display is the final segment, holds fullPath and folder.
 */
export function getBookmarkValues(app: App, file: TFile, highlighter: BookmarkHighlighter): BookmarkValue[] {
	const bookmarks = getBookmarksPlugin(app) as
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
	walkBookmarkTreeForValues(rootItems, [], file.path, file, highlighter, results);
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
function walkBookmarkTreeForValues(
	items: BookmarkNode[],
	groupPath: string[],
	filePath: string,
	file: TFile,
	highlighter: BookmarkHighlighter,
	results: BookmarkValue[],
) {
	for (const item of items) {
		if (!item) continue;

		if (item.type === "group" || Array.isArray((item as BookmarkGroup).items)) {
			const group = item as BookmarkGroup;
			const title = typeof group.title === "string" ? group.title : "";
			const nextPath = title ? [...groupPath, title] : groupPath;
			if (Array.isArray(group.items)) {
				walkBookmarkTreeForValues(group.items, nextPath, filePath, file, highlighter, results);
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
			results.push(new BookmarkValue(file, fullPath, folder, finalTitle, highlighter));
		}
	}
}