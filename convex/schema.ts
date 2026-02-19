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
    repostsCount: v.optional(v.number()),
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

  // Reposts of posts
  reposts: defineTable({
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
    mentionedUserIds: v.optional(v.array(v.id("users"))),
  })
    .index("by_post", ["postId"])
    .index("by_author", ["authorId"]),

  notifications: defineTable({
    recipientId: v.id("users"),
    actorId: v.optional(v.id("users")),
    type: v.union(
      v.literal("like"),
      v.literal("comment"),
      v.literal("follow"),
      v.literal("mention"),
      v.literal("repost"),
      v.literal("system_update"),
    ),
    postId: v.optional(v.id("posts")),
    commentId: v.optional(v.id("comments")),
    profileId: v.optional(v.id("users")),
    message: v.string(),
    groupKey: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_recipient_created", ["recipientId", "createdAt"])
    .index("by_recipient_group", ["recipientId", "groupKey"])
    .index("by_recipient_read", ["recipientId", "readAt"]),

  conversations: defineTable({
    participantA: v.id("users"),
    participantB: v.id("users"),
    lastMessagePreview: v.optional(v.string()),
    lastMessageAt: v.number(),
  })
    .index("by_pair", ["participantA", "participantB"])
    .index("by_participant_a", ["participantA", "lastMessageAt"])
    .index("by_participant_b", ["participantB", "lastMessageAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    recipientId: v.id("users"),
    content: v.string(),
    readAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_recipient_read", ["recipientId", "readAt"])
    .index("by_conversation_recipient_read", ["conversationId", "recipientId", "readAt"]),

  playbackStates: defineTable({
    userId: v.id("users"),
    trackUrl: v.optional(v.string()),
    trackTitle: v.optional(v.string()),
    trackThumbnail: v.optional(v.string()),
    currentTime: v.number(),
    duration: v.number(),
    isPlaying: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
};

export default defineSchema({
  ...authTables,
  ...applicationTables,
});
