import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

type NotificationType =
  | "like"
  | "comment"
  | "follow"
  | "mention"
  | "repost"
  | "share"
  | "friend_listening"
  | "network_trending"
  | "system_update";

const PRESENCE_INACTIVITY_MS = 2 * 60 * 1000;

async function getDisplayName(ctx: any, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  return profile?.displayName || user?.name || user?.email || "Anonymous";
}

function getSeedEmails() {
  const raw = (process.env.SEED_ACCOUNT_EMAILS || "").trim();
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function getSeedUserIds(ctx: any, excludeUserId: Id<"users">) {
  const seedEmails = getSeedEmails();
  if (seedEmails.length === 0) return [] as Id<"users">[];

  const users = await ctx.db.query("users").collect();
  const seedSet = new Set(seedEmails);
  return users
    .filter((user: any) => !user?.isAnonymous)
    .filter((user: any) => user?._id !== excludeUserId)
    .filter((user: any) => {
      const email = String(user?.email || "").toLowerCase();
      return email && seedSet.has(email);
    })
    .map((user: any) => user._id as Id<"users">);
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
      await ctx.scheduler.runAfter(0, internal.push.dispatchPushForNotification, {
        notificationId: existing._id,
      });
      return existing._id;
    }
  }

  const notificationId = await ctx.db.insert("notifications", {
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

  await ctx.scheduler.runAfter(0, internal.push.dispatchPushForNotification, {
    notificationId,
  });

  return notificationId;
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

  const presence = await ctx.db
    .query("userPresence")
    .withIndex("by_user", (q: any) => q.eq("userId", post.authorId))
    .unique();
  const listeningNow =
    presence &&
    presence.isActive &&
    Date.now() - presence.lastSeenAt <= PRESENCE_INACTIVITY_MS &&
    presence.trackTitle
      ? {
          trackTitle: presence.trackTitle,
          startedAt: presence.startedAt || presence.lastSeenAt,
        }
      : null;

  return {
    ...post,
    repostsCount: post.repostsCount ?? 0,
    playCount: post.playCount ?? 0,
    author: {
      id: post.authorId,
      displayName: profile?.displayName || author?.name || "Anonymous",
      avatar: profile?.avatar,
      avatarUrl: profile?.avatar ? await ctx.storage.getUrl(profile.avatar) : null,
      listeningNow,
    },
    isLiked: !!userLike,
    isReposted: !!userRepost,
  };
}

function generateShareCode() {
  return `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function getLikeMessage(postType: "song" | "playlist" | "thought", actorName: string) {
  if (postType === "thought") {
    return `${actorName} liked your post`;
  }
  return `${actorName} liked your track`;
}

const TRENDING_THRESHOLDS = [5, 10, 25];

async function notifyTrendingInNetwork(
  ctx: any,
  args: {
    postId: Id<"posts">;
    authorId: Id<"users">;
    likesBefore: number;
    likesAfter: number;
  },
) {
  const reachedThreshold = TRENDING_THRESHOLDS.find(
    (threshold) => args.likesBefore < threshold && args.likesAfter >= threshold,
  );
  if (!reachedThreshold) return;

  const followers = await ctx.db
    .query("follows")
    .withIndex("by_following", (q: any) => q.eq("followingId", args.authorId))
    .collect();
  if (followers.length === 0) return;

  const authorName = await getDisplayName(ctx, args.authorId);

  await Promise.all(
    followers
      .map((follow: any) => follow.followerId as Id<"users">)
      .filter((followerId: Id<"users">) => followerId !== args.authorId)
      .map((followerId: Id<"users">) =>
        upsertNotification(ctx, {
          recipientId: followerId,
          actorId: args.authorId,
          profileId: args.authorId,
          type: "network_trending",
          postId: args.postId,
          message: `${authorName}'s post is trending in your network (${args.likesAfter} likes)`,
          groupKey: `network_trending:${args.postId}:${reachedThreshold}:${followerId}`,
        }),
      ),
  );
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
    const existingUserPosts = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", userId))
      .take(1);
    const isFirstPost = existingUserPosts.length === 0;

    const postId = await ctx.db.insert("posts", {
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
      playCount: 0,
    });

    if (isFirstPost) {
      const seedUserIds = await getSeedUserIds(ctx, userId);
      let likesAdded = 0;

      for (const seedId of seedUserIds) {
        const existingLike = await ctx.db
          .query("likes")
          .withIndex("by_user_and_post", (q) =>
            q.eq("userId", seedId).eq("postId", postId),
          )
          .unique();
        if (existingLike) continue;

        await ctx.db.insert("likes", { userId: seedId, postId });
        likesAdded += 1;

        const actorName = await getDisplayName(ctx, seedId);
        await upsertNotification(ctx, {
          recipientId: userId,
          actorId: seedId,
          type: "like",
          postId,
          message: getLikeMessage(args.type, actorName),
          groupKey: `like:${postId}:${seedId}`,
        });
      }

      if (likesAdded > 0) {
        await ctx.db.patch(postId, { likesCount: likesAdded });
      }
    }

    return postId;
  },
});

