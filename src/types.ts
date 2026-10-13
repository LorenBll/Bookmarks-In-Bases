export interface BookmarkItem {
	type?: string;
	title?: string;
	path?: string;
	subpath?: string;
}

export interface BookmarkGroup {
	type?: string;
	title?: string;
	items?: BookmarkNode[];
}

export type BookmarkNode = BookmarkItem | BookmarkGroup;

export interface BookmarkHighlighter {
	highlightBookmark(escapedPath: string, filePath: string): Promise<void>;
}

export interface BasesInstanceFunc {
	name: string;
	docString: () => string;
	params: unknown[];
	applyWithContext: (ctx: unknown, ...args: unknown[]) => unknown;
}

export interface BasesRegistry {
	registerInstanceFunc?: (valueType: unknown, func: BasesInstanceFunc) => void;
}
