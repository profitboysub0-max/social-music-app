import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

function sortUserPair(userA: Id<"users">, userB: Id<"users">) {
  return String(userA) < String(userB)
    ? { participantA: userA, participantB: userB }
    : { participantA: userB, participantB: userA };
}

async function requireNonGuestUserId(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (user?.isAnonymous) {
    throw new Error("Create an account to send messages.");
  }
  return userId as Id<"users">;
}

async function getProfileSummary(ctx: any, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();

  return {
    id: userId,
    displayName: profile?.displayName || user?.name || user?.email || "Anonymous",
    avatar: profile?.avatar,
    avatarUrl: profile?.avatar ? await ctx.storage.getUrl(profile.avatar) : null,
  };
}

async function getOrCreateConversation(
  ctx: any,
  currentUserId: Id<"users">,
  otherUserId: Id<"users">,
) {
  const pair = sortUserPair(currentUserId, otherUserId);

  const existingConversation = await ctx.db
    .query("conversations")
    .withIndex("by_pair", (q: any) =>
      q.eq("participantA", pair.participantA).eq("participantB", pair.participantB),
    )
    .unique();

  if (existingConversation) {
    return existingConversation;
  }

  const conversationId = await ctx.db.insert("conversations", {
    participantA: pair.participantA,
    participantB: pair.participantB,
    lastMessageAt: Date.now(),
    lastMessagePreview: undefined,
  });

  return await ctx.db.get(conversationId);
}

function ensureParticipant(
  conversation: { participantA: Id<"users">; participantB: Id<"users"> } | null,
  userId: Id<"users">,
) {
  if (!conversation) return false;
  return conversation.participantA === userId || conversation.participantB === userId;
}

export const getConversations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const [asParticipantA, asParticipantB] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_participant_a", (q) => q.eq("participantA", userId))
        .collect(),
      ctx.db
        .query("conversations")
        .withIndex("by_participant_b", (q) => q.eq("participantB", userId))
        .collect(),
    ]);

    const merged = [...asParticipantA, ...asParticipantB];
    const uniqueById = new Map<string, (typeof merged)[number]>();
    for (const conversation of merged) {
      uniqueById.set(String(conversation._id), conversation);
    }

    const conversations = Array.from(uniqueById.values()).sort(
      (a, b) => b.lastMessageAt - a.lastMessageAt,
    );

    return await Promise.all(
      conversations.map(async (conversation) => {
        const otherUserId =
          conversation.participantA === userId ? conversation.participantB : conversation.participantA;
        const otherUser = await getProfileSummary(ctx, otherUserId);

        const unreadMessages = await ctx.db
          .query("messages")
          .withIndex("by_conversation_recipient_read", (q) =>
            q
              .eq("conversationId", conversation._id)
              .eq("recipientId", userId)
              .eq("readAt", undefined),
          )
          .collect();

        return {
          _id: conversation._id,
          otherUser,
          lastMessagePreview: conversation.lastMessagePreview || "",
          lastMessageAt: conversation.lastMessageAt,
          unreadCount: unreadMessages.length,
        };
      }),
    );
  },
});

export const getConversationMessages = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const conversation = await ctx.db.get(args.conversationId);
    if (!ensureParticipant(conversation, userId)) {
      throw new Error("Conversation not found");
    }

    const limit = args.limit || 100;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(limit);

    const ascendingMessages = [...messages].reverse();

    return await Promise.all(
      ascendingMessages.map(async (message) => {
        const sender = await getProfileSummary(ctx, message.senderId);
        return {
          ...message,
          sender,
          isMine: message.senderId === userId,
        };
      }),
    );
  },
});

export const sendMessage = mutation({
  args: {
    recipientId: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const senderId = await requireNonGuestUserId(ctx);
    if (senderId === args.recipientId) throw new Error("Cannot message yourself");

    const trimmed = args.content.trim();
    if (!trimmed) throw new Error("Message cannot be empty");

    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient) throw new Error("Recipient not found");

    const conversation = await getOrCreateConversation(ctx, senderId, args.recipientId);
    if (!conversation) throw new Error("Failed to load conversation");

    const messageId = await ctx.db.insert("messages", {
      conversationId: conversation._id,
      senderId,
      recipientId: args.recipientId,
      content: trimmed,
      readAt: undefined,
    });

    await ctx.db.patch(conversation._id, {
      lastMessagePreview: trimmed.slice(0, 140),
      lastMessageAt: Date.now(),
    });

    return { conversationId: conversation._id, messageId };
  },
});

export const markConversationAsRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const conversation = await ctx.db.get(args.conversationId);
    if (!ensureParticipant(conversation, userId)) {
      throw new Error("Conversation not found");
    }

    const unreadMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_recipient_read", (q) =>
        q
          .eq("conversationId", args.conversationId)
          .eq("recipientId", userId)
          .eq("readAt", undefined),
      )
      .collect();

    const now = Date.now();
    await Promise.all(
      unreadMessages.map((message) =>
        ctx.db.patch(message._id, {
          readAt: now,
        }),
      ),
    );
  },
});

export const getUnreadMessageCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;

    const unreadMessages = await ctx.db
      .query("messages")
      .withIndex("by_recipient_read", (q) => q.eq("recipientId", userId).eq("readAt", undefined))
      .collect();

    return unreadMessages.length;
  },
});

export const searchUsersForMessages = query({
  args: { searchTerm: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const term = (args.searchTerm || "").trim().toLowerCase();
    const profiles = await ctx.db.query("profiles").collect();

    const matches = profiles
      .filter((profile) => profile.userId !== userId)
      .filter((profile) => {
        if (!term) return true;
        return profile.displayName.toLowerCase().includes(term);
      })
      .slice(0, 20);

    return await Promise.all(
      matches.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        return {
          userId: profile.userId,
          displayName: profile.displayName || user?.name || "Anonymous",
          avatar: profile.avatar,
          avatarUrl: profile.avatar ? await ctx.storage.getUrl(profile.avatar) : null,
        };
      }),
    );
  },
});
