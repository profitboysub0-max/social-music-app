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
      return user ? {
        userId: args.userId,
        displayName: user.name || user.email || "Anonymous",
        bio: null,
        avatar: null,
        isPublic: true,
      } : null;
    }
    
    return profile;
  },
});

export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    
    if (!profile) {
      const user = await ctx.db.get(userId);
      return user ? {
        userId: userId,
        displayName: user.name || user.email || "Anonymous",
        bio: null,
        avatar: null,
        isPublic: true,
      } : null;
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

export const searchUsers = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    const profiles = await ctx.db.query("profiles").collect();
    
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    
    return users
      .filter(user => {
        const profile = profileMap.get(user._id);
        const displayName = profile?.displayName || user.name || user.email || "";
        return displayName.toLowerCase().includes(args.searchTerm.toLowerCase()) &&
               (profile?.isPublic !== false);
      })
      .slice(0, 10)
      .map(user => {
        const profile = profileMap.get(user._id);
        return {
          userId: user._id,
          displayName: profile?.displayName || user.name || user.email || "Anonymous",
          bio: profile?.bio,
          avatar: profile?.avatar,
        };
      });
  },
});
