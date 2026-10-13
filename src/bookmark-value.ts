import { TFile, Value } from "obsidian";
import type { BookmarkHighlighter } from "./types";

/**
 * Bookmark value for Bases.
 * Display is the final segment (bookmark title), but holds full path and folder.
 */
export class BookmarkValue extends Value {
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
