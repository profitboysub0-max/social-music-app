// src/components/UserProfile.tsx
import React, { useState, useEffect } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toast } from "sonner";
import { PostCard } from "./PostCard";
import { ProfileAvatarUpload } from "./ProfileAvatarUpload";

function formatDayLabel(isoDate: string) {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function UserProfile() {
  const { isLoading: authLoading } = useConvexAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [activeFollowList, setActiveFollowList] = useState<"followers" | "following" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  // Fetch current user info
  const currentUser = useQuery(api.auth.loggedInUser);
  const profile = useQuery(api.profiles.getCurrentUserProfile);
  const uploadedAvatarUrl = useQuery(
    api.files.getImageUrl,
    profile?.avatar ? { storageId: profile.avatar } : "skip"
  );
  const userPosts = useQuery(
    api.posts.getUserPosts,
    currentUser ? { userId: currentUser._id } : "skip"
  );
  const followStats = useQuery(
    api.social.getFollowStats,
    currentUser ? { userId: currentUser._id } : "skip"
  );
  const followers = useQuery(
    api.social.getFollowers,
    currentUser ? { userId: currentUser._id } : "skip"
  );
  const following = useQuery(
    api.social.getFollowing,
    currentUser ? { userId: currentUser._id } : "skip"
  );
  const myPresence = useQuery(
    api.player.getUserPresence,
    currentUser ? { userId: currentUser._id } : "skip"
  );
  const creatorAnalytics = useQuery(api.posts.getCreatorAnalytics, {});
  const monetizationSummary = useQuery(api.monetization.getCreatorMonetizationSummary, { days: 30 });

  const updateProfile = useMutation(api.profiles.updateProfile);

  // Sync profile state for editing
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || "");
      setBio(profile.bio || "");
      setIsPublic(profile.isPublic ?? true);
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      toast.error("Display name is required");
      return;
    }
    try {
      await updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim() || undefined,
        isPublic,
      });
      toast.success("Profile updated successfully!");
      setIsEditing(false);
    } catch (err) {
      console.error("Error updating profile:", err);
      toast.error("Failed to update profile");
    }
  };

  if (authLoading || currentUser === undefined) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 text-center text-gray-700">
        Couldn't load your account profile yet. Try refreshing the page.
      </div>
    );
  }

  // Resolve Convex storage URL for uploaded avatars.
  const avatarUrl = uploadedAvatarUrl || currentUser.avatarUrl || null;
  const activeList = activeFollowList === "followers" ? followers : following;
  const activeListTitle = activeFollowList === "followers" ? "Followers" : "Following";

  return (
    <div className="space-y-6">
      {/* Profile Card */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                (profile?.displayName || currentUser.fullName || "U")
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>
            <div>
              <ProfileAvatarUpload />
            </div>
          </div>

          {/* Profile Info */}
          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display Name"
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                  placeholder="Bio"
                  className="w-full px-3 py-2 border rounded-lg resize-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  <span className="text-sm">Public profile</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveProfile}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h1 className="text-2xl font-bold">
                    {profile?.displayName || currentUser.fullName || "Music Lover"}
                  </h1>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-blue-600 text-sm"
                  >
                    Edit Profile
                  </button>
                </div>
                {profile?.bio && <p className="text-gray-700">{profile.bio}</p>}
                {myPresence?.isActive && myPresence.trackTitle ? (
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium">
                    <span>🟢</span>
                    <span>Listening now: {myPresence.trackTitle}</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm">
                    <span>⚪</span>
                    <span>Not currently listening</span>
                  </div>
                )}
                <div className="text-sm text-gray-600">📧 {currentUser.email}</div>
                {followStats && (
                  <div className="flex gap-4 text-sm">
                    <button
                      type="button"
                      onClick={() => setActiveFollowList("followers")}
                      className="hover:text-blue-600 transition-colors"
                    >
                      <strong>{followStats.followersCount}</strong> followers
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFollowList("following")}
                      className="hover:text-blue-600 transition-colors"
                    >
                      <strong>{followStats.followingCount}</strong> following
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {activeFollowList ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveFollowList("followers")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                    activeFollowList === "followers"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Followers
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFollowList("following")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                    activeFollowList === "following"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Following
                </button>
              </div>
              <button
                type="button"
                onClick={() => setActiveFollowList(null)}
                className="text-gray-500 hover:text-gray-800"
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {!activeList ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                </div>
              ) : activeList.length === 0 ? (
                <div className="p-4 text-sm text-gray-600 text-center">
                  No {activeListTitle.toLowerCase()} yet.
                </div>
              ) : (
                <ul className="divide-y">
                  {activeList.map((person) => {
                    const personAvatarUrl = person.avatarUrl || null;
                    const initial = person.displayName.charAt(0).toUpperCase();
                    return (
                      <li key={person.userId} className="flex items-center gap-3 px-2 py-3">
                        <div className="h-10 w-10 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-semibold">
                          {personAvatarUrl ? (
                            <img src={personAvatarUrl} alt={person.displayName} className="h-full w-full object-cover" />
                          ) : (
                            initial
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{person.displayName}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Creator Analytics */}
      <div className="bg-white rounded-lg shadow-sm border p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Creator Dashboard</h2>
          <p className="text-sm text-gray-600 mt-1">
            Play counts, listener stats, top tracks, and profile analytics.
          </p>
        </div>

        {!creatorAnalytics ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                <div className="text-xs text-blue-700 font-medium">Total plays</div>
                <div className="text-xl font-bold text-blue-900">{creatorAnalytics.overview.totalPlays}</div>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <div className="text-xs text-emerald-700 font-medium">Unique listeners (30d)</div>
                <div className="text-xl font-bold text-emerald-900">
                  {creatorAnalytics.listenerStats.uniqueListenersInRange}
                </div>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                <div className="text-xs text-amber-700 font-medium">Avg plays / track</div>
                <div className="text-xl font-bold text-amber-900">
                  {creatorAnalytics.overview.avgPlaysPerTrack}
                </div>
              </div>
              <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                <div className="text-xs text-violet-700 font-medium">Followers</div>
                <div className="text-xl font-bold text-violet-900">
                  {creatorAnalytics.overview.totalFollowers}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Listener stats ({creatorAnalytics.listenerStats.rangeDays}d)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Plays in range</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.listenerStats.playsInRange}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Listeners in range</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.listenerStats.uniqueListenersInRange}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Plays (7d)</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.listenerStats.playsInLast7Days}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Listeners (7d)</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.listenerStats.uniqueListenersInLast7Days}</div>
                </div>
              </div>
              <div className="grid grid-cols-5 md:grid-cols-10 gap-1 h-24 items-end">
                {creatorAnalytics.listenerStats.daily.map((entry) => {
                  const maxPlays = Math.max(
                    1,
                    ...creatorAnalytics.listenerStats.daily.map((item) => item.plays)
                  );
                  const heightPercent = Math.max(6, Math.round((entry.plays / maxPlays) * 100));
                  return (
                    <div key={entry.date} className="group flex flex-col items-center justify-end">
                      <div
                        className="w-full rounded-t bg-blue-500/80 hover:bg-blue-600 transition-colors"
                        style={{ height: `${heightPercent}%` }}
                        title={`${formatDayLabel(entry.date)}: ${entry.plays} plays, ${entry.uniqueListeners} listeners`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Top tracks</h3>
              {creatorAnalytics.topTracks.length === 0 ? (
                <div className="text-sm text-gray-600 rounded-lg border p-3">
                  No track posts yet. Share songs or playlists to populate this dashboard.
                </div>
              ) : (
                <div className="space-y-2">
                  {creatorAnalytics.topTracks.map((track, index) => (
                    <div key={track.postId} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">#{index + 1} {track.type}</div>
                        <div className="font-medium text-gray-900 truncate">{track.title}</div>
                      </div>
                      <div className="text-xs md:text-sm text-gray-700 flex items-center gap-3">
                        <span>▶ {track.playCount}</span>
                        <span>❤️ {track.likesCount}</span>
                        <span>💬 {track.commentsCount}</span>
                        <span>🔁 {track.repostsCount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Profile analytics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Posts</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.overview.totalPosts}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Track posts</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.overview.totalTrackPosts}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Engagement rate</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.overview.engagementRate}%</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">New followers (30d)</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.profileAnalytics.recentFollowers30d}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Active days ({creatorAnalytics.listenerStats.rangeDays}d)</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.profileAnalytics.activeDaysInRange}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-gray-500">Avg daily plays</div>
                  <div className="font-semibold text-gray-900">{creatorAnalytics.profileAnalytics.avgDailyPlaysInRange}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Creator Monetization</h2>
          <p className="text-sm text-gray-600 mt-1">
            Modeled Revenue (Beta) from tips and sponsored placements (last 30 days).
          </p>
        </div>

        {!monetizationSummary ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
              <div className="text-xs text-amber-700 font-medium">Estimated tip earnings</div>
              <div className="text-xl font-bold text-amber-900">${monetizationSummary.tips.totalTipsUsd.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <div className="text-xs text-emerald-700 font-medium">Tips count</div>
              <div className="text-xl font-bold text-emerald-900">{monetizationSummary.tips.tipsCount}</div>
            </div>
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
              <div className="text-xs text-sky-700 font-medium">Ad impressions</div>
              <div className="text-xl font-bold text-sky-900">{monetizationSummary.ads.impressions}</div>
            </div>
            <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
              <div className="text-xs text-violet-700 font-medium">Ad clicks (CTR)</div>
              <div className="text-xl font-bold text-violet-900">
                {monetizationSummary.ads.clicks} ({monetizationSummary.ads.ctrPercent.toFixed(2)}%)
              </div>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
              <div className="text-xs text-indigo-700 font-medium">Projected revenue</div>
              <div className="text-xl font-bold text-indigo-900">
                ${monetizationSummary.totalEstimatedRevenueUsd.toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* User Posts */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Your Posts</h2>
        {!userPosts ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : userPosts.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm border">
            <div className="text-4xl mb-4">🎵</div>
            <h3 className="text-lg font-medium mb-2">No posts yet</h3>
            <p className="text-gray-600">
              Share your first music post to get started!
            </p>
          </div>
        ) : (
          userPosts.map((post) => <PostCard key={post._id} post={post} />)
        )}
      </div>
    </div>
  );
}
