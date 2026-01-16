export interface DiscussionComment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  parentId?: string;
  edited?: boolean;
  editedAt?: number;
}

export interface Discussion {
  id: string;
  title: string;
  description: string;
  author: string;
  authorName?: string;
  category?: string;
  createdAt: number;
  commentCount: number;
  comments: DiscussionComment[];
  preview?: string;
  entity?: string;
  repo?: string;
}

const DISCUSSION_STORAGE_PREFIX = "gittr_discussions";

const getStorageKey = (entity: string, repo: string): string =>
  `${DISCUSSION_STORAGE_PREFIX}_${entity}_${repo}`;

const sanitizeComment = (raw: unknown): DiscussionComment | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const base = raw as Record<string, unknown>;
  const id = typeof base.id === "string" ? base.id : null;
  const author = typeof base.author === "string" ? base.author : null;
  if (!id || !author) {
    return null;
  }
  const content = typeof base.content === "string" ? base.content : "";
  const createdAt =
    typeof base.createdAt === "number" ? base.createdAt : Date.now();
  const comment: DiscussionComment = {
    id,
    author,
    content,
    createdAt,
  };
  if (typeof base.parentId === "string") {
    comment.parentId = base.parentId;
  }
  if (typeof base.edited === "boolean") {
    comment.edited = base.edited;
  }
  if (typeof base.editedAt === "number") {
    comment.editedAt = base.editedAt;
  }
  return comment;
};

const sanitizeComments = (raw: unknown): DiscussionComment[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => sanitizeComment(item))
    .filter((comment): comment is DiscussionComment => comment !== null);
};

const sanitizeDiscussion = (raw: unknown): Discussion | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const base = raw as Record<string, unknown>;
  const id = typeof base.id === "string" ? base.id : null;
  const title = typeof base.title === "string" ? base.title : null;
  const description =
    typeof base.description === "string" ? base.description : "";
  const author = typeof base.author === "string" ? base.author : null;
  if (!id || !title || !author) {
    return null;
  }
  const comments = sanitizeComments(base.comments);
  const createdAt =
    typeof base.createdAt === "number" ? base.createdAt : Date.now();
  const commentCount =
    typeof base.commentCount === "number" ? base.commentCount : comments.length;

  return {
    id,
    title,
    description,
    author,
    authorName:
      typeof base.authorName === "string" ? base.authorName : undefined,
    category: typeof base.category === "string" ? base.category : undefined,
    createdAt,
    commentCount,
    comments,
    preview: typeof base.preview === "string" ? base.preview : undefined,
    entity: typeof base.entity === "string" ? base.entity : undefined,
    repo: typeof base.repo === "string" ? base.repo : undefined,
  };
};

export const loadDiscussions = (entity: string, repo: string): Discussion[] => {
  try {
    const stored = localStorage.getItem(getStorageKey(entity, repo));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeDiscussion(item))
      .filter((discussion): discussion is Discussion => discussion !== null);
  } catch {
    return [];
  }
};

export const loadDiscussionById = (
  entity: string,
  repo: string,
  id: string
): Discussion | null => {
  const discussions = loadDiscussions(entity, repo);
  return discussions.find((discussion) => discussion.id === id) ?? null;
};

export const persistDiscussion = (
  entity: string,
  repo: string,
  updatedDiscussion: Discussion
): void => {
  const discussions = loadDiscussions(entity, repo);
  const exists = discussions.some(
    (discussion) => discussion.id === updatedDiscussion.id
  );
  const updatedList = exists
    ? discussions.map((discussion) =>
        discussion.id === updatedDiscussion.id ? updatedDiscussion : discussion
      )
    : [...discussions, updatedDiscussion];
  localStorage.setItem(
    getStorageKey(entity, repo),
    JSON.stringify(updatedList)
  );
};

export const appendDiscussion = (
  entity: string,
  repo: string,
  newDiscussion: Discussion
): void => {
  const discussions = loadDiscussions(entity, repo);
  discussions.push(newDiscussion);
  localStorage.setItem(
    getStorageKey(entity, repo),
    JSON.stringify(discussions)
  );
};
