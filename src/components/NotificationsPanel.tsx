import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

const PAGE_SIZE = 20;

type NotificationsPanelProps = {
  onNavigateToPost: (postId: Id<"posts">, commentId?: Id<"comments"> | null) => void;
  onNavigateToProfile: (userId: Id<"users">) => void;
};

type NotificationItem = {
  _id: Id<"notifications">;
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
  actor?:
    | {
        id: Id<"users">;
        displayName: string;
        avatar?: Id<"_storage">;
        avatarUrl?: string | null;
      }
    | null;
  message: string;
  isRead: boolean;
  targetExists: boolean;
  createdAt: number;
};

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

function getNotificationIcon(type: string) {
  if (type === "like") return "❤️";
  if (type === "comment") return "💬";
  if (type === "follow") return "👥";
  if (type === "mention") return "@";
  if (type === "repost") return "🔁";
  if (type === "share") return "📤";
  if (type === "friend_listening") return "🎧";
  if (type === "network_trending") return "📈";
  return "⚙️";
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function getTimeGroup(timestamp: number): "Today" | "This week" | "Older" {
  const now = new Date();
  const date = new Date(timestamp);

  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.floor((nowMidnight - dateMidnight) / (1000 * 60 * 60 * 24));

  if (dayDiff === 0) return "Today";
  if (dayDiff <= 7) return "This week";
  return "Older";
}

function ActorAvatar({ notification }: { notification: NotificationItem }) {
  const actor = notification.actor;
  if (actor?.avatarUrl) {
    return (
      <img
        src={actor.avatarUrl}
        alt={actor.displayName}
        className="h-9 w-9 rounded-full object-cover border border-gray-200"
      />
    );
  }

  const fallbackChar = actor?.displayName?.charAt(0).toUpperCase() || "S";
  return (
    <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-sm">
      {fallbackChar}
    </div>
  );
}

export function NotificationsPanel({
  onNavigateToPost,
  onNavigateToProfile,
}: NotificationsPanelProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const notifications = useQuery(api.social.getNotifications, {
    limit: visibleCount,
    withinDays: 30,
  }) as
    | NotificationItem[]
    | undefined;
  const recentFollowers = useQuery(api.social.getRecentFollowers, { withinDays: 30 });
  const unreadCount = useQuery(api.social.getUnreadNotificationCount);
  const pushStatus = useQuery(api.notifications.getPushStatus);
  const webPushPublicKey = useQuery(api.notifications.getWebPushPublicKey);
  const upsertPushSubscription = useMutation(api.notifications.upsertPushSubscription);
  const deletePushSubscription = useMutation(api.notifications.deletePushSubscription);
  const markAllAsRead = useMutation(api.social.markAllNotificationsAsRead);
  const markAsRead = useMutation(api.social.markNotificationAsRead);
  const [isPushWorking, setIsPushWorking] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const browserPushSupported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  const enablePushNotifications = async () => {
    if (!browserPushSupported) {
      setPushError("Push notifications are not supported in this browser.");
      return;
    }
    if (!webPushPublicKey) {
      setPushError("Push key is not configured yet.");
      return;
    }

    try {
      setPushError(null);
      setIsPushWorking(true);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushError("Notification permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(webPushPublicKey),
        }));

      const json = subscription.toJSON();
      const endpoint = subscription.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        throw new Error("Browser returned an invalid push subscription.");
      }

      await upsertPushSubscription({
        endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent,
      });
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Failed to enable push notifications.");
    } finally {
      setIsPushWorking(false);
    }
  };

  const disablePushNotifications = async () => {
    if (!browserPushSupported) return;
    try {
      setPushError(null);
      setIsPushWorking(true);
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await deletePushSubscription({ endpoint });
      }
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Failed to disable push notifications.");
    } finally {
      setIsPushWorking(false);
    }
  };

  const hasMore = useMemo(
    () => !!notifications && notifications.length >= visibleCount,
    [notifications, visibleCount],
  );

  const groupedNotifications = useMemo(() => {
    const groups: Record<"Today" | "This week" | "Older", NotificationItem[]> = {
      Today: [],
      "This week": [],
      Older: [],
    };

    (notifications ?? []).forEach((notification) => {
      groups[getTimeGroup(notification.createdAt)].push(notification);
    });

    return groups;
  }, [notifications]);

  const handleOpenNotification = async (notification: NotificationItem) => {
    if (!notification.isRead) {
      await markAsRead({ notificationId: notification._id });
    }

    if (!notification.targetExists) {
      return;
    }

    if (
      (notification.type === "like" ||
        notification.type === "comment" ||
        notification.type === "mention" ||
        notification.type === "repost" ||
        notification.type === "share" ||
        notification.type === "network_trending") &&
      notification.postId
    ) {
      onNavigateToPost(notification.postId, notification.commentId ?? null);
      return;
    }

    const profileTarget = notification.profileId || notification.actor?.id;
    if (profileTarget) {
      onNavigateToProfile(profileTarget);
    }
  };

  if (!notifications) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 text-gray-600">
        Loading notifications...
      </div>
    );
  }

  const sectionOrder: ("Today" | "This week" | "Older")[] = ["Today", "This week", "Older"];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border p-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Notifications</h2>
          <p className="text-sm text-gray-600 mt-1">
            Likes, follows, trending alerts, listening activity, and more from the last 30 days.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => markAllAsRead({})}
            disabled={!unreadCount}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Mark all as read
          </button>
          {pushStatus?.supported ? (
            <button
              type="button"
              onClick={pushStatus.hasSubscription ? disablePushNotifications : enablePushNotifications}
              disabled={isPushWorking}
              className="px-3 py-1.5 rounded-lg border border-blue-200 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isPushWorking
                ? "Updating..."
                : pushStatus.hasSubscription
                  ? "Disable push alerts"
                  : "Enable push alerts"}
            </button>
          ) : (
            <span className="text-xs text-gray-500">Push alerts unavailable (server not configured).</span>
          )}
          {pushError ? <span className="text-xs text-red-600">{pushError}</span> : null}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-6 text-gray-600">
          No notifications in the last 30 days.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="px-4 py-2 border-b bg-gray-50">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Who Followed You (30d)
              </h3>
            </div>
            {!recentFollowers ? (
              <div className="px-4 py-3 text-sm text-gray-600">Loading followers...</div>
            ) : recentFollowers.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-600">
                No new followers in the last 30 days.
              </div>
            ) : (
              <div className="divide-y">
                {recentFollowers.map((follower) => (
                  <button
                    key={`follower-${follower.userId}`}
                    type="button"
                    onClick={() => onNavigateToProfile(follower.userId)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {follower.avatarUrl ? (
                        <img
                          src={follower.avatarUrl}
                          alt={follower.displayName}
                          className="h-9 w-9 rounded-full object-cover border border-gray-200"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-sm">
                          {follower.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {follower.displayName || "Unknown user"}
                        </div>
                        <div className="text-xs text-gray-500">
                          Followed you {formatRelativeTime(follower.followedAt)} ago
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {sectionOrder.map((section) => {
            const sectionItems = groupedNotifications[section];
            if (sectionItems.length === 0) return null;

            return (
              <div key={section} className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <div className="px-4 py-2 border-b bg-gray-50">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {section}
                  </h3>
                </div>
                <div className="divide-y">
                  {sectionItems.map((notification) => (
                    <button
                      key={notification._id}
                      type="button"
                      onClick={() => handleOpenNotification(notification)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <ActorAvatar notification={notification} />
                        <div className="pt-0.5 text-lg">{getNotificationIcon(notification.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {!notification.isRead ? (
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                            ) : null}
                            <span className="text-sm font-medium text-gray-900 break-words">
                              {notification.actor?.displayName || "System"}
                            </span>
                            <span className="text-xs text-gray-500">
                              {formatRelativeTime(notification.createdAt)}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-gray-700 break-words">
                            {notification.message}
                          </div>
                          {!notification.targetExists ? (
                            <div className="mt-1 text-xs text-amber-600">
                              This content is no longer available.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
