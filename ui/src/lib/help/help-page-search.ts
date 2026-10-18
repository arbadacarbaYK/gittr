/**
 * Help is one long page of folded topics. Search matches each topic title
 * and the writing inside it, opens the path to a match, and hides the rest.
 */

export type HelpBlock = {
  id: string;
  parentId: string | null;
  /** Text that belongs to this block, not to a nested block. */
  ownText: string;
};

export type HelpBlockView = {
  visible: boolean;
  /** Open this fold so the match can be read. */
  open: boolean;
  /** This block's own text contains the query. */
  hit: boolean;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function queryTokens(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean);
}

function containsEvery(text: string, tokens: string[]): boolean {
  const hay = normalize(text);
  return tokens.every((token) => hay.includes(token));
}

function containsAny(text: string, tokens: string[]): boolean {
  const hay = normalize(text);
  return tokens.some((token) => hay.includes(token));
}

export function planHelpSearch(
  blocks: HelpBlock[],
  query: string
): Map<string, HelpBlockView> {
  const tokens = queryTokens(query);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const childIds = new Map<string, string[]>();
  for (const block of blocks) {
    const parent =
      block.parentId && byId.has(block.parentId) ? block.parentId : null;
    if (!parent) continue;
    const list = childIds.get(parent) ?? [];
    list.push(block.id);
    childIds.set(parent, list);
  }

  const treeText = new Map<string, string>();
  const buildTreeText = (id: string): string => {
    const cached = treeText.get(id);
    if (cached != null) return cached;
    const block = byId.get(id);
    const text = [
      block?.ownText ?? "",
      ...(childIds.get(id) ?? []).map((childId) => buildTreeText(childId)),
    ].join(" ");
    treeText.set(id, text);
    return text;
  };
  for (const block of blocks) buildTreeText(block.id);

  const ownHit = new Map<string, boolean>();
  const treeHit = new Map<string, boolean>();
  for (const block of blocks) {
    ownHit.set(
      block.id,
      tokens.length > 0 && containsEvery(block.ownText, tokens)
    );
    treeHit.set(
      block.id,
      tokens.length > 0 && containsEvery(treeText.get(block.id) ?? "", tokens)
    );
  }

  const ancestorOwnHit = (id: string): boolean => {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent && byId.has(parent)) {
      if (ownHit.get(parent)) return true;
      parent = byId.get(parent)?.parentId ?? null;
    }
    return false;
  };

  const ancestorTreeHit = (id: string): boolean => {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent && byId.has(parent)) {
      if (treeHit.get(parent)) return true;
      parent = byId.get(parent)?.parentId ?? null;
    }
    return false;
  };

  const views = new Map<string, HelpBlockView>();
  for (const block of blocks) {
    if (tokens.length === 0) {
      views.set(block.id, { visible: true, open: false, hit: false });
      continue;
    }
    const self = ownHit.get(block.id) === true;
    const tree = treeHit.get(block.id) === true;
    const partial = containsAny(treeText.get(block.id) ?? "", tokens);
    const visible =
      self ||
      tree ||
      ancestorOwnHit(block.id) ||
      (ancestorTreeHit(block.id) && partial);
    const open = visible && partial && !ancestorOwnHit(block.id);
    views.set(block.id, { visible, open, hit: self });
  }
  return views;
}

export function countHelpSearchHits(views: Map<string, HelpBlockView>): number {
  let count = 0;
  for (const view of views.values()) {
    if (view.hit) count += 1;
  }
  return count;
}

/** Full-text hits, or the visible pieces when the words are split across them. */
export function countVisibleHelpMatches(
  blocks: HelpBlock[],
  views: Map<string, HelpBlockView>
): number {
  const full = countHelpSearchHits(views);
  if (full > 0) return full;
  const hasVisibleChild = new Set<string>();
  for (const block of blocks) {
    if (!block.parentId) continue;
    if (views.get(block.id)?.visible) hasVisibleChild.add(block.parentId);
  }
  let leaves = 0;
  for (const block of blocks) {
    const view = views.get(block.id);
    if (!view?.visible || hasVisibleChild.has(block.id)) continue;
    leaves += 1;
  }
  return leaves;
}

const ownTextCache = new WeakMap<Element, string>();

function blockOwnText(el: Element): string {
  const cached = ownTextCache.get(el);
  if (cached != null) return cached;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("[data-help-block]").forEach((nested) => {
    nested.remove();
  });
  const slug = el.id ? ` ${el.id}` : "";
  const text = `${clone.textContent || ""} ${slug}`.replace(/\s+/g, " ").trim();
  ownTextCache.set(el, text);
  return text;
}

function markHelpListItems(root: ParentNode): void {
  const items = root.querySelectorAll("li");
  items.forEach((li, index) => {
    if (!(li instanceof Element)) return;
    if (li.getAttribute("data-help-block")) return;
    if (li.closest("svg")) return;
    li.setAttribute("data-help-block", li.id || `help-li-${index}`);
  });
}

export function collectHelpBlocks(root: ParentNode): HelpBlock[] {
  markHelpListItems(root);
  const blocks: HelpBlock[] = [];
  root.querySelectorAll("[data-help-block]").forEach((el) => {
    const id = el.getAttribute("data-help-block") || "";
    if (!id) return;
    const parentEl = el.parentElement?.closest("[data-help-block]") ?? null;
    blocks.push({
      id,
      parentId: parentEl?.getAttribute("data-help-block") ?? null,
      ownText: blockOwnText(el),
    });
  });
  return blocks;
}

/** Show matching folds and remember how they were folded before the search. */
export function applyHelpSearch(root: ParentNode, query: string): number {
  const blocks = collectHelpBlocks(root);
  const views = planHelpSearch(blocks, query);
  const active = queryTokens(query).length > 0;
  root.querySelectorAll("[data-help-block]").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const id = node.getAttribute("data-help-block") || "";
    const view = views.get(id);
    if (!view) return;
    const details = node instanceof HTMLDetailsElement ? node : null;
    if (!active) {
      node.hidden = false;
      delete node.dataset.helpHit;
      if (details && details.dataset.helpPrevOpen != null) {
        details.open = details.dataset.helpPrevOpen === "1";
        delete details.dataset.helpPrevOpen;
      }
      return;
    }
    if (details && details.dataset.helpPrevOpen == null) {
      details.dataset.helpPrevOpen = details.open ? "1" : "0";
    }
    node.hidden = !view.visible;
    if (view.hit) node.dataset.helpHit = "1";
    else delete node.dataset.helpHit;
    if (details) details.open = view.open;
  });
  return countVisibleHelpMatches(blocks, views);
}
