import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

type NotificationType =
  | "like"
  | "comment"
  | "follow"
  | "mention"
  | "repost"
  | "system_update";

async function getDisplayName(ctx: any, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  return profile?.displayName || user?.name || user?.email || "Anonymous";
}

async function requireNonGuestUserId(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (user?.isAnonymous) {
    throw new Error("Create an account to interact publicly.");
  }
  return userId as Id<"users">;
}

async function upsertNotification(
  ctx: any,
  args: {
    recipientId: Id<"users">;
    actorId?: Id<"users">;
    type: NotificationType;
    message: string;
    postId?: Id<"posts">;
    commentId?: Id<"comments">;
    profileId?: Id<"users">;
    groupKey?: string;
  },
) {
  const now = Date.now();
  if (args.groupKey) {
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_group", (q: any) =>
        q.eq("recipientId", args.recipientId).eq("groupKey", args.groupKey),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        actorId: args.actorId,
        type: args.type,
        message: args.message,
        postId: args.postId,
        commentId: args.commentId,
        profileId: args.profileId,
        createdAt: now,
        readAt: undefined,
      });
      return existing._id;
    }
  }

  return await ctx.db.insert("notifications", {
    recipientId: args.recipientId,
    actorId: args.actorId,
    type: args.type,
    message: args.message,
    postId: args.postId,
    commentId: args.commentId,
    profileId: args.profileId,
    groupKey: args.groupKey,
    readAt: undefined,
    createdAt: now,
  });
}

async function deleteNotificationByGroup(
  ctx: any,
  recipientId: Id<"users">,
  groupKey: string,
) {
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_recipient_group", (q: any) =>
      q.eq("recipientId", recipientId).eq("groupKey", groupKey),
    )
    .collect();
  await Promise.all(notifications.map((notification: any) => ctx.db.delete(notification._id)));
}

function extractMentions(content: string) {
  const matches = content.match(/@([a-zA-Z0-9_.-]{2,32})/g) || [];
  const handles = matches.map((value) => value.slice(1).toLowerCase());
  return Array.from(new Set(handles));
}

async function getMentionedUserIds(ctx: any, content: string) {
  const handles = extractMentions(content);
  if (handles.length === 0) return [] as Id<"users">[];

  const profiles = await ctx.db.query("profiles").collect();
  const byHandle = new Map<string, Id<"users">>();
  for (const profile of profiles) {
    const key = profile.displayName.trim().toLowerCase();
    if (!byHandle.has(key)) {
      byHandle.set(key, profile.userId);
    }
  }

  const mentionedIds = handles
    .map((handle) => byHandle.get(handle))
    .filter((value): value is Id<"users"> => value !== undefined);

  return Array.from(new Set(mentionedIds));
}

async function buildPostWithViewer(ctx: any, post: any, viewerId: Id<"users"> | null) {
  const author = await ctx.db.get(post.authorId);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", post.authorId))
    .unique();

  const userLike = viewerId
    ? await ctx.db
        .query("likes")
        .withIndex("by_user_and_post", (q: any) =>
          q.eq("userId", viewerId).eq("postId", post._id),
        )
        .unique()
    : null;

  const userRepost = viewerId
    ? await ctx.db
        .query("reposts")
        .withIndex("by_user_and_post", (q: any) =>
          q.eq("userId", viewerId).eq("postId", post._id),
        )
        .unique()
    : null;

  return {
    ...post,
    repostsCount: post.repostsCount ?? 0,
    author: {
      id: post.authorId,
      displayName: profile?.displayName || author?.name || "Anonymous",
      avatar: profile?.avatar,
      avatarUrl: profile?.avatar ? await ctx.storage.getUrl(profile.avatar) : null,
    },
    isLiked: !!userLike,
    isReposted: !!userRepost,
  };
}

export const createPost = mutation({
  args: {
    type: v.union(v.literal("song"), v.literal("playlist"), v.literal("thought")),
    title: v.string(),
    content: v.string(),
    spotifyUrl: v.optional(v.string()),
    appleMusicUrl: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);

    return await ctx.db.insert("posts", {
      authorId: userId,
      type: args.type,
      title: args.title,
      content: args.content,
      spotifyUrl: args.spotifyUrl,
      appleMusicUrl: args.appleMusicUrl,
      youtubeUrl: args.youtubeUrl,
      tags: args.tags || [],
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
    });
  },
});

export const getFeedPosts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const limit = args.limit || 20;

    let posts = await ctx.db.query("posts").order("desc").take(limit * 2);

    if (userId) {
      const follows = await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", userId))
        .collect();

      const followingIds = follows.map((f) => f.followingId);
      followingIds.push(userId);

      posts = posts.filter((post) => followingIds.includes(post.authorId)).slice(0, limit);
    } else {
      posts = posts.slice(0, limit);
    }

    return await Promise.all(posts.map((post) => buildPostWithViewer(ctx, post, userId)));
  },
});

export const getPublicFeedPosts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const limit = args.limit || 20;
    const posts = await ctx.db.query("posts").order("desc").take(limit);
    return await Promise.all(posts.map((post) => buildPostWithViewer(ctx, post, userId)));
  },
});

export const getUserPosts = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", args.userId))
      .order("desc")
      .collect();
    return await Promise.all(posts.map((post) => buildPostWithViewer(ctx, post, currentUserId)));
  },
});

