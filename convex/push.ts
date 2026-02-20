"use node";

import webpush from "web-push";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { Id } from "./_generated/dataModel";

type NotificationDoc = {
  _id: Id<"notifications">;
  actorId?: Id<"users">;
  type:
    | "like"
    | "comment"
    | "follow"
    | "mention"
    | "repost"
    | "share"
    | "friend_listening"
    | "network_trending"
    | "system_update";
  postId?: Id<"posts">;
  commentId?: Id<"comments">;
  profileId?: Id<"users">;
  message: string;
  createdAt: number;
  groupKey?: string;
};

function isWebPushConfigured() {
  return !!process.env.WEB_PUSH_PUBLIC_KEY && !!process.env.WEB_PUSH_PRIVATE_KEY;
}

function toAbsoluteUrl(path: string) {
  const siteUrl = process.env.SITE_URL || process.env.PUBLIC_SITE_URL || "http://localhost:5173";
  const normalized = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return `${normalized}${path}`;
}

function buildNotificationUrl(notification: NotificationDoc) {
  if (notification.postId) {
    const commentQuery = notification.commentId
      ? `&commentId=${encodeURIComponent(String(notification.commentId))}`
      : "";
    return `/?tab=feed&postId=${encodeURIComponent(String(notification.postId))}${commentQuery}`;
  }

  if (notification.profileId || notification.actorId) {
    const userId = notification.profileId || notification.actorId;
    return `/?tab=search&userId=${encodeURIComponent(String(userId))}`;
  }

  return "/?tab=notifications";
}

function buildTitle(notificationType: NotificationDoc["type"]) {
  if (notificationType === "like") return "Someone liked your track";
  if (notificationType === "follow") return "New follower";
  if (notificationType === "network_trending") return "Trending in your network";
  if (notificationType === "friend_listening") return "Friend started listening";
  if (notificationType === "comment") return "New comment";
  if (notificationType === "mention") return "You were mentioned";
  if (notificationType === "repost") return "Your post was reposted";
  if (notificationType === "share") return "Someone shared your track";
  return "New update";
}

export const dispatchPushForNotification = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    if (!isWebPushConfigured()) return;

    const payloadData = await ctx.runQuery(internal.notifications.getPushDispatchData, {
      notificationId: args.notificationId,
    });
    if (!payloadData) return;

    webpush.setVapidDetails(
      process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com",
      process.env.WEB_PUSH_PUBLIC_KEY!,
      process.env.WEB_PUSH_PRIVATE_KEY!,
    );

    const notification = payloadData.notification as NotificationDoc;
    const payload = JSON.stringify({
      title: buildTitle(notification.type),
      body: notification.message,
      tag: notification.groupKey || `notification:${String(notification._id)}`,
      url: toAbsoluteUrl(buildNotificationUrl(notification)),
      createdAt: notification.createdAt,
    });

    await Promise.all(
      payloadData.subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
          );
        } catch (error: any) {
          const status = error?.statusCode;
          if (status === 404 || status === 410) {
            await ctx.runMutation(internal.notifications.removePushSubscriptionByEndpoint, {
              endpoint: subscription.endpoint,
            });
          }
        }
      }),
    );
  },
});