export const seedStarterFeed = mutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const existingPosts = await ctx.db.query("posts").take(1);
    const shouldForce = !!args.force;
    if (existingPosts.length > 0 && !shouldForce) {
      return { inserted: 0, skipped: true };
    }

    const templates: Array<{
      type: "song" | "playlist" | "thought";
      title: string;
      content: string;
      spotifyUrl?: string;
      youtubeUrl?: string;
      tags: string[];
    }> = [
      {
        type: "song",
        title: "Nights",
        content: "Late-night headphone classic. Who still has this on repeat?",
        spotifyUrl: "https://open.spotify.com/track/7eqoqGkKwgOaWNNHx90uEZ",
        tags: ["rnb", "late-night", "favorite"],
      },
      {
        type: "song",
        title: "Power",
        content: "Gym warmup anthem. Need more tracks with this energy.",
        youtubeUrl: "https://www.youtube.com/watch?v=L53gjP-TtGE",
        tags: ["hiphop", "workout", "energy"],
      },
      {
        type: "playlist",
        title: "Friday Drive Mix",
        content: "10 tracks for sunset drives and windows down.",
        spotifyUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6",
        tags: ["playlist", "weekend", "vibes"],
      },
      {
        type: "thought",
        title: "What makes a perfect intro?",
        content: "Do you prefer songs that start instantly or build slowly? Drop examples.",
        tags: ["discussion", "production"],
      },
      {
        type: "song",
        title: "Cuff It",
        content: "This one still wins every cookout playlist.",
        spotifyUrl: "https://open.spotify.com/track/2WnAKZefdRHxtBEkRjFOHC",
        tags: ["pop", "dance", "cookout"],
      },
    ];

    await Promise.all(
      templates.map((item) =>
        ctx.db.insert("posts", {
          authorId: userId,
          type: item.type,
          title: item.title,
          content: item.content,
          spotifyUrl: item.spotifyUrl,
          youtubeUrl: item.youtubeUrl,
          tags: item.tags,
          likesCount: 0,
          commentsCount: 0,
          repostsCount: 0,
          playCount: 0,
        }),
      ),
    );

    return { inserted: templates.length, skipped: false };
  },
});

function detectPlaySource(post: {
  spotifyUrl?: string;
  appleMusicUrl?: string;
  youtubeUrl?: string;
}, trackUrl?: string) {
  if (!trackUrl) return undefined;
  if (post.spotifyUrl && trackUrl === post.spotifyUrl) return "spotify" as const;
  if (post.appleMusicUrl && trackUrl === post.appleMusicUrl) return "apple_music" as const;
  if (post.youtubeUrl && trackUrl === post.youtubeUrl) return "youtube" as const;
  return "direct_audio" as const;
}

const PLAY_EVENT_COOLDOWN_MS = 30 * 1000;

