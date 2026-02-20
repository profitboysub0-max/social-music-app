import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

type NotificationDoc = {
  _id: Id<"notifications">;
  recipientId: Id<"users">;
  actorId?: Id<"users">;
  type:
    | "like"
    | "comment"
    | "follow"
    | "mention"
    | "repost"
    | "share"
    | "friend_listening"
    | "network_trending"
    | "system_update";
  postId?: Id<"posts">;
  commentId?: Id<"comments">;
  profileId?: Id<"users">;
  message: string;
  createdAt: number;
  groupKey?: string;
};

function isWebPushConfigured() {
  return !!process.env.WEB_PUSH_PUBLIC_KEY && !!process.env.WEB_PUSH_PRIVATE_KEY;
}

async function requireNonGuestUserId(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (user?.isAnonymous) {
    throw new Error("Create an account to enable push notifications.");
  }
  return userId as Id<"users">;
}

export const upsertPushSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deletePushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (!existing || existing.userId !== userId) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const getPushStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        supported: isWebPushConfigured(),
        hasSubscription: false,
      };
    }

    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return {
      supported: isWebPushConfigured(),
      hasSubscription: subscriptions.length > 0,
    };
  },
});

export const getWebPushPublicKey = query({
  args: {},
  handler: async () => {
    return process.env.WEB_PUSH_PUBLIC_KEY || null;
  },
});

export const getPushDispatchData = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = (await ctx.db.get(args.notificationId)) as NotificationDoc | null;
    if (!notification) return null;

    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", notification.recipientId))
      .collect();

    if (subscriptions.length === 0) return null;

    return {
      notification,
      subscriptions: subscriptions.map((subscription) => ({
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      })),
    };
  },
});

export const removePushSubscriptionByEndpoint = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
