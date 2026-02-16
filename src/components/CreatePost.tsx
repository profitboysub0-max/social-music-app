import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toast } from "sonner";

export function CreatePost() {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<"song" | "playlist" | "thought">("song");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [appleMusicUrl, setAppleMusicUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [tags, setTags] = useState("");
  
  const createPost = useMutation(api.posts.createPost);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !content.trim()) {
      toast.error("Please fill in title and content");
      return;
    }

    try {
      await createPost({
        type,
        title: title.trim(),
        content: content.trim(),
        spotifyUrl: spotifyUrl.trim() || undefined,
        appleMusicUrl: appleMusicUrl.trim() || undefined,
        youtubeUrl: youtubeUrl.trim() || undefined,
        tags: tags.trim() ? tags.split(",").map(tag => tag.trim()).filter(Boolean) : undefined,
      });
      
      // Reset form
      setTitle("");
      setContent("");
      setSpotifyUrl("");
      setAppleMusicUrl("");
      setYoutubeUrl("");
      setTags("");
      setIsOpen(false);
      
      toast.success("Post created successfully!");
    } catch (error) {
      toast.error("Failed to create post");
    }
  };

  if (!isOpen) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <button
          onClick={() => setIsOpen(true)}
          className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
        >
          What music are you listening to? 🎵
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Share Music</h3>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Post Type */}
        <div className="flex gap-2">
          {[
            { value: "song", label: "🎵 Song", desc: "Share a single track" },
            { value: "playlist", label: "📀 Playlist", desc: "Share a collection" },
            { value: "thought", label: "💭 Thought", desc: "Music discussion" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value as typeof type)}
              className={`flex-1 p-3 rounded-lg border text-sm transition-colors ${
                type === option.value
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="font-medium">{option.label}</div>
              <div className="text-xs text-gray-500">{option.desc}</div>
            </button>
          ))}
        </div>

        {/* Title */}
        <div>
          <input
            type="text"
            placeholder={`${type === "song" ? "Song title" : type === "playlist" ? "Playlist name" : "What's on your mind?"}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        {/* Content */}
        <div>
          <textarea
            placeholder={`${type === "thought" ? "Share your thoughts about music..." : "Tell us about this music..."}`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
            required
          />
        </div>

        {/* Music Links */}
        {type !== "thought" && (
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700">Music Links (optional)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="url"
                placeholder="Spotify URL"
                value={spotifyUrl}
                onChange={(e) => setSpotifyUrl(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none text-sm"
              />
              <input
                type="url"
                placeholder="Apple Music URL"
                value={appleMusicUrl}
                onChange={(e) => setAppleMusicUrl(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none text-sm"
              />
              <input
                type="url"
                placeholder="YouTube URL"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none text-sm"
              />
            </div>
          </div>
        )}

        {/* Tags */}
        <div>
          <input
            type="text"
            placeholder="Tags (comma separated, e.g. rock, indie, chill)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Share Post
          </button>
        </div>
      </form>
    </div>
  );
}
