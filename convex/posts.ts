import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    
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
    });
  },
});

export const getFeedPosts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const limit = args.limit || 20;
    
    // Get posts from followed users + own posts
    let postIds: string[] = [];
    
    if (userId) {
      const follows = await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", userId))
        .collect();
      
      const followingIds = follows.map(f => f.followingId);
      followingIds.push(userId); // Include own posts
      
      const posts = await ctx.db
        .query("posts")
        .order("desc")
        .take(limit * 2); // Get more to filter
      
      const filteredPosts = posts
        .filter(post => followingIds.includes(post.authorId))
        .slice(0, limit);
      
      return await Promise.all(
        filteredPosts.map(async (post) => {
          const author = await ctx.db.get(post.authorId);
          const profile = await ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", post.authorId))
            .unique();
          
          const userLike = userId ? await ctx.db
            .query("likes")
            .withIndex("by_user_and_post", (q) => q.eq("userId", userId).eq("postId", post._id))
            .unique() : null;
          
          return {
            ...post,
            author: {
              id: post.authorId,
              displayName: profile?.displayName || author?.name || "Anonymous",
              avatar: profile?.avatar,
            },
            isLiked: !!userLike,
          };
        })
      );
    }
    
    // Public feed for non-authenticated users
    const posts = await ctx.db
      .query("posts")
      .order("desc")
      .take(limit);
    
    return await Promise.all(
      posts.map(async (post) => {
        const author = await ctx.db.get(post.authorId);
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", post.authorId))
          .unique();
        
        return {
          ...post,
          author: {
            id: post.authorId,
            displayName: profile?.displayName || author?.name || "Anonymous",
            avatar: profile?.avatar,
          },
          isLiked: false,
        };
      })
    );
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
    
    const author = await ctx.db.get(args.userId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    
    return await Promise.all(
      posts.map(async (post) => {
        const userLike = currentUserId ? await ctx.db
          .query("likes")
          .withIndex("by_user_and_post", (q) => q.eq("userId", currentUserId).eq("postId", post._id))
          .unique() : null;
        
        return {
          ...post,
          author: {
            id: args.userId,
            displayName: profile?.displayName || author?.name || "Anonymous",
            avatar: profile?.avatar,
          },
          isLiked: !!userLike,
        };
      })
    );
  },
});

export const toggleLike = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    
    const existingLike = await ctx.db
      .query("likes")
      .withIndex("by_user_and_post", (q) => q.eq("userId", userId).eq("postId", args.postId))
      .unique();
    
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");
    
    if (existingLike) {
      // Unlike
      await ctx.db.delete(existingLike._id);
      await ctx.db.patch(args.postId, {
        likesCount: Math.max(0, post.likesCount - 1),
      });
      return false;
    } else {
      // Like
      await ctx.db.insert("likes", {
        userId,
        postId: args.postId,
      });
      await ctx.db.patch(args.postId, {
        likesCount: post.likesCount + 1,
      });
      return true;
    }
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
    
    return await Promise.all(
      results.map(async (post) => {
        const author = await ctx.db.get(post.authorId);
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", post.authorId))
          .unique();
        
        const userLike = userId ? await ctx.db
          .query("likes")
          .withIndex("by_user_and_post", (q) => q.eq("userId", userId).eq("postId", post._id))
          .unique() : null;
        
        return {
          ...post,
          author: {
            id: post.authorId,
            displayName: profile?.displayName || author?.name || "Anonymous",
            avatar: profile?.avatar,
          },
          isLiked: !!userLike,
        };
      })
    );
  },
});
