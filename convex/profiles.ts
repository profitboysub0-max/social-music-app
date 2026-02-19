import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (!profile) {
      const user = await ctx.db.get(args.userId);
      return user
        ? {
            userId: args.userId,
            displayName: user.name || user.email || "Anonymous",
            bio: null,
            avatar: null,
            isPublic: true,
          }
        : null;
    }

    return profile;
  },
});

export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) {
      const user = await ctx.db.get(userId);
      return user
        ? {
            userId,
            displayName: user.name || user.email || "Anonymous",
            bio: null,
            avatar: null,
            isPublic: true,
          }
        : null;
    }

    return profile;
  },
});

export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    bio: v.optional(v.string()),
    isPublic: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, {
        displayName: args.displayName,
        bio: args.bio,
        isPublic: args.isPublic,
      });
    } else {
      await ctx.db.insert("profiles", {
        userId,
        displayName: args.displayName,
        bio: args.bio,
        isPublic: args.isPublic,
      });
    }
  },
});

export const updateAvatar = mutation({
  args: {
    avatarId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existingProfile) {
      await ctx.db.patch(existingProfile._id, {
        avatar: args.avatarId,
      });
    } else {
      const user = await ctx.db.get(userId);

      await ctx.db.insert("profiles", {
        userId,
        displayName: user?.name || user?.email || "Anonymous",
        bio: undefined,
        avatar: args.avatarId,
        isPublic: true,
      });
    }
  },
});

export const searchUsers = query({
  args: {
    searchTerm: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    const term = args.searchTerm.trim().toLowerCase();
    if (!term) return [];

    const profiles = await ctx.db.query("profiles").collect();

    const results = await Promise.all(
      profiles
        .filter((profile) => profile.userId !== currentUserId)
        .filter((profile) => {
          const displayName = profile.displayName.toLowerCase();
          const bio = (profile.bio || "").toLowerCase();
          return displayName.includes(term) || bio.includes(term);
        })
        .slice(0, 20)
        .map(async (profile) => {
          const user = await ctx.db.get(profile.userId);
          return {
            userId: profile.userId,
            displayName: profile.displayName || user?.name || user?.email || "Anonymous",
            bio: profile.bio,
            isPublic: profile.isPublic,
          };
        }),
    );

    return results;
  },
});

