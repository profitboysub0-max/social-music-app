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
  playCount: number;
  _creationTime: number;
  author: {
    id: Id<"users">;
    displayName: string;
    avatar?: Id<"_storage">;
    avatarUrl?: string | null;
    listeningNow?: {
      trackTitle: string;
      startedAt: number;
    } | null;
  };
  isLiked: boolean;
  isReposted: boolean;
}

interface PostCardProps {
  post: Post;
  focusCommentId?: Id<"comments"> | null;
  onNavigateToProfile?: (userId: Id<"users">) => void;
}

export function PostCard({
  post,
  focusCommentId = null,
  onNavigateToProfile,
}: PostCardProps) {
  const toggleLike = useMutation(api.posts.toggleLike);
  const toggleRepost = useMutation(api.posts.toggleRepost);
  const recordPlay = useMutation(api.posts.recordPlay);
  const saveSongFromPost = useMutation(api.playlists.saveSongFromPost);
  const addTrackToPlaylist = useMutation(api.playlists.addTrackToPlaylist);
  const createShareReference = useMutation(api.posts.createShareReference);
  const addComment = useMutation(api.posts.addComment);
  const deletePost = useMutation(api.posts.deletePost);
  const isSongSaved = useQuery(
    api.playlists.isSongSaved,
    post.type === "song" ? { postId: post._id } : "skip",
  );
  const writablePlaylists = useQuery(api.playlists.getWritablePlaylists);
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
    void recordPlay({ postId: post._id, trackUrl: url }).catch(() => undefined);

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

  const getPrimaryTrackUrl = () => post.spotifyUrl || post.appleMusicUrl || post.youtubeUrl;

  const handleSaveSong = async () => {
    if (isGuest) {
      toast.error("Create an account to save songs.");
      return;
    }
    try {
      await saveSongFromPost({ postId: post._id });
      toast.success("Song saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save song");
    }
  };

  const handleAddToPlaylist = async () => {
    if (isGuest) {
      toast.error("Create an account to use playlists.");
      return;
    }
    if (!writablePlaylists || writablePlaylists.length === 0) {
      toast.error("Create a playlist first.");
      return;
    }

    const options = writablePlaylists
      .map((playlist, index) => `${index + 1}. ${playlist.name}`)
      .join("\n");
    const selection = window.prompt(`Select playlist number:\n${options}`);
    if (!selection) return;
    const selectedIndex = Number(selection) - 1;
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= writablePlaylists.length) {
      toast.error("Invalid selection.");
      return;
    }

    const selected = writablePlaylists[selectedIndex];
    try {
      await addTrackToPlaylist({
        playlistId: selected._id,
        sourcePostId: post._id,
        title: post.title,
        url: getPrimaryTrackUrl() || undefined,
        notes: post.content,
      });
      toast.success(`Added to ${selected.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add to playlist");
    }
  };

  const createShareCardBlob = async (shareUrl: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create share card");

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#0f172a");
    gradient.addColorStop(0.5, "#1d4ed8");
    gradient.addColorStop(1, "#0ea5e9");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(64, 64, canvas.width - 128, canvas.height - 128);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 56px sans-serif";
    ctx.fillText(`🎧 ${post.author.displayName} is listening to`, 108, 220);

    ctx.font = "bold 78px sans-serif";
    ctx.fillText(post.title.slice(0, 28), 108, 360);

    ctx.font = "42px sans-serif";
    const artistLine = post.content.split("\n")[0]?.slice(0, 40) || "Music vibes";
    ctx.fillText(artistLine, 108, 430);

    ctx.font = "bold 48px sans-serif";
    ctx.fillText("Listen with me →", 108, 620);

    ctx.font = "32px monospace";
    ctx.fillText(shareUrl, 108, 690);

    ctx.font = "32px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("Put Me On", 108, 920);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((file) => resolve(file), "image/png"),
    );
    if (!blob) throw new Error("Failed to render share card");
    return blob;
  };

  const buildShareText = () => {
    const context = post.content.split("\n")[0]?.trim();
    const cleanContext = context ? ` - ${context.slice(0, 60)}` : "";
    return `${post.author.displayName} is listening to "${post.title}"${cleanContext}. Listen with me.`;
  };

  const getSharePayload = async () => {
    const { code } = await createShareReference({ postId: post._id });
    const shareUrl = `${window.location.origin}/r/${code}`;
    const shareText = buildShareText();
    const shareTitle = `${post.author.displayName} is listening`;
    // Optional later: replace with dynamic OG image endpoint, e.g. `${window.location.origin}/og/${code}.png`.
    const ogImageUrl = "";
    return { code, shareUrl, shareText, shareTitle, ogImageUrl };
  };

  const isMobileDevice = () =>
    /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);

  const handleShare = async () => {
    try {
      const { code, shareUrl, shareText, shareTitle } = await getSharePayload();
      const blob = await createShareCardBlob(shareUrl);
      const file = new File([blob], `listening-${code}.png`, { type: "image/png" });
      const hasNativeShare = typeof navigator.share === "function";
      const mobile = isMobileDevice();

      if (hasNativeShare && mobile) {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: shareUrl,
            files: [file],
          });
          return;
        }

        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        // ignore clipboard errors
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `listening-${code}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success("Share card downloaded and link copied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to share");
    }
  };

  const handleCopyLink = async () => {
    try {
      const { shareUrl } = await getSharePayload();
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to copy link");
    }
  };


  return (
    <div id={`post-${post._id}`} className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onNavigateToProfile?.(post.author.id)}
          className="shrink-0"
          aria-label={`View ${post.author.displayName}'s profile`}
        >
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
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateToProfile?.(post.author.id)}
              className="font-medium text-gray-900 hover:underline"
            >
              {post.author.displayName}
            </button>
            <span className="text-lg">{getPostIcon()}</span>
          </div>
          {post.author.listeningNow?.trackTitle ? (
            <div className="text-xs text-emerald-700 font-medium">
              Listening now: {post.author.listeningNow.trackTitle}
            </div>
          ) : null}
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

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600">
          <span className="text-lg">▶</span>
          <span className="font-medium">{post.playCount ?? 0}</span>
        </div>

        {post.type === "song" ? (
          <button
            onClick={handleSaveSong}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              isSongSaved
                ? "bg-yellow-50 text-yellow-700"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span className="text-lg">{isSongSaved ? "⭐" : "☆"}</span>
            <span className="font-medium text-sm">{isSongSaved ? "Saved" : "Save song"}</span>
          </button>
        ) : null}

        {(post.type === "song" || post.type === "playlist") ? (
          <button
            onClick={handleAddToPlaylist}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span className="text-lg">➕</span>
            <span className="font-medium text-sm">Add to playlist</span>
          </button>
        ) : null}

        {(post.type === "song" || post.type === "playlist") ? (
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span className="text-lg">📤</span>
            <span className="font-medium text-sm">Share</span>
          </button>
        ) : null}

        {(post.type === "song" || post.type === "playlist") ? (
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <span className="text-lg">🔗</span>
            <span className="font-medium text-sm">Copy link</span>
          </button>
        ) : null}

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
