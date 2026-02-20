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

export const followUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await requireNonGuestUserId(ctx);
    if (currentUserId === args.userId) throw new Error("Cannot follow yourself");

    const existingFollow = await ctx.db
      .query("follows")
      .withIndex("by_connection", (q) =>
        q.eq("followerId", currentUserId).eq("followingId", args.userId),
      )
      .unique();

    if (existingFollow) {
      throw new Error("Already following this user");
    }

    await ctx.db.insert("follows", {
      followerId: currentUserId,
      followingId: args.userId,
    });

    const actorName = await getDisplayName(ctx, currentUserId);
    await upsertNotification(ctx, {
      recipientId: args.userId,
      actorId: currentUserId,
      type: "follow",
      profileId: currentUserId,
      message: `${actorName} started following you`,
      groupKey: `follow:${currentUserId}:${args.userId}`,
    });
  },
});

export const unfollowUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await requireNonGuestUserId(ctx);

    const existingFollow = await ctx.db
      .query("follows")
      .withIndex("by_connection", (q) =>
        q.eq("followerId", currentUserId).eq("followingId", args.userId),
      )
      .unique();

    if (!existingFollow) {
      throw new Error("Not following this user");
    }

    await ctx.db.delete(existingFollow._id);
    await deleteNotificationByGroup(ctx, args.userId, `follow:${currentUserId}:${args.userId}`);
  },
});

export const isFollowing = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) return false;

    const follow = await ctx.db
      .query("follows")
      .withIndex("by_connection", (q) =>
        q.eq("followerId", currentUserId).eq("followingId", args.userId),
      )
      .unique();

    return !!follow;
  },
});

export const getFollowers = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const follows = await ctx.db
      .query("follows")
      .withIndex("by_following", (q) => q.eq("followingId", args.userId))
      .collect();

    return await Promise.all(
      follows.map(async (follow) => {
        const user = await ctx.db.get(follow.followerId);
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", follow.followerId))
          .unique();

        return {
          userId: follow.followerId,
          displayName: profile?.displayName || user?.name || "Anonymous",
          avatar: profile?.avatar,
        };
      }),
    );
  },
});

export const getFollowing = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const follows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", args.userId))
      .collect();

    return await Promise.all(
      follows.map(async (follow) => {
        const user = await ctx.db.get(follow.followingId);
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", follow.followingId))
          .unique();

        return {
          userId: follow.followingId,
          displayName: profile?.displayName || user?.name || "Anonymous",
          avatar: profile?.avatar,
        };
      }),
    );
  },
});

export const getRecentFollowers = query({
  args: { withinDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) return [];

    const withinDays = args.withinDays ?? 30;
    const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;

    const follows = await ctx.db
      .query("follows")
      .withIndex("by_following", (q) => q.eq("followingId", currentUserId))
      .collect();

    const recent = follows
      .filter((follow) => follow._creationTime >= cutoff)
      .sort((a, b) => b._creationTime - a._creationTime);

    return await Promise.all(
      recent.map(async (follow) => {
        const user = await ctx.db.get(follow.followerId);
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", follow.followerId))
          .unique();

        return {
          userId: follow.followerId,
          displayName: profile?.displayName || user?.name || "Anonymous",
          avatar: profile?.avatar,
          avatarUrl: profile?.avatar ? await ctx.storage.getUrl(profile.avatar) : null,
          followedAt: follow._creationTime,
        };
      }),
    );
  },
});

export const getFollowStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const followers = await ctx.db
      .query("follows")
      .withIndex("by_following", (q) => q.eq("followingId", args.userId))
      .collect();

    const following = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", args.userId))
      .collect();

    return {
      followersCount: followers.length,
      followingCount: following.length,
    };
  },
});

export const getNotifications = query({
  args: { limit: v.optional(v.number()), withinDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const limit = args.limit || 20;
    const withinDays = args.withinDays ?? 30;
    const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;

    let notifications = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", userId))
      .order("desc")
      .take(limit);
    notifications = notifications.filter((notification) => notification.createdAt >= cutoff);

    return await Promise.all(
      notifications.map(async (notification) => {
        let actor:
          | {
              id: Id<"users">;
              displayName: string;
              avatar?: Id<"_storage">;
              avatarUrl?: string | null;
            }
          | null = null;

        if (notification.actorId) {
          const actorUser = await ctx.db.get(notification.actorId);
          const actorProfile = await ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", notification.actorId!))
            .unique();
          actor = {
            id: notification.actorId,
            displayName: actorProfile?.displayName || actorUser?.name || "Anonymous",
            avatar: actorProfile?.avatar,
            avatarUrl: actorProfile?.avatar
              ? await ctx.storage.getUrl(actorProfile.avatar)
              : null,
          };
        }

        const postExists = notification.postId ? !!(await ctx.db.get(notification.postId)) : false;
        const profileExists = notification.profileId
          ? !!(await ctx.db.get(notification.profileId))
          : false;
        const commentExists = notification.commentId
          ? !!(await ctx.db.get(notification.commentId))
          : false;

        return {
          ...notification,
          actor,
          isRead: !!notification.readAt,
          targetExists:
            notification.type === "system_update" ||
            postExists ||
            profileExists ||
            commentExists,
        };
      }),
    );
  },
});

export const getUnreadNotificationCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const all = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", userId))
      .collect();
    return all.filter((notification) => !notification.readAt).length;
  },
});

export const markNotificationAsRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.recipientId !== userId) {
      throw new Error("Notification not found");
    }

    if (!notification.readAt) {
      await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    }
  },
});

export const markAllNotificationsAsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created", (q) => q.eq("recipientId", userId))
      .collect();

    const now = Date.now();
    await Promise.all(
      notifications
        .filter((notification) => !notification.readAt)
        .map((notification) => ctx.db.patch(notification._id, { readAt: now })),
    );
  },
});

export const createSystemUpdateNotification = mutation({
  args: {
    message: v.string(),
    recipientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const recipientId = args.recipientId || userId;
    await upsertNotification(ctx, {
      recipientId,
      type: "system_update",
      message: args.message,
      groupKey: `system_update:${recipientId}:${args.message}`,
    });
  },
});