export const recordPlay = mutation({
  args: {
    postId: v.id("posts"),
    trackUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const listenerId = await getAuthUserId(ctx);
    if (!listenerId) {
      return { recorded: false, reason: "anonymous" as const };
    }

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    const lastPlay = await ctx.db
      .query("playEvents")
      .withIndex("by_post_listener_time", (q) =>
        q.eq("postId", args.postId).eq("listenerId", listenerId),
      )
      .order("desc")
      .first();

    const now = Date.now();
    if (lastPlay && now - lastPlay.playedAt < PLAY_EVENT_COOLDOWN_MS) {
      return { recorded: false, reason: "cooldown" as const };
    }

    await ctx.db.insert("playEvents", {
      postId: args.postId,
      authorId: post.authorId,
      listenerId,
      playedAt: now,
      source: detectPlaySource(post, args.trackUrl),
      trackUrl: args.trackUrl,
    });

    const currentPlayCount = post.playCount ?? 0;
    await ctx.db.patch(args.postId, { playCount: currentPlayCount + 1 });

    return { recorded: true, playCount: currentPlayCount + 1 };
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
    const nextLikesCount = post.likesCount + 1;
    await ctx.db.patch(args.postId, { likesCount: nextLikesCount });

    if (post.authorId !== userId) {
      const actorName = await getDisplayName(ctx, userId);
      await upsertNotification(ctx, {
        recipientId: post.authorId,
        actorId: userId,
        type: "like",
        postId: args.postId,
        message: getLikeMessage(post.type, actorName),
        groupKey,
      });
    }

    await notifyTrendingInNetwork(ctx, {
      postId: args.postId,
      authorId: post.authorId,
      likesBefore: post.likesCount,
      likesAfter: nextLikesCount,
    });

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

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export const getCreatorAnalytics = query({
  args: { days: v.optional(v.number()), topLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const days = Math.max(1, Math.min(args.days ?? 30, 180));
    const topLimit = Math.max(1, Math.min(args.topLimit ?? 5, 20));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const sevenDayCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDayCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const [posts, playEvents, followers] = await Promise.all([
      ctx.db
        .query("posts")
        .withIndex("by_author", (q) => q.eq("authorId", userId))
        .collect(),
      ctx.db
        .query("playEvents")
        .withIndex("by_author_time", (q) => q.eq("authorId", userId))
        .collect(),
      ctx.db
        .query("follows")
        .withIndex("by_following", (q) => q.eq("followingId", userId))
        .collect(),
    ]);

    const musicPosts = posts.filter((post) => post.type === "song" || post.type === "playlist");
    const totalPlays = posts.reduce((sum, post) => sum + (post.playCount ?? 0), 0);
    const totalLikes = posts.reduce((sum, post) => sum + post.likesCount, 0);
    const totalComments = posts.reduce((sum, post) => sum + post.commentsCount, 0);
    const totalReposts = posts.reduce((sum, post) => sum + (post.repostsCount ?? 0), 0);

    const windowEvents = playEvents.filter((event) => event.playedAt >= cutoff);
    const events7d = playEvents.filter((event) => event.playedAt >= sevenDayCutoff);
    const uniqueListeners = new Set(windowEvents.map((event) => String(event.listenerId)));
    const uniqueListeners7d = new Set(events7d.map((event) => String(event.listenerId)));
    const recentFollowers30d = followers.filter(
      (follow) => follow._creationTime >= thirtyDayCutoff,
    ).length;

    const dailyMap = new Map<string, { plays: number; listeners: Set<string> }>();
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      dailyMap.set(formatDay(day), { plays: 0, listeners: new Set<string>() });
    }

    for (const event of windowEvents) {
      const key = formatDay(new Date(event.playedAt));
      const bucket = dailyMap.get(key);
      if (!bucket) continue;
      bucket.plays += 1;
      bucket.listeners.add(String(event.listenerId));
    }

    const daily = Array.from(dailyMap.entries()).map(([date, value]) => ({
      date,
      plays: value.plays,
      uniqueListeners: value.listeners.size,
    }));

    const topTracks = musicPosts
      .map((post) => {
        const playCount = post.playCount ?? 0;
        const engagementScore = post.likesCount + post.commentsCount + (post.repostsCount ?? 0);
        return {
          postId: post._id,
          title: post.title,
          type: post.type,
          playCount,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          repostsCount: post.repostsCount ?? 0,
          engagementScore,
          createdAt: post._creationTime,
        };
      })
      .sort((a, b) => {
        if (b.playCount !== a.playCount) return b.playCount - a.playCount;
        if (b.engagementScore !== a.engagementScore) return b.engagementScore - a.engagementScore;
        return b.createdAt - a.createdAt;
      })
      .slice(0, topLimit);

    return {
      overview: {
        totalPosts: posts.length,
        totalTrackPosts: musicPosts.length,
        totalPlays,
        totalLikes,
        totalComments,
        totalReposts,
        totalFollowers: followers.length,
        avgPlaysPerTrack:
          musicPosts.length > 0 ? Number((totalPlays / musicPosts.length).toFixed(1)) : 0,
        engagementRate:
          posts.length > 0
            ? Number(
                (
                  ((totalLikes + totalComments + totalReposts) /
                    Math.max(1, posts.length)) *
                  100
                ).toFixed(1),
              )
            : 0,
      },
      listenerStats: {
        rangeDays: days,
        playsInRange: windowEvents.length,
        uniqueListenersInRange: uniqueListeners.size,
        playsInLast7Days: events7d.length,
        uniqueListenersInLast7Days: uniqueListeners7d.size,
        daily,
      },
      topTracks,
      profileAnalytics: {
        recentFollowers30d,
        activeDaysInRange: daily.filter((entry) => entry.plays > 0).length,
        avgDailyPlaysInRange:
          daily.length > 0
            ? Number((daily.reduce((sum, day) => sum + day.plays, 0) / daily.length).toFixed(2))
            : 0,
      },
    };
  },
});

export const deletePost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");
    if (post.authorId !== userId) throw new Error("You can only delete your own posts");

    const [likes, reposts, comments, playEvents] = await Promise.all([
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
      ctx.db
        .query("playEvents")
        .withIndex("by_post", (q) => q.eq("postId", args.postId))
        .collect(),
    ]);

    await Promise.all([
      ...likes.map((like) => ctx.db.delete(like._id)),
      ...reposts.map((repost) => ctx.db.delete(repost._id)),
      ...comments.map((comment) => ctx.db.delete(comment._id)),
      ...playEvents.map((event) => ctx.db.delete(event._id)),
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

export const createShareReference = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    const authUserId = await getAuthUserId(ctx);
    const creatorId = (authUserId as Id<"users"> | null) || post.authorId;

    const existing = await ctx.db
      .query("shareReferences")
      .withIndex("by_post_creator", (q) =>
        q.eq("postId", args.postId).eq("creatorId", creatorId),
      )
      .unique();
    if (existing) {
      return { code: existing.code };
    }

    const code = generateShareCode();
    await ctx.db.insert("shareReferences", {
      code,
      postId: args.postId,
      creatorId,
      createdAt: Date.now(),
      clicks: 0,
    });

    if (creatorId !== post.authorId) {
      const actorName = await getDisplayName(ctx, creatorId);
      await upsertNotification(ctx, {
        recipientId: post.authorId,
        actorId: creatorId,
        type: "share",
        postId: args.postId,
        message: `${actorName} shared your track`,
        groupKey: `share:${args.postId}:${creatorId}`,
      });
    }

    return { code };
  },
});

export const resolveShareReference = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const ref = await ctx.db
      .query("shareReferences")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim()))
      .unique();
    if (!ref) return null;
    const post = await ctx.db.get(ref.postId);
    if (!post) return null;
    return { postId: ref.postId };
  },
});
