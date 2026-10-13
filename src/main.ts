import { Plugin } from "obsidian";
import { registerBookmarkFormulas } from "./formulas";

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
export default class BookmarkPathsPlugin extends Plugin {
	async onload() {
		// Bases is not ready at onload, so defer registration until the layout is
		// ready. onLayoutReady runs the callback immediately when the layout is
		// already loaded (for example on plugin reload), so no separate eager
		// registration is needed.
		this.app.workspace.onLayoutReady(() => {
			registerBookmarkFormulas(this, this.app);
		});
	}
}