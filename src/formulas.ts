import { App, BooleanValue, FileValue, ListValue, NullValue, StringValue } from "obsidian";
import { BookmarkValue } from "./bookmark-value";
import { getBookmarkValues, getFileFromFormulaContext, getFileFromValue } from "./bookmarks";
import { BookmarkViewHighlighter } from "./highlight";
import type { BasesInstanceFunc, BasesRegistry } from "./types";

/**
 * Register Bases formula functions.
 *
 * Primary: file.bookmarks -> List<BookmarkValue> (instance func on FileValue)
 * Bookmark ops: bookmark.path() / bookmark.fullPath() and bookmark.folder() / bookmark.parent()
 */
export function registerBookmarkFormulas(plugin: unknown, app: App): void {
	const registry = plugin as BasesRegistry;
	const register = registry.registerInstanceFunc;
	if (typeof register !== "function") {
		return;
	}

	const highlighter = new BookmarkViewHighlighter(app);

	// --- file.bookmarks -> List<BookmarkValue> (final segment display) ---
	try {
		register(FileValue, {
			name: "bookmarks",
			docString: () => "Returns the list of bookmarks for the file (final segments).",
			params: [{ name: "self", type: [FileValue], optional: false }],
			applyWithContext: (ctx: unknown, self: unknown) => {
				const file = getFileFromValue(app, self) ?? getFileFromFormulaContext(app, ctx);
				if (!file) return new ListValue([]);
				return new ListValue(getBookmarkValues(app, file, highlighter));
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
				const file = getFileFromValue(app, self) ?? getFileFromFormulaContext(app, ctx);
				if (!file) return new BooleanValue(false);
				return new BooleanValue(getBookmarkValues(app, file, highlighter).length > 0);
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