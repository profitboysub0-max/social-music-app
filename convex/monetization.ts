import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 50000;
const DEFAULT_WINDOW_DAYS = 30;

async function requireNonGuestUserId(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (user?.isAnonymous) {
    throw new Error("Create an account to send tips.");
  }
  return userId as Id<"users">;
}

function clampDays(days?: number) {
  return Math.max(1, Math.min(days ?? DEFAULT_WINDOW_DAYS, 365));
}

export const sendCreatorTip = mutation({
  args: {
    creatorId: v.id("users"),
    amountCents: v.number(),
    message: v.optional(v.string()),
    postId: v.optional(v.id("posts")),
  },
  handler: async (ctx, args) => {
    const senderId = await requireNonGuestUserId(ctx);
    if (senderId === args.creatorId) throw new Error("You cannot tip yourself.");
    if (args.amountCents < MIN_TIP_CENTS || args.amountCents > MAX_TIP_CENTS) {
      throw new Error("Tip amount must be between $1 and $500.");
    }

    const creator = await ctx.db.get(args.creatorId);
    if (!creator || creator.isAnonymous) throw new Error("Creator account not found.");

    const now = Date.now();
    await ctx.db.insert("creatorTips", {
      creatorId: args.creatorId,
      senderId,
      amountCents: Math.floor(args.amountCents),
      message: args.message?.trim() || undefined,
      postId: args.postId,
      createdAt: now,
    });

    return { ok: true, createdAt: now };
  },
});

export const trackAdEvent = mutation({
  args: {
    creatorId: v.id("users"),
    eventType: v.union(v.literal("impression"), v.literal("click")),
    placement: v.string(),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getAuthUserId(ctx);
    const viewer = viewerUserId ? await ctx.db.get(viewerUserId) : null;
    const viewerKind = viewerUserId && !viewer?.isAnonymous ? "member" : "guest";

    await ctx.db.insert("adEvents", {
      creatorId: args.creatorId,
      eventType: args.eventType,
      placement: args.placement.trim().slice(0, 64) || "unknown",
      viewerUserId: viewerUserId || undefined,
      viewerKind,
      createdAt: Date.now(),
    });

    return { ok: true };
  },
});

export const getCreatorMonetizationSummary = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const creatorId = await getAuthUserId(ctx);
    if (!creatorId) return null;

    const days = clampDays(args.days);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const [tips, adEvents] = await Promise.all([
      ctx.db
        .query("creatorTips")
        .withIndex("by_creator_created", (q) => q.eq("creatorId", creatorId))
        .collect(),
      ctx.db
        .query("adEvents")
        .withIndex("by_creator_created", (q) => q.eq("creatorId", creatorId))
        .collect(),
    ]);

    const windowTips = tips.filter((tip) => tip.createdAt >= cutoff);
    const windowAds = adEvents.filter((event) => event.createdAt >= cutoff);

    const totalTipsCents = windowTips.reduce((sum, tip) => sum + tip.amountCents, 0);
    const uniqueTippers = new Set(windowTips.map((tip) => String(tip.senderId))).size;
    const impressions = windowAds.filter((event) => event.eventType === "impression").length;
    const clicks = windowAds.filter((event) => event.eventType === "click").length;

    const estimatedAdRevenueUsd = Number(((impressions / 1000) * 2 + clicks * 0.25).toFixed(2));
    const tipRevenueUsd = Number((totalTipsCents / 100).toFixed(2));

    return {
      windowDays: days,
      tips: {
        totalTipsCents,
        totalTipsUsd: tipRevenueUsd,
        tipsCount: windowTips.length,
        uniqueTippers,
      },
      ads: {
        impressions,
        clicks,
        ctrPercent: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        estimatedRevenueUsd: estimatedAdRevenueUsd,
      },
      totalEstimatedRevenueUsd: Number((tipRevenueUsd + estimatedAdRevenueUsd).toFixed(2)),
    };
  },
});
