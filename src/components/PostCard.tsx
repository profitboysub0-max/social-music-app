import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { toast } from "sonner";
import { usePlayer } from "../context/PlayerProvider";
import { FormEvent, useEffect, useMemo, useState } from "react";

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
  repostsCount: number;
  _creationTime: number;
  author: {
    id: Id<"users">;
    displayName: string;
    avatar?: Id<"_storage">;
    avatarUrl?: string | null;
  };
  isLiked: boolean;
  isReposted: boolean;
}

interface PostCardProps {
  post: Post;
  focusCommentId?: Id<"comments"> | null;
}

export function PostCard({ post, focusCommentId = null }: PostCardProps) {
  const toggleLike = useMutation(api.posts.toggleLike);
  const toggleRepost = useMutation(api.posts.toggleRepost);
  const addComment = useMutation(api.posts.addComment);
  const deletePost = useMutation(api.posts.deletePost);
  const currentUser = useQuery(api.auth.loggedInUser);
  const isGuest = !!(currentUser as { isAnonymous?: boolean } | null)?.isAnonymous;
  const comments = useQuery(api.posts.getComments, { postId: post._id });

  const { play } = usePlayer();
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const hasFocusedComment = useMemo(
    () => !!focusCommentId && comments?.some((comment) => comment._id === focusCommentId),
    [comments, focusCommentId],
  );

  useEffect(() => {
    if (!hasFocusedComment || !focusCommentId) {
      return;
    }
    setShowComments(true);
    const timeout = setTimeout(() => {
      const element = document.getElementById(`comment-${focusCommentId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(timeout);
  }, [focusCommentId, hasFocusedComment]);

  const handleLike = async () => {
    if (isGuest) {
      toast.error("Create an account to like posts.");
      return;
    }
    try {
      await toggleLike({ postId: post._id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update like");
    }
  };

  const handleRepost = async () => {
    if (isGuest) {
      toast.error("Create an account to repost.");
      return;
    }
    try {
      await toggleRepost({ postId: post._id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update repost");
    }
  };

  const handleAddComment = async (event: FormEvent) => {
    event.preventDefault();
    if (isGuest) {
      toast.error("Create an account to comment.");
      return;
    }
    const trimmed = commentText.trim();
    if (!trimmed) return;

    try {
      setIsSubmittingComment(true);
      await addComment({ postId: post._id, content: trimmed });
      setCommentText("");
      setShowComments(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add comment");
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeletePost = async () => {
    const confirmed = window.confirm("Delete this post? This action cannot be undone.");
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      await deletePost({ postId: post._id });
      toast.success("Post deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete post");
    } finally {
      setIsDeleting(false);
    }
  };

  const getPostIcon = () => {
    switch (post.type) {
      case "song":
        return "🎵";
      case "playlist":
        return "📀";
      case "thought":
        return "💭";
      default:
        return "🎵";
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

  const isDirectAudioUrl = (url: string) =>
    /\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?.*)?$/i.test(url);

  const getYouTubeEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtu.be")) {
        const id = parsed.pathname.replace("/", "");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (parsed.hostname.includes("youtube.com")) {
        const id = parsed.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      return null;
    } catch {
      return null;
    }
  };

  const getSpotifyEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes("spotify.com")) return null;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      const type = parts[0];
      const id = parts[1];
      if (!["track", "album", "playlist", "episode", "show"].includes(type)) {
        return null;
      }
      return `https://open.spotify.com/embed/${type}/${id}`;
    } catch {
      return null;
    }
  };

  const getAppleMusicEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes("music.apple.com")) return null;
      return `https://embed.music.apple.com${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
  };

  const handleMusicClick = (url: string) => {
    if (!url) return;

    if (isDirectAudioUrl(url)) {
      setEmbedUrl(null);
      play({
        url,
        title: `${post.author.displayName} - ${post.title}`,
        thumbnail: post.author.avatarUrl || null,
      });
      return;
    }

    const embed =
      getSpotifyEmbedUrl(url) || getYouTubeEmbedUrl(url) || getAppleMusicEmbedUrl(url);

    if (embed) {
      setEmbedUrl(embed);
      return;
    }

    toast.error("This link can't be embedded in-app yet. Try a direct audio URL.");
  };

  return (
    <div id={`post-${post._id}`} className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
      <div className="flex items-center gap-3">
        {post.author.avatarUrl ? (
          <img
            src={post.author.avatarUrl}
            alt={post.author.displayName}
            className="w-10 h-10 rounded-full object-cover border border-gray-200"
          />
        ) : (
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
            {post.author.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{post.author.displayName}</span>
            <span className="text-lg">{getPostIcon()}</span>
          </div>
          <div className="text-sm text-gray-500">{formatDate(post._creationTime)}</div>
        </div>
        {currentUser?._id === post.author.id ? (
          <button
            type="button"
            onClick={handleDeletePost}
            disabled={isDeleting}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        ) : null}
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-lg text-gray-900">{post.title}</h3>
        <p className="text-gray-700 whitespace-pre-wrap">{post.content}</p>

        {(post.spotifyUrl || post.appleMusicUrl || post.youtubeUrl) && (
          <div className="flex flex-wrap gap-2">
            {post.spotifyUrl && (
              <button
                type="button"
                onClick={() => handleMusicClick(post.spotifyUrl!)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium hover:bg-green-200 transition-colors"
              >
                🎵 Spotify
              </button>
            )}
            {post.appleMusicUrl && (
              <button
                type="button"
                onClick={() => handleMusicClick(post.appleMusicUrl!)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                🍎 Apple Music
              </button>
            )}
            {post.youtubeUrl && (
              <button
                type="button"
                onClick={() => handleMusicClick(post.youtubeUrl!)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium hover:bg-red-200 transition-colors"
              >
                📺 Play on YouTube
              </button>
            )}
          </div>
        )}

        {embedUrl && (
          <div className="rounded-lg overflow-hidden border bg-black">
            <iframe
              src={embedUrl}
              title={`Embedded player for ${post.title}`}
              className="w-full h-64"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            />
          </div>
        )}

        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.tags.map((tag, index) => (
              <span key={index} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-sm">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

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

        <button
          onClick={() => setShowComments((current) => !current)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span className="text-lg">💬</span>
          <span className="font-medium">{post.commentsCount}</span>
        </button>

        <button
          onClick={handleRepost}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
            post.isReposted
              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          <span className="text-lg">🔁</span>
          <span className="font-medium">{post.repostsCount ?? 0}</span>
        </button>
      </div>

      <div className="space-y-3 border-t pt-4">
        <form onSubmit={handleAddComment} className="flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder={
              isGuest
                ? "Create an account to comment"
                : "Write a comment (use @displayName for mentions)"
            }
            disabled={isGuest}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <button
            type="submit"
            disabled={isGuest || isSubmittingComment || !commentText.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmittingComment ? "Posting..." : "Comment"}
          </button>
        </form>

        {showComments && (
          <div className="space-y-2">
            {!comments ? (
              <div className="text-sm text-gray-500">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-sm text-gray-500">No comments yet.</div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment._id}
                  id={`comment-${comment._id}`}
                  className={`rounded-lg border p-3 ${
                    focusCommentId === comment._id ? "border-blue-300 bg-blue-50" : "bg-gray-50"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {comment.author.avatarUrl ? (
                      <img
                        src={comment.author.avatarUrl}
                        alt={comment.author.displayName}
                        className="w-7 h-7 rounded-full object-cover border border-gray-200 mt-0.5"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold mt-0.5">
                        {comment.author.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{comment.author.displayName}</div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{comment.content}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