export const getPostById = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) return null;
    return await buildPostWithViewer(ctx, post, currentUserId);
  },
});

export const toggleLike = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);

    const existingLike = await ctx.db
      .query("likes")
      .withIndex("by_user_and_post", (q) => q.eq("userId", userId).eq("postId", args.postId))
      .unique();

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    const groupKey = `like:${args.postId}:${userId}`;
    if (existingLike) {
      await ctx.db.delete(existingLike._id);
      await ctx.db.patch(args.postId, { likesCount: Math.max(0, post.likesCount - 1) });
      if (post.authorId !== userId) {
        await deleteNotificationByGroup(ctx, post.authorId, groupKey);
      }
      return false;
    }

    await ctx.db.insert("likes", { userId, postId: args.postId });
    await ctx.db.patch(args.postId, { likesCount: post.likesCount + 1 });

    if (post.authorId !== userId) {
      const actorName = await getDisplayName(ctx, userId);
      await upsertNotification(ctx, {
        recipientId: post.authorId,
        actorId: userId,
        type: "like",
        postId: args.postId,
        message: `${actorName} liked your post`,
        groupKey,
      });
    }

    return true;
  },
});

export const toggleRepost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);

    const existingRepost = await ctx.db
      .query("reposts")
      .withIndex("by_user_and_post", (q) => q.eq("userId", userId).eq("postId", args.postId))
      .unique();

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    const currentReposts = post.repostsCount ?? 0;
    const groupKey = `repost:${args.postId}:${userId}`;
    if (existingRepost) {
      await ctx.db.delete(existingRepost._id);
      await ctx.db.patch(args.postId, { repostsCount: Math.max(0, currentReposts - 1) });
      if (post.authorId !== userId) {
        await deleteNotificationByGroup(ctx, post.authorId, groupKey);
      }
      return false;
    }

    await ctx.db.insert("reposts", { userId, postId: args.postId });
    await ctx.db.patch(args.postId, { repostsCount: currentReposts + 1 });

    if (post.authorId !== userId) {
      const actorName = await getDisplayName(ctx, userId);
      await upsertNotification(ctx, {
        recipientId: post.authorId,
        actorId: userId,
        type: "repost",
        postId: args.postId,
        message: `${actorName} reposted your post`,
        groupKey,
      });
    }

    return true;
  },
});

export const addComment = mutation({
  args: {
    postId: v.id("posts"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);

    const trimmed = args.content.trim();
    if (!trimmed) throw new Error("Comment cannot be empty");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    const mentionedUserIds = await getMentionedUserIds(ctx, trimmed);
    const commentId = await ctx.db.insert("comments", {
      authorId: userId,
      postId: args.postId,
      content: trimmed,
      mentionedUserIds,
    });

    await ctx.db.patch(args.postId, { commentsCount: post.commentsCount + 1 });

    const actorName = await getDisplayName(ctx, userId);
    if (post.authorId !== userId) {
      await upsertNotification(ctx, {
        recipientId: post.authorId,
        actorId: userId,
        type: "comment",
        postId: args.postId,
        commentId,
        message: `${actorName} commented on your post`,
        groupKey: `comment:${commentId}`,
      });
    }

    await Promise.all(
      mentionedUserIds
        .filter((mentionedId) => mentionedId !== userId && mentionedId !== post.authorId)
        .map((mentionedId) =>
          upsertNotification(ctx, {
            recipientId: mentionedId,
            actorId: userId,
            type: "mention",
            postId: args.postId,
            commentId,
            message: `${actorName} mentioned you in a comment`,
            groupKey: `mention:${commentId}:${mentionedId}`,
          }),
        ),
    );

    return commentId;
  },
});

export const getComments = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .order("asc")
      .collect();

    return await Promise.all(
      comments.map(async (comment) => {
        const author = await ctx.db.get(comment.authorId);
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", comment.authorId))
          .unique();

        return {
          ...comment,
          author: {
            id: comment.authorId,
            displayName: profile?.displayName || author?.name || "Anonymous",
            avatar: profile?.avatar,
            avatarUrl: profile?.avatar ? await ctx.storage.getUrl(profile.avatar) : null,
          },
        };
      }),
    );
  },
});

export const deletePost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");
    if (post.authorId !== userId) throw new Error("You can only delete your own posts");

    const [likes, reposts, comments] = await Promise.all([
      ctx.db
        .query("likes")
        .withIndex("by_post", (q) => q.eq("postId", args.postId))
        .collect(),
      ctx.db
        .query("reposts")
        .withIndex("by_post", (q) => q.eq("postId", args.postId))
        .collect(),
      ctx.db
        .query("comments")
        .withIndex("by_post", (q) => q.eq("postId", args.postId))
        .collect(),
    ]);

    await Promise.all([
      ...likes.map((like) => ctx.db.delete(like._id)),
      ...reposts.map((repost) => ctx.db.delete(repost._id)),
      ...comments.map((comment) => ctx.db.delete(comment._id)),
    ]);

    await ctx.db.delete(args.postId);
  },
});

export const searchPosts = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    const results = await ctx.db
      .query("posts")
      .withSearchIndex("search_posts", (q) => q.search("content", args.searchTerm))
      .take(20);

    return await Promise.all(results.map((post) => buildPostWithViewer(ctx, post, userId)));
  },
});
