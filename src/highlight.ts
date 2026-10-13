import { App } from "obsidian";
import { getBookmarksPlugin } from "./bookmarks";
import type { BookmarkGroup, BookmarkHighlighter, BookmarkItem, BookmarkNode } from "./types";

/**
 * Highlights a bookmark in the Bookmarks view.
 *
 * Decodes escaped slashes (//) and tries to find the matching DOM node.
 * Uses multiple strategies: internal view.itemDoms WeakMap, [data-path], and
 * text fallback, expands collapsed ancestor groups via click, and applies a
 * visible flash.
 */
export class BookmarkViewHighlighter implements BookmarkHighlighter {
	constructor(private app: App) {}

	public async highlightBookmark(escapedPath: string, filePath: string): Promise<void> {
		const targetGroups = this.decodeEscapedPath(escapedPath);
		const targetTitle = targetGroups.length > 0 ? (targetGroups[targetGroups.length - 1] ?? "") : (filePath.split("/").pop() ?? filePath);
		const parentTarget = targetGroups.slice(0, -1);

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

		// Wait for view to render (revealing + possible creation)
		await new Promise<void>((resolve) => window.setTimeout(resolve, 220));

		const attemptHighlight = (retriesLeft: number): void => {
			try {
				const view = (leaf as unknown as { view?: { containerEl?: HTMLElement; plugin?: unknown; itemDoms?: unknown } }).view;
				const container =
					view?.containerEl ??
					(leaf as unknown as { containerEl?: HTMLElement }).containerEl ??
					document.querySelector<HTMLElement>('[data-type="bookmarks"]');
				if (!container) {
					if (retriesLeft > 0) window.setTimeout(() => attemptHighlight(retriesLeft - 1), 300);
					return;
				}

				// Clear any previous highlight from earlier clicks
				for (const el of Array.from(container.querySelectorAll<HTMLElement>(".bookmark-highlight"))) {
					el.classList.remove("bookmark-highlight");
					el.classList.remove("is-active");
					(el as unknown as { removeClass?: (c: string) => void }).removeClass?.("bookmark-highlight");
					(el as unknown as { removeClass?: (c: string) => void }).removeClass?.("is-active");
				}
				for (const el of Array.from(document.querySelectorAll<HTMLElement>(".bookmark-highlight"))) {
					el.classList.remove("bookmark-highlight");
					el.classList.remove("is-active");
					(el as unknown as { removeClass?: (c: string) => void }).removeClass?.("bookmark-highlight");
					(el as unknown as { removeClass?: (c: string) => void }).removeClass?.("is-active");
				}

				// If the bookmark is inside a closed folder (group), open the full folder chain first.
				// Do this before searching for the bookmark DOM, because collapsed groups hide their children
				// (sometimes they are not even rendered) and the highlight would be invisible.
				if (parentTarget.length > 0) {
					const expanded = this.expandGroupsByTitles(parentTarget, container);
					if (expanded > 0) {
						// Give the Bookmarks view time to render the children after the click
						if (retriesLeft > 0) {
							window.setTimeout(() => attemptHighlight(retriesLeft - 1), 380);
							return;
						}
					}
				}

				let target: HTMLElement | null = null;

				// Strategy 1: internal view.itemDoms WeakMap (most reliable on recent Obsidian)
				try {
					const anyView = view as unknown as {
						itemDoms?: WeakMap<object, { titleEl?: HTMLElement; selfEl?: HTMLElement; el?: HTMLElement }>;
						plugin?: { items?: BookmarkNode[] };
					};
					const itemDoms = anyView?.itemDoms;
					const pluginInst = (anyView?.plugin) ?? (getBookmarksPlugin(this.app) as { items?: BookmarkNode[] } | null);
					const items: BookmarkNode[] | undefined = pluginInst?.items;
					if (itemDoms && Array.isArray(items) && items.length > 0) {
						// Build map item -> groupPath for disambiguation
						const pathMap = new Map<object, string[]>();
						const walk = (nodes: BookmarkNode[], curPath: string[]): void => {
							for (const n of nodes) {
								if (!n) continue;
								if ((n as BookmarkGroup).type === "group" || Array.isArray((n as BookmarkGroup).items)) {
									const g = n as BookmarkGroup;
									const t = typeof g.title === "string" ? g.title : "";
									const next = t ? [...curPath, t] : curPath;
									if (Array.isArray(g.items)) walk(g.items, next);
								} else {
									pathMap.set(n, curPath);
								}
							}
						};
						walk(items, []);
						const candidates = (items as unknown as BookmarkItem[]).filter((it) => it.type === "file" && it.path === filePath);
						// Prefer exact group match
						for (const cand of candidates) {
							const g = pathMap.get(cand) ?? [];
							if (this.arraysEqual(g, parentTarget)) {
								const dom = itemDoms.get(cand);
								if (dom) {
									const el = (dom.titleEl?.closest?.(".tree-item-self") as HTMLElement | null) ?? dom.selfEl ?? dom.el ?? dom.titleEl ?? null;
									if (el instanceof HTMLElement) {
										target = el;
										break;
									}
								}
							}
						}
						if (!target && candidates.length === 1) {
							const dom = itemDoms.get(candidates[0] as object);
							if (dom) {
								const el = (dom.titleEl?.closest?.(".tree-item-self") as HTMLElement | null) ?? dom.selfEl ?? dom.el ?? dom.titleEl ?? null;
								if (el instanceof HTMLElement) target = el;
							}
						}
						if (!target && candidates.length > 1) {
							for (const cand of candidates) {
								const dom = itemDoms.get(cand);
								if (dom) {
									const el = (dom.titleEl?.closest?.(".tree-item-self") as HTMLElement | null) ?? dom.selfEl ?? dom.el ?? dom.titleEl ?? null;
									if (el instanceof HTMLElement) {
										target = el;
										break;
									}
								}
							}
						}
					}
				} catch {
					// ignore, fallback to DOM search
				}

				// Strategy 2: [data-path] search
				if (!target) {
					let candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-path]")).filter(
						(el) => el.getAttribute("data-path") === filePath,
					);
					if (candidates.length === 0) {
						candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-type="bookmarks"] [data-path]')).filter(
							(el) => el.getAttribute("data-path") === filePath,
						);
					}
					if (candidates.length === 1) {
						target = candidates[0] ?? null;
					} else if (candidates.length > 1) {
						for (const cand of candidates) {
							const groups = this.collectBookmarkGroups(cand, container);
							if (this.arraysEqual(groups, parentTarget)) {
								target = cand;
								break;
							}
						}
						if (!target) target = candidates[0] ?? null;
					} else if (candidates.length === 0 && targetTitle) {
						// no data-path candidates yet, keep target null for text fallback
					}
				}

				// Strategy 3: text fallback via .tree-item-inner === targetTitle
				if (!target && targetTitle) {
					const allInners = Array.from(container.querySelectorAll<HTMLElement>(".tree-item-inner"));
					const matchingInners = allInners.filter((el) => (el.textContent?.trim() ?? "") === targetTitle);
					for (const inner of matchingInners) {
						const self = inner.closest<HTMLElement>(".tree-item-self");
						if (!self) continue;
						// Check data-path on self or parent tree-item if present, else check groups
						const dp = self.getAttribute("data-path") ?? self.closest<HTMLElement>("[data-path]")?.getAttribute("data-path");
						if (dp && dp !== filePath) continue;
						const groups = this.collectBookmarkGroups(self, container);
						if (this.arraysEqual(groups, parentTarget)) {
							target = self;
							break;
						}
					}
					if (!target && matchingInners.length === 1) {
						const first = matchingInners[0];
						if (first) {
							const self = first.closest<HTMLElement>(".tree-item-self");
							if (self) target = self;
						}
					}
					if (!target && matchingInners.length > 0) {
						const first = matchingInners[0];
						if (first) {
							const self = first.closest<HTMLElement>(".tree-item-self");
							if (self) target = self;
						}
					}
					// Final fallback: any tree-item that contains data-path or text, search document-wide in bookmarks
					if (!target) {
						const docInners = Array.from(document.querySelectorAll<HTMLElement>('[data-type="bookmarks"] .tree-item-inner')).filter(
							(el) => (el.textContent?.trim() ?? "") === targetTitle,
						);
						for (const inner of docInners) {
							const self = inner.closest<HTMLElement>(".tree-item-self");
							if (!self) continue;
							const groups = this.collectBookmarkGroups(self, container);
							if (this.arraysEqual(groups, parentTarget)) {
								target = self;
								break;
							}
						}
						if (!target && docInners.length > 0) {
							const firstDoc = docInners[0];
							if (firstDoc) target = firstDoc.closest<HTMLElement>(".tree-item-self") ?? firstDoc;
						}
					}
				}

				if (!target) {
					if (retriesLeft > 0) {
						window.setTimeout(() => attemptHighlight(retriesLeft - 1), 350);
					}
					return;
				}

				// Expand collapsed ancestor groups so the target becomes visible (click to trigger internal state)
				const toExpand: HTMLElement[] = [];
				let cur: HTMLElement | null = target.closest<HTMLElement>(".tree-item");
				while (cur && container.contains(cur)) {
					const parentGroup = cur.parentElement?.closest<HTMLElement>(".tree-item") ?? null;
					if (!parentGroup) break;
					if (parentGroup.classList.contains("is-collapsed")) toExpand.unshift(parentGroup);
					cur = parentGroup;
				}

				const doHighlight = (): void => {
					if (!target) return;
					target.scrollIntoView({ behavior: "smooth", block: "center" });

					let toHighlight: HTMLElement | null = null;
					if (target.classList.contains("tree-item-self")) {
						toHighlight = target;
					} else {
						const treeItem = target.closest<HTMLElement>(".tree-item");
						if (treeItem) {
							let selfEl: HTMLElement | null = null;
							try {
								selfEl = treeItem.querySelector<HTMLElement>(":scope > .tree-item-self");
							} catch {
								selfEl = null;
							}
							if (!selfEl) selfEl = treeItem.querySelector<HTMLElement>(".tree-item-self");
							toHighlight = selfEl ?? treeItem;
						} else {
							toHighlight = target.closest<HTMLElement>(".tree-item-self") ?? target;
						}
					}
					if (!toHighlight) return;

					toHighlight.classList.add("bookmark-highlight");
					toHighlight.classList.add("is-active");
					(toHighlight as unknown as { addClass?: (c: string) => void }).addClass?.("bookmark-highlight");
					(toHighlight as unknown as { addClass?: (c: string) => void }).addClass?.("is-active");

					window.setTimeout(() => {
						if (!toHighlight) return;
						toHighlight.classList.remove("bookmark-highlight");
						toHighlight.classList.remove("is-active");
						(toHighlight as unknown as { removeClass?: (c: string) => void }).removeClass?.("bookmark-highlight");
						(toHighlight as unknown as { removeClass?: (c: string) => void }).removeClass?.("is-active");
					}, 2200);
				};

				if (toExpand.length === 0) {
					window.requestAnimationFrame(() => doHighlight());
					return;
				}

				// Sequentially expand collapsed groups by clicking their collapse controls
				const expandNext = (idx: number): void => {
					if (idx >= toExpand.length) {
						window.setTimeout(() => window.requestAnimationFrame(() => doHighlight()), 120);
						return;
					}
					const grp = toExpand[idx];
					if (!grp) {
						window.setTimeout(() => expandNext(idx + 1), 10);
						return;
					}
					// Prefer clicking the collapse icon, fallback to the self row
					const clickEl =
						grp.querySelector<HTMLElement>(".tree-item-self .collapse-icon") ??
						grp.querySelector<HTMLElement>(".tree-item-self");
					let fallbackSelf: HTMLElement | null = null;
					try {
						fallbackSelf = grp.querySelector<HTMLElement>(":scope > .tree-item-self");
					} catch {
						fallbackSelf = null;
					}
					const targetClick = clickEl ?? fallbackSelf;
					if (targetClick) {
						try {
							targetClick.click();
						} catch {
							// ignore
						}
					}
					window.setTimeout(() => expandNext(idx + 1), 160);
				};
				expandNext(0);
			} catch {
				// ignore
			}
		};

		attemptHighlight(3);
	}

	private expandGroupsByTitles(titles: string[], container: HTMLElement): number {
		if (titles.length === 0) return 0;
		let expanded = 0;
		let searchRoot: HTMLElement = container;
		for (const title of titles) {
			// Find collapsed group with this title inside current searchRoot
			let found: HTMLElement | null = null;
			const collapsedCandidates = Array.from(searchRoot.querySelectorAll<HTMLElement>(".tree-item.is-collapsed"));
			for (const cand of collapsedCandidates) {
				let titleEl: HTMLElement | null = null;
				try {
					titleEl = cand.querySelector<HTMLElement>(":scope > .tree-item-self .tree-item-inner");
				} catch {
					titleEl = null;
				}
				if (!titleEl) {
					const selfEl = cand.querySelector<HTMLElement>(":scope > .tree-item-self");
					if (selfEl) titleEl = selfEl.querySelector<HTMLElement>(".tree-item-inner");
				}
				if (!titleEl) {
					const directSelf = Array.from(cand.children).find((c) => (c as HTMLElement).classList?.contains("tree-item-self")) as
						| HTMLElement
						| undefined;
					if (directSelf) titleEl = directSelf.querySelector<HTMLElement>(".tree-item-inner");
				}
				if ((titleEl?.textContent?.trim() ?? "") !== title) continue;
				if (!searchRoot.contains(cand)) continue;
				found = cand;
				break;
			}
			if (found) {
				const clickEl =
					found.querySelector<HTMLElement>(".tree-item-self .collapse-icon") ??
					found.querySelector<HTMLElement>(".tree-item-self");
				let fallbackSelf: HTMLElement | null = null;
				try {
					fallbackSelf = found.querySelector<HTMLElement>(":scope > .tree-item-self");
				} catch {
					fallbackSelf = null;
				}
				const toClick = clickEl ?? fallbackSelf;
				if (toClick) {
					try {
						toClick.click();
					} catch {
						// ignore
					}
				}
				expanded++;
				const nextChildren = found.querySelector<HTMLElement>(".tree-item-children");
				if (nextChildren) searchRoot = nextChildren;
				continue;
			}
			// No collapsed group for this title at this level — descend into the already-open group
			// so the next title is searched in the correct nesting level.
			let openGroup: HTMLElement | null = null;
			const allGroups = Array.from(searchRoot.querySelectorAll<HTMLElement>(".tree-item"));
			for (const cand of allGroups) {
				let titleEl: HTMLElement | null = null;
				try {
					titleEl = cand.querySelector<HTMLElement>(":scope > .tree-item-self .tree-item-inner");
				} catch {
					titleEl = null;
				}
				if (!titleEl) {
					const selfEl = cand.querySelector<HTMLElement>(":scope > .tree-item-self");
					if (selfEl) titleEl = selfEl.querySelector<HTMLElement>(".tree-item-inner");
				}
				if (!titleEl) continue;
				if ((titleEl.textContent?.trim() ?? "") !== title) continue;
				// Ensure this group is a direct descendant of searchRoot's lineage (not a distant branch)
				if (!searchRoot.contains(cand)) continue;
				openGroup = cand;
				break;
			}
			if (openGroup) {
				const nextChildren = openGroup.querySelector<HTMLElement>(".tree-item-children");
				if (nextChildren) searchRoot = nextChildren;
			}
		}
		// Also brute-force any remaining collapsed groups whose title is in the chain but were not
		// found due to searchRoot scoping (e.g., groups not nested under previous title in DOM but logically same).
		if (expanded === 0) {
			const remainingCollapsed = Array.from(container.querySelectorAll<HTMLElement>(".tree-item.is-collapsed"));
			for (const grp of remainingCollapsed) {
				let titleEl: HTMLElement | null = null;
				try {
					titleEl = grp.querySelector<HTMLElement>(":scope > .tree-item-self .tree-item-inner");
				} catch {
					titleEl = null;
				}
				if (!titleEl) {
					const selfEl = grp.querySelector<HTMLElement>(":scope > .tree-item-self");
					if (selfEl) titleEl = selfEl.querySelector<HTMLElement>(".tree-item-inner");
				}
				if (!titleEl) continue;
				const t = titleEl.textContent?.trim() ?? "";
				if (!titles.includes(t)) continue;
				const clickEl = grp.querySelector<HTMLElement>(".tree-item-self .collapse-icon") ?? grp.querySelector<HTMLElement>(".tree-item-self");
				if (clickEl) {
					try {
						clickEl.click();
					} catch {
						// ignore
					}
				}
				expanded++;
			}
		}
		return expanded;
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
		let cur: HTMLElement | null = el.closest<HTMLElement>(".tree-item");
		// Walk up through parent tree-items to collect group titles.
		// Obsidian bookmarks DOM: each group is a .tree-item with .tree-item-self > .tree-item-inner.
		while (cur && container.contains(cur)) {
			const parentGroup = cur.parentElement?.closest<HTMLElement>(".tree-item") ?? null;
			if (!parentGroup) break;
			let titleEl: HTMLElement | null = null;
			try {
				titleEl = parentGroup.querySelector<HTMLElement>(":scope > .tree-item-self .tree-item-inner");
			} catch {
				titleEl = null;
			}
			if (!titleEl) {
				// Fallback for environments where :scope is not supported or structure differs
				const selfEl = parentGroup.querySelector<HTMLElement>(":scope > .tree-item-self");
				if (selfEl) titleEl = selfEl.querySelector<HTMLElement>(".tree-item-inner");
				if (!titleEl) {
					// Last resort: first .tree-item-inner that is direct child of first .tree-item-self
					const directSelf = Array.from(parentGroup.children).find((c) =>
						(c as HTMLElement).classList?.contains("tree-item-self"),
					) as HTMLElement | undefined;
					if (directSelf) titleEl = directSelf.querySelector<HTMLElement>(".tree-item-inner");
				}
			}
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
}