import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { PostCard } from "./PostCard";
import { toast } from "sonner";

const PAGE_SIZE = 20;

type FeedPost = {
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
    listeningNow?: {
      trackTitle: string;
      startedAt: number;
    } | null;
  };
  isLiked: boolean;
  isReposted: boolean;
};

type MusicFeedProps = {
  scope?: "personal" | "public";
  focusPostId?: Id<"posts"> | null;
  focusCommentId?: Id<"comments"> | null;
  onFocusHandled?: () => void;
  onNavigateToProfile?: (userId: Id<"users">) => void;
};

export function MusicFeed({
  scope = "personal",
  focusPostId = null,
  focusCommentId = null,
  onFocusHandled,
  onNavigateToProfile,
}: MusicFeedProps) {
  const convex = useConvex();
  const currentUser = useQuery(api.auth.loggedInUser);
  const seedStarterFeed = useMutation(api.posts.seedStarterFeed);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const fetchFeed = useCallback(
    async (limit: number) => {
      try {
        setError(null);
        const nextPosts =
          scope === "public"
            ? await convex.query((api as any).posts.getPublicFeedPosts, { limit })
            : await convex.query(api.posts.getFeedPosts, { limit });
        const typedPosts = nextPosts as FeedPost[];
        if (focusPostId && !typedPosts.some((post) => post._id === focusPostId)) {
          const focusedPost = (await convex.query(api.posts.getPostById, {
            postId: focusPostId,
          })) as FeedPost | null;
          if (focusedPost) {
            setPosts([focusedPost, ...typedPosts]);
            return;
          }
        }
        setPosts(typedPosts);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong while loading your feed.",
        );
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [convex, focusPostId, scope],
  );

  useEffect(() => {
    void fetchFeed(visibleCount);
  }, [fetchFeed, visibleCount]);

  const handleLoadMore = useCallback(() => {
    if (isLoading || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, [isLoading, isLoadingMore]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || isLoading || isLoadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          handleLoadMore();
        }
      },
      { rootMargin: "300px 0px 300px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [handleLoadMore, isLoading, isLoadingMore]);

  const hasMore = useMemo(
    () => posts.length > 0 && posts.length >= visibleCount,
    [posts.length, visibleCount],
  );

  useEffect(() => {
    if (!focusPostId) {
      return;
    }
    const timeout = setTimeout(() => {
      const element = document.getElementById(`post-${focusPostId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      onFocusHandled?.();
    }, 250);

    return () => clearTimeout(timeout);
  }, [focusPostId, onFocusHandled, posts]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          {scope === "public" ? "Public Feed" : "Your Music Feed"}
        </h2>
        {[0, 1, 2].map((skeleton) => (
          <div
            key={skeleton}
            className="bg-white rounded-lg shadow-sm border p-6 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-200" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-32 bg-gray-200 rounded" />
                <div className="h-3 w-20 bg-gray-100 rounded" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-4 w-2/3 bg-gray-200 rounded" />
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-5/6 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center space-y-2">
        <h2 className="text-lg font-semibold text-red-700">
          Couldn't load your feed
        </h2>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={() => {
            setIsLoading(true);
            void fetchFeed(visibleCount);
          }}
          className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    const canSeed = !!currentUser && !(currentUser as { isAnonymous?: boolean }).isAnonymous;
    return (
      <div className="text-center py-12 bg-white rounded-lg shadow-sm border px-6">
        <div className="text-4xl mb-4">🎵</div>
        {scope === "public" ? (
          <>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No public posts yet
            </h3>
            <p className="text-gray-600 max-w-md mx-auto">
              Be the first to share something with the community.
            </p>
            {canSeed ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await seedStarterFeed({});
                    if (result.inserted > 0) {
                      toast.success(`Seeded ${result.inserted} starter posts.`);
                      setIsLoading(true);
                      await fetchFeed(visibleCount);
                    } else {
                      toast.message("Feed already has posts. Use your own content next.");
                    }
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to seed feed");
                  }
                }}
                className="mt-4 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Seed starter feed
              </button>
            ) : null}
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Your feed is quiet right now
            </h3>
            <p className="text-gray-600 max-w-md mx-auto">
              Follow some users or switch to Public to discover new music posts.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">
        {scope === "public" ? "Public Feed" : "Your Music Feed"}
      </h2>
      {posts.map((post) => (
        <PostCard
          key={post._id}
          post={post}
          focusCommentId={post._id === focusPostId ? focusCommentId : null}
          onNavigateToProfile={onNavigateToProfile}
        />
      ))}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isLoadingMore ? "Loading more..." : "Load more posts"}
          </button>
        </div>
      )}

      {hasMore && <div ref={loadMoreRef} className="h-1 w-full" aria-hidden />}
    </div>
  );
}
