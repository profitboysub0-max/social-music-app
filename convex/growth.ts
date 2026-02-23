import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

async function getDisplayName(ctx: any, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  return profile?.displayName || user?.name || user?.email || "Anonymous";
}

function getSeedEmails() {
  const raw = (process.env.SEED_ACCOUNT_EMAILS || "").trim();
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function getSeedUserIds(ctx: any, excludeUserId: Id<"users">) {
  const seedEmails = getSeedEmails();
  if (seedEmails.length === 0) return [] as Id<"users">[];

  const users = await ctx.db.query("users").collect();
  const seedSet = new Set(seedEmails);
  return users
    .filter((user: any) => !user?.isAnonymous)
    .filter((user: any) => user?._id !== excludeUserId)
    .filter((user: any) => {
      const email = String(user?.email || "").toLowerCase();
      return email && seedSet.has(email);
    })
    .map((user: any) => user._id as Id<"users">);
}

function getAuthorizedInvestorEmails() {
  const defaults = ["profitboysub0@gmail.com"];
  const raw = (process.env.INVESTOR_DASHBOARD_EMAILS || "").trim();
  if (!raw) return new Set(defaults);

  const merged = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const email of defaults) merged.push(email);
  return new Set(merged);
}

function pctChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function summarizeMiniPlayerPeriod(
  playEvents: Array<{ playedAt: number; listenerId: Id<"users"> }>,
  userById: Map<string, { isAnonymous?: boolean }>,
  startMs: number,
  endMs: number,
) {
  const uniqueVisitors = new Set<string>();
  const uniqueRegisteredUsers = new Set<string>();
  let totalPlays = 0;

  for (const event of playEvents) {
    if (event.playedAt < startMs || event.playedAt >= endMs) continue;
    totalPlays += 1;

    const listenerKey = String(event.listenerId);
    const listener = userById.get(listenerKey);
    if (listener?.isAnonymous) {
      uniqueVisitors.add(listenerKey);
    } else {
      uniqueRegisteredUsers.add(listenerKey);
    }
  }

  return {
    totalPlays,
    uniqueVisitors: uniqueVisitors.size,
    uniqueUsers: uniqueRegisteredUsers.size,
    totalUniqueListeners: uniqueVisitors.size + uniqueRegisteredUsers.size,
  };
}

async function collectActiveUserIdsSince(ctx: any, sinceMs: number) {
  const active = new Set<Id<"users">>();

  const posts = await ctx.db.query("posts").collect();
  for (const post of posts) {
    if (post._creationTime >= sinceMs) active.add(post.authorId);
  }

  const comments = await ctx.db.query("comments").collect();
  for (const comment of comments) {
    if (comment._creationTime >= sinceMs) active.add(comment.authorId);
  }

  const likes = await ctx.db.query("likes").collect();
  for (const like of likes) {
    if (like._creationTime >= sinceMs) active.add(like.userId);
  }

  const reposts = await ctx.db.query("reposts").collect();
  for (const repost of reposts) {
    if (repost._creationTime >= sinceMs) active.add(repost.userId);
  }

  const messages = await ctx.db.query("messages").collect();
  for (const message of messages) {
    if (message._creationTime >= sinceMs) active.add(message.senderId);
  }

  const playEvents = await ctx.db.query("playEvents").collect();
  for (const event of playEvents) {
    if (event.playedAt >= sinceMs) active.add(event.listenerId);
  }

  const presence = await ctx.db.query("userPresence").collect();
  for (const row of presence) {
    if (row.lastSeenAt >= sinceMs) active.add(row.userId);
  }

  return active;
}

