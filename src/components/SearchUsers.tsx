import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { toast } from "sonner";

type SearchUsersProps = {
  initialSelectedUserId?: Id<"users"> | null;
};

export function SearchUsers({ initialSelectedUserId = null }: SearchUsersProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<Id<"users"> | null>(null);

  useEffect(() => {
    if (initialSelectedUserId) {
      setSelectedUserId(initialSelectedUserId);
    }
  }, [initialSelectedUserId]);
  
  const searchResults = useQuery(
    api.profiles.searchUsers,
    searchTerm.trim() ? { searchTerm: searchTerm.trim() } : "skip"
  );
  
  const selectedUserPosts = useQuery(
    api.posts.getUserPosts,
    selectedUserId ? { userId: selectedUserId } : "skip"
  );
  
  const selectedUserProfile = useQuery(
    api.profiles.getProfile,
    selectedUserId ? { userId: selectedUserId } : "skip"
  );
  
  const followStats = useQuery(
    api.social.getFollowStats,
    selectedUserId ? { userId: selectedUserId } : "skip"
  );
  const selectedUserPresence = useQuery(
    api.player.getUserPresence,
    selectedUserId ? { userId: selectedUserId } : "skip"
  );
  
  const isFollowing = useQuery(
    api.social.isFollowing,
    selectedUserId ? { userId: selectedUserId } : "skip"
  );
  const currentUser = useQuery(api.auth.loggedInUser);
  const isGuest = !!(currentUser as { isAnonymous?: boolean } | null)?.isAnonymous;
  
  const followUser = useMutation(api.social.followUser);
  const unfollowUser = useMutation(api.social.unfollowUser);
  
  const handleFollow = async (userId: Id<"users">) => {
    if (isGuest) {
      toast.error("Create an account to follow users.");
      return;
    }
    try {
      await followUser({ userId });
      toast.success("User followed!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to follow user");
    }
  };
  
  const handleUnfollow = async (userId: Id<"users">) => {
    if (isGuest) {
      toast.error("Create an account to follow users.");
      return;
    }
    try {
      await unfollowUser({ userId });
      toast.success("User unfollowed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unfollow user");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Discover Music Lovers</h2>
        
        <div className="relative">
          <input
            type="text"
            placeholder="Search for users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-3 pl-10 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
            🔍
          </div>
        </div>
        
        {searchResults && searchResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {searchResults.map((user) => (
              <div
                key={user.userId}
                className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                onClick={() => setSelectedUserId(user.userId)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{user.displayName}</div>
                    {user.bio && (
                      <div className="text-sm text-gray-600 truncate max-w-xs">{user.bio}</div>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedUserId(user.userId);
                  }}
                  className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 transition-colors"
                >
                  View Profile
                </button>
              </div>
            ))}
          </div>
        )}
        
        {searchTerm && searchResults && searchResults.length === 0 && (
          <div className="mt-4 text-center py-8 text-gray-500">
            No users found matching "{searchTerm}"
          </div>
        )}
      </div>

      {/* Selected User Profile */}
      {selectedUserId && selectedUserProfile && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
              {selectedUserProfile.displayName.charAt(0).toUpperCase()}
            </div>
            
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-bold text-gray-900">
                  {selectedUserProfile.displayName}
                </h3>
                
                {isFollowing !== undefined && (
                  <button
                    disabled={isGuest}
                    onClick={() => isFollowing 
                      ? handleUnfollow(selectedUserId) 
                      : handleFollow(selectedUserId)
                    }
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      isGuest
                        ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                        : isFollowing
                        ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {isGuest ? "Create account to follow" : isFollowing ? "Following" : "Follow"}
                  </button>
                )}
              </div>
              
              {selectedUserProfile.bio && (
                <p className="text-gray-700 mb-3">{selectedUserProfile.bio}</p>
              )}
              {selectedUserPresence?.isActive && selectedUserPresence.trackTitle ? (
                <div className="mb-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium">
                  <span>🟢</span>
                  <span>Listening now: {selectedUserPresence.trackTitle}</span>
                </div>
              ) : null}
              
              {followStats && (
                <div className="flex gap-4 text-sm text-gray-600">
                  <span>
                    <strong className="text-gray-900">{followStats.followersCount}</strong> followers
                  </span>
                  <span>
                    <strong className="text-gray-900">{followStats.followingCount}</strong> following
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* User's Posts */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-900">Recent Posts</h4>
            
            {selectedUserPosts === undefined ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              </div>
            ) : selectedUserPosts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No posts yet
              </div>
            ) : (
              <div className="space-y-3">
                {selectedUserPosts.slice(0, 3).map((post) => (
                  <div key={post._id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">
                        {post.type === "song" ? "🎵" : post.type === "playlist" ? "📀" : "💭"}
                      </span>
                      <h5 className="font-medium text-gray-900">{post.title}</h5>
                    </div>
                    <p className="text-gray-700 text-sm line-clamp-2">{post.content}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>❤️ {post.likesCount}</span>
                      <span>💬 {post.commentsCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
