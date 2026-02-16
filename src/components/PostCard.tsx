import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { toast } from "sonner";

interface Post {
  _id: Id<"posts">;
  type: "song" | "playlist" | "thought";
  title: string;
  content: string;
  spotifyUrl?: string;
  appleMusicUrl?: string;
  youtubeUrl?: string;
  tags?: string[];
  likesCount: number;
  commentsCount: number;
  _creationTime: number;
  author: {
    id: Id<"users">;
    displayName: string;
    avatar?: Id<"_storage">;
  };
  isLiked: boolean;
}

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  const toggleLike = useMutation(api.posts.toggleLike);

  const handleLike = async () => {
    try {
      await toggleLike({ postId: post._id });
    } catch (error) {
      toast.error("Failed to update like");
    }
  };

  const getPostIcon = () => {
    switch (post.type) {
      case "song": return "🎵";
      case "playlist": return "📀";
      case "thought": return "💭";
      default: return "🎵";
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${Math.floor(diffInHours)}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
          {post.author.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{post.author.displayName}</span>
            <span className="text-lg">{getPostIcon()}</span>
          </div>
          <div className="text-sm text-gray-500">{formatDate(post._creationTime)}</div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        <h3 className="font-semibold text-lg text-gray-900">{post.title}</h3>
        <p className="text-gray-700 whitespace-pre-wrap">{post.content}</p>
        
        {/* Music Links */}
        {(post.spotifyUrl || post.appleMusicUrl || post.youtubeUrl) && (
          <div className="flex flex-wrap gap-2">
            {post.spotifyUrl && (
              <a
                href={post.spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium hover:bg-green-200 transition-colors"
              >
                🎵 Spotify
              </a>
            )}
            {post.appleMusicUrl && (
              <a
                href={post.appleMusicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                🍎 Apple Music
              </a>
            )}
            {post.youtubeUrl && (
              <a
                href={post.youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium hover:bg-red-200 transition-colors"
              >
                📺 YouTube
              </a>
            )}
          </div>
        )}

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.tags.map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-sm"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 pt-2 border-t">
        <button
          onClick={handleLike}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            post.isLiked
              ? "bg-red-50 text-red-600 hover:bg-red-100"
              : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          <span className="text-lg">{post.isLiked ? "❤️" : "🤍"}</span>
          <span className="font-medium">{post.likesCount}</span>
        </button>
        
        <div className="flex items-center gap-2 text-gray-600">
          <span className="text-lg">💬</span>
          <span className="font-medium">{post.commentsCount}</span>
        </div>
      </div>
    </div>
  );
}
