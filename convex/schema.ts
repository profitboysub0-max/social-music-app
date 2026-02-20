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
    playCount: v.optional(v.number()),
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
      v.literal("share"),
      v.literal("friend_listening"),
      v.literal("network_trending"),
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

  playEvents: defineTable({
    postId: v.id("posts"),
    authorId: v.id("users"),
    listenerId: v.id("users"),
    playedAt: v.number(),
    source: v.optional(v.union(v.literal("spotify"), v.literal("apple_music"), v.literal("youtube"), v.literal("direct_audio"))),
    trackUrl: v.optional(v.string()),
  })
    .index("by_post", ["postId", "playedAt"])
    .index("by_author_time", ["authorId", "playedAt"])
    .index("by_post_listener_time", ["postId", "listenerId", "playedAt"])
    .index("by_listener_time", ["listenerId", "playedAt"]),

  playlists: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    isPublic: v.boolean(),
    isCollaborative: v.boolean(),
    shareCode: v.string(),
    tracksCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_share_code", ["shareCode"])
    .index("by_public_updated", ["isPublic", "updatedAt"]),

  playlistCollaborators: defineTable({
    playlistId: v.id("playlists"),
    userId: v.id("users"),
    role: v.union(v.literal("editor")),
    createdAt: v.number(),
  })
    .index("by_playlist_user", ["playlistId", "userId"])
    .index("by_user", ["userId"])
    .index("by_playlist", ["playlistId"]),

  playlistTracks: defineTable({
    playlistId: v.id("playlists"),
    addedBy: v.id("users"),
    sourcePostId: v.optional(v.id("posts")),
    title: v.string(),
    url: v.optional(v.string()),
    platform: v.optional(
      v.union(v.literal("spotify"), v.literal("apple_music"), v.literal("youtube"), v.literal("direct")),
    ),
    notes: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number(),
  })
    .index("by_playlist_order", ["playlistId", "order"])
    .index("by_playlist_created", ["playlistId", "createdAt"])
    .index("by_playlist_source_post", ["playlistId", "sourcePostId"]),

  savedSongs: defineTable({
    userId: v.id("users"),
    sourcePostId: v.optional(v.id("posts")),
    title: v.string(),
    artistOrContext: v.optional(v.string()),
    url: v.optional(v.string()),
    platform: v.optional(
      v.union(v.literal("spotify"), v.literal("apple_music"), v.literal("youtube"), v.literal("direct")),
    ),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_source_post", ["userId", "sourcePostId"]),

  userPresence: defineTable({
    userId: v.id("users"),
    currentTrackId: v.optional(v.string()),
    trackTitle: v.optional(v.string()),
    trackUrl: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    lastSeenAt: v.number(),
    isActive: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_active_seen", ["isActive", "lastSeenAt"]),

  growthOnboarding: defineTable({
    userId: v.id("users"),
    seedFollowedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  shareReferences: defineTable({
    code: v.string(),
    postId: v.id("posts"),
    creatorId: v.id("users"),
    createdAt: v.number(),
    clicks: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_post_creator", ["postId", "creatorId"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

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