export const getInvestorDashboardMetrics = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    const user = await ctx.db.get(authUserId);
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email || !getAuthorizedInvestorEmails().has(email)) {
      throw new Error("Not authorized to view investor dashboard");
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const dauSince = now - dayMs;
    const mauSince = now - 30 * dayMs;
    const thisWeekSince = now - 7 * dayMs;
    const prevWeekSince = now - 14 * dayMs;

    const users = await ctx.db.query("users").collect();
    const registeredUsers = users.filter((candidate: any) => !candidate?.isAnonymous);
    const registeredUserIdSet = new Set(registeredUsers.map((candidate: any) => String(candidate._id)));

    const rawDauIds = await collectActiveUserIdsSince(ctx, dauSince);
    const rawMauIds = await collectActiveUserIdsSince(ctx, mauSince);
    const dauIds = new Set(
      Array.from(rawDauIds).filter((userId) => registeredUserIdSet.has(String(userId))),
    );
    const mauIds = new Set(
      Array.from(rawMauIds).filter((userId) => registeredUserIdSet.has(String(userId))),
    );

    const totalUsers = registeredUserIdSet.size;
    const weeklyNewUsers = registeredUsers.filter((candidate: any) => candidate._creationTime >= thisWeekSince).length;
    const previousWeeklyNewUsers = registeredUsers.filter(
      (candidate: any) => candidate._creationTime >= prevWeekSince && candidate._creationTime < thisWeekSince,
    ).length;

    const dau = Math.min(dauIds.size, totalUsers);
    const mau = Math.min(mauIds.size, totalUsers);

    return {
      totalUsers,
      dau,
      mau,
      dauMauRatioPercent: mau > 0 ? (dau / mau) * 100 : 0,
      weeklyGrowthPercent: pctChange(weeklyNewUsers, previousWeeklyNewUsers),
      weeklyNewUsers,
      previousWeeklyNewUsers,
      calculatedAt: now,
    };
  },
});

export const getMiniPlayerGrowthMetrics = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    const user = await ctx.db.get(authUserId);
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email || !getAuthorizedInvestorEmails().has(email)) {
      throw new Error("Not authorized to view investor dashboard");
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const currentStart = now - 7 * dayMs;
    const previousStart = now - 14 * dayMs;
    const last30Start = now - 30 * dayMs;

    const [users, playEvents] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("playEvents").collect(),
    ]);

    const userById = new Map(
      users.map((candidate: any) => [String(candidate._id), { isAnonymous: !!candidate?.isAnonymous }]),
    );

    const current7d = summarizeMiniPlayerPeriod(playEvents, userById, currentStart, now);
    const previous7d = summarizeMiniPlayerPeriod(playEvents, userById, previousStart, currentStart);
    const last30d = summarizeMiniPlayerPeriod(playEvents, userById, last30Start, now);

    return {
      current7d,
      previous7d,
      last30d,
      growth: {
        playsPercent: pctChange(current7d.totalPlays, previous7d.totalPlays),
        visitorsPercent: pctChange(current7d.uniqueVisitors, previous7d.uniqueVisitors),
        usersPercent: pctChange(current7d.uniqueUsers, previous7d.uniqueUsers),
        totalUniquePercent: pctChange(
          current7d.totalUniqueListeners,
          previous7d.totalUniqueListeners,
        ),
      },
      calculatedAt: now,
    };
  },
});

export const ensureSeedWarmWelcome = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (user?.isAnonymous) return { skipped: true, reason: "anonymous" as const };

    const now = Date.now();
    const existing = await ctx.db
      .query("growthOnboarding")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing?.seedFollowedAt) {
      return { skipped: true, reason: "already_done" as const };
    }

    const seedUserIds = await getSeedUserIds(ctx, userId as Id<"users">);
    if (seedUserIds.length === 0) {
      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: now });
      } else {
        await ctx.db.insert("growthOnboarding", {
          userId: userId as Id<"users">,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { skipped: true, reason: "no_seed_accounts" as const };
    }

    let followedCount = 0;
    for (const seedId of seedUserIds) {
      const alreadyFollowing = await ctx.db
        .query("follows")
        .withIndex("by_connection", (q) => q.eq("followerId", seedId).eq("followingId", userId))
        .unique();
      if (alreadyFollowing) continue;

      await ctx.db.insert("follows", {
        followerId: seedId,
        followingId: userId as Id<"users">,
      });
      followedCount += 1;

      const actorName = await getDisplayName(ctx, seedId);
      const notificationId = await ctx.db.insert("notifications", {
        recipientId: userId as Id<"users">,
        actorId: seedId,
        type: "follow",
        profileId: seedId,
        message: `${actorName} started following you`,
        groupKey: `follow:${seedId}:${userId}`,
        readAt: undefined,
        createdAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.push.dispatchPushForNotification, {
        notificationId,
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        seedFollowedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("growthOnboarding", {
        userId: userId as Id<"users">,
        seedFollowedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { followedCount };
  },
});
