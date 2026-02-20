import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
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

export const getPlaybackState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const state = await ctx.db
      .query("playbackStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    return state || null;
  },
});

function toPresencePayload(
  trackUrl: string | undefined,
  trackTitle: string | undefined,
  now: number,
  isPlaying: boolean,
  existingStartedAt?: number,
  existingTrackId?: string,
) {
  const nextTrackId = trackUrl?.trim() || undefined;
  const nextIsActive = !!nextTrackId && isPlaying;
  const shouldResetStart =
    nextIsActive && (!existingStartedAt || existingTrackId !== nextTrackId);

  return {
    currentTrackId: nextIsActive ? nextTrackId : undefined,
    trackTitle: nextIsActive ? trackTitle?.trim() || undefined : undefined,
    trackUrl: nextIsActive ? nextTrackId : undefined,
    startedAt: nextIsActive ? (shouldResetStart ? now : existingStartedAt || now) : undefined,
    lastSeenAt: now,
    isActive: nextIsActive,
  };
}

export const getUserPresence = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const presence = await ctx.db
      .query("userPresence")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!presence) return null;

    const stillActive =
      presence.isActive && Date.now() - presence.lastSeenAt <= PRESENCE_INACTIVITY_MS;

    return {
      ...presence,
      isActive: stillActive,
      isStale: presence.isActive && !stillActive,
    };
  },
});

export const upsertPlaybackState = mutation({
  args: {
    trackUrl: v.optional(v.string()),
    trackTitle: v.optional(v.string()),
    trackThumbnail: v.optional(v.string()),
    currentTime: v.number(),
    duration: v.number(),
    isPlaying: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("playbackStates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const now = Date.now();
    const payload = {
      userId,
      trackUrl: args.trackUrl,
      trackTitle: args.trackTitle,
      trackThumbnail: args.trackThumbnail,
      currentTime: args.currentTime,
      duration: args.duration,
      isPlaying: args.isPlaying,
      updatedAt: now,
    };

    const nextTrackUrl = args.trackUrl?.trim();
    const shouldNotifyFollowers =
      !!nextTrackUrl &&
      args.isPlaying &&
      (!existing || existing.trackUrl !== nextTrackUrl || existing.isPlaying === false);

    let stateId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      stateId = await ctx.db.insert("playbackStates", payload);
    }

    const existingPresence = await ctx.db
      .query("userPresence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const presencePayload = toPresencePayload(
      nextTrackUrl,
      args.trackTitle,
      now,
      args.isPlaying,
      existingPresence?.startedAt,
      existingPresence?.currentTrackId,
    );
    if (existingPresence) {
      await ctx.db.patch(existingPresence._id, presencePayload);
    } else {
      await ctx.db.insert("userPresence", {
        userId,
        ...presencePayload,
      });
    }

    if (shouldNotifyFollowers) {
      const followers = await ctx.db
        .query("follows")
        .withIndex("by_following", (q) => q.eq("followingId", userId))
        .collect();
      if (followers.length > 0) {
        const actorName = await getDisplayName(ctx, userId as Id<"users">);
        const trackLabel = args.trackTitle?.trim() || "a new track";
        await Promise.all(
          followers
            .map((follow) => follow.followerId as Id<"users">)
            .filter((followerId) => followerId !== userId)
            .map((followerId) =>
              upsertNotification(ctx, {
                recipientId: followerId,
                actorId: userId as Id<"users">,
                profileId: userId as Id<"users">,
                type: "friend_listening",
                message: `${actorName} started listening to ${trackLabel}`,
                groupKey: `friend_listening:${String(userId)}:${nextTrackUrl}`,
              }),
            ),
        );
      }
    }

    return stateId!;
  },
});
