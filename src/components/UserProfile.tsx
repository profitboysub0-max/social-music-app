// src/components/UserProfile.tsx
import React, { useState, useEffect } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toast } from "sonner";
import { PostCard } from "./PostCard";
import { ProfileAvatarUpload } from "./ProfileAvatarUpload";

export function UserProfile() {
  const { isLoading: authLoading } = useConvexAuth();
  const [isEditing, setIsEditing] = useState(false);
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
                <div className="text-sm text-gray-600">📧 {currentUser.email}</div>
                {followStats && (
                  <div className="flex gap-4 text-sm">
                    <span>
                      <strong>{followStats.followersCount}</strong> followers
                    </span>
                    <span>
                      <strong>{followStats.followingCount}</strong> following
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
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
