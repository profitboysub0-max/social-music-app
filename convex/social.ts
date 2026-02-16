import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const followUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) throw new Error("Not authenticated");
    if (currentUserId === args.userId) throw new Error("Cannot follow yourself");
    
    const existingFollow = await ctx.db
      .query("follows")
      .withIndex("by_connection", (q) => q.eq("followerId", currentUserId).eq("followingId", args.userId))
      .unique();
    
    if (existingFollow) {
      throw new Error("Already following this user");
    }
    
    await ctx.db.insert("follows", {
      followerId: currentUserId,
      followingId: args.userId,
    });
  },
});

export const unfollowUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) throw new Error("Not authenticated");
    
    const existingFollow = await ctx.db
      .query("follows")
      .withIndex("by_connection", (q) => q.eq("followerId", currentUserId).eq("followingId", args.userId))
      .unique();
    
    if (!existingFollow) {
      throw new Error("Not following this user");
    }
    
    await ctx.db.delete(existingFollow._id);
  },
});

export const isFollowing = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await getAuthUserId(ctx);
    if (!currentUserId) return false;
    
    const follow = await ctx.db
      .query("follows")
      .withIndex("by_connection", (q) => q.eq("followerId", currentUserId).eq("followingId", args.userId))
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
      })
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
      })
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
