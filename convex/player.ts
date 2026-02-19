import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

    const payload = {
      userId,
      trackUrl: args.trackUrl,
      trackTitle: args.trackTitle,
      trackThumbnail: args.trackThumbnail,
      currentTime: args.currentTime,
      duration: args.duration,
      isPlaying: args.isPlaying,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("playbackStates", payload);
  },
});
