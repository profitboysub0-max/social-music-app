import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation } from "./_generated/server";
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
