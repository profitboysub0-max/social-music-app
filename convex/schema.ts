import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const applicationTables = {
  // User profiles extending the auth users table
  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    avatar: v.optional(v.id("_storage")),
    isPublic: v.boolean(),
  }).index("by_user", ["userId"]),

  // Music posts - users can share songs, playlists, or music thoughts
  posts: defineTable({
    authorId: v.id("users"),
    type: v.union(v.literal("song"), v.literal("playlist"), v.literal("thought")),
    title: v.string(),
    content: v.string(), // Song/playlist info or text content
    spotifyUrl: v.optional(v.string()),
    appleMusicUrl: v.optional(v.string()),
    youtubeUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    likesCount: v.number(),
    commentsCount: v.number(),
  })
    .index("by_author", ["authorId"])
    .searchIndex("search_posts", {
      searchField: "content",
      filterFields: ["type", "authorId"],
    }),

  // Social connections - following system
  follows: defineTable({
    followerId: v.id("users"),
    followingId: v.id("users"),
  })
    .index("by_follower", ["followerId"])
    .index("by_following", ["followingId"])
    .index("by_connection", ["followerId", "followingId"]),

  // Likes on posts
  likes: defineTable({
    userId: v.id("users"),
    postId: v.id("posts"),
  })
    .index("by_user", ["userId"])
    .index("by_post", ["postId"])
    .index("by_user_and_post", ["userId", "postId"]),

  // Comments on posts
  comments: defineTable({
    authorId: v.id("users"),
    postId: v.id("posts"),
    content: v.string(),
  })
    .index("by_post", ["postId"])
    .index("by_author", ["authorId"]),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
