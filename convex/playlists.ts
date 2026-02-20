import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

async function requireNonGuestUserId(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (user?.isAnonymous) {
    throw new Error("Create an account to use playlists.");
  }
  return userId as Id<"users">;
}

function generateShareCode() {
  return `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function detectPlatform(url?: string) {
  if (!url) return undefined;
  const value = url.toLowerCase();
  if (value.includes("spotify.com")) return "spotify" as const;
  if (value.includes("music.apple.com")) return "apple_music" as const;
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "youtube" as const;
  return "direct" as const;
}

async function canEditPlaylist(ctx: any, playlistId: Id<"playlists">, userId: Id<"users">) {
  const playlist = await ctx.db.get(playlistId);
  if (!playlist) return { allowed: false as const, playlist: null };
  if (playlist.ownerId === userId) return { allowed: true as const, playlist };
  if (!playlist.isCollaborative) return { allowed: false as const, playlist };

  const collaborator = await ctx.db
    .query("playlistCollaborators")
    .withIndex("by_playlist_user", (q: any) => q.eq("playlistId", playlistId).eq("userId", userId))
    .unique();

  return { allowed: !!collaborator, playlist };
}

async function enrichPlaylist(ctx: any, playlist: any, viewerId: Id<"users"> | null) {
  const ownerUser = await ctx.db.get(playlist.ownerId);
  const ownerProfile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", playlist.ownerId))
    .unique();

  const collaborators = await ctx.db
    .query("playlistCollaborators")
    .withIndex("by_playlist", (q: any) => q.eq("playlistId", playlist._id))
    .collect();

  const collaboratorProfiles = await Promise.all(
    collaborators.map(async (collab: any) => {
      const user = await ctx.db.get(collab.userId);
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q: any) => q.eq("userId", collab.userId))
        .unique();
      return {
        userId: collab.userId,
        role: collab.role,
        displayName: profile?.displayName || user?.name || user?.email || "Anonymous",
      };
    }),
  );

  const isOwner = viewerId === playlist.ownerId;
  const isCollaborator = collaboratorProfiles.some((collab) => collab.userId === viewerId);

  return {
    ...playlist,
    owner: {
      id: playlist.ownerId,
      displayName: ownerProfile?.displayName || ownerUser?.name || ownerUser?.email || "Anonymous",
    },
    collaborators: collaboratorProfiles,
    canEdit: isOwner || isCollaborator,
    canManageCollaborators: isOwner,
  };
}

export const createPlaylist = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    isPublic: v.boolean(),
    isCollaborative: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const trimmedName = args.name.trim();
    if (!trimmedName) throw new Error("Playlist name is required");

    return await ctx.db.insert("playlists", {
      ownerId: userId,
      name: trimmedName,
      description: args.description?.trim() || undefined,
      isPublic: args.isPublic,
      isCollaborative: args.isCollaborative,
      shareCode: generateShareCode(),
      tracksCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const getMyPlaylists = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const owned = await ctx.db
      .query("playlists")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", userId))
      .order("desc")
      .collect();

    const collaborations = await ctx.db
      .query("playlistCollaborators")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const collabPlaylists = await Promise.all(
      collaborations.map((item) => ctx.db.get(item.playlistId)),
    );

    const merged = [...owned, ...collabPlaylists.filter(Boolean)];
    const unique = new Map<string, any>();
    for (const playlist of merged) {
      unique.set(String(playlist!._id), playlist);
    }

    const sorted = Array.from(unique.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return await Promise.all(sorted.map((playlist) => enrichPlaylist(ctx, playlist, userId as Id<"users">)));
  },
});

export const getPublicPlaylists = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const playlists = await ctx.db
      .query("playlists")
      .withIndex("by_public_updated", (q) => q.eq("isPublic", true))
      .order("desc")
      .take(args.limit ?? 20);

    return await Promise.all(
      playlists.map((playlist) => enrichPlaylist(ctx, playlist, (userId as Id<"users">) || null)),
    );
  },
});

export const getPlaylistById = query({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist) return null;

    const enriched = await enrichPlaylist(ctx, playlist, (userId as Id<"users">) || null);
    if (!enriched.isPublic && !enriched.canEdit && userId !== playlist.ownerId) return null;

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
      .order("asc")
      .collect();

    return {
      ...enriched,
      tracks,
    };
  },
});

export const addTrackToPlaylist = mutation({
  args: {
    playlistId: v.id("playlists"),
    sourcePostId: v.optional(v.id("posts")),
    title: v.string(),
    url: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const permission = await canEditPlaylist(ctx, args.playlistId, userId);
    if (!permission.playlist) throw new Error("Playlist not found");
    if (!permission.allowed) throw new Error("You do not have access to edit this playlist");

    const playlist = permission.playlist;
    const currentTracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
      .collect();

    const order = currentTracks.length;
    const trackId = await ctx.db.insert("playlistTracks", {
      playlistId: args.playlistId,
      addedBy: userId,
      sourcePostId: args.sourcePostId,
      title: args.title.trim(),
      url: args.url?.trim() || undefined,
      platform: detectPlatform(args.url),
      notes: args.notes?.trim() || undefined,
      order,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.playlistId, {
      tracksCount: playlist.tracksCount + 1,
      updatedAt: Date.now(),
    });

    return trackId;
  },
});

export const removeTrackFromPlaylist = mutation({
  args: { playlistId: v.id("playlists"), trackId: v.id("playlistTracks") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const permission = await canEditPlaylist(ctx, args.playlistId, userId);
    if (!permission.playlist) throw new Error("Playlist not found");
    if (!permission.allowed) throw new Error("You do not have access to edit this playlist");

    const track = await ctx.db.get(args.trackId);
    if (!track || track.playlistId !== args.playlistId) throw new Error("Track not found");
    await ctx.db.delete(args.trackId);

    const remainingTracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
      .order("asc")
      .collect();

    await Promise.all(
      remainingTracks.map((item, index) => {
        if (item.order === index) return Promise.resolve();
        return ctx.db.patch(item._id, { order: index });
      }),
    );

    await ctx.db.patch(args.playlistId, {
      tracksCount: Math.max(0, permission.playlist.tracksCount - 1),
      updatedAt: Date.now(),
    });
  },
});

export const addCollaborator = mutation({
  args: { playlistId: v.id("playlists"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await requireNonGuestUserId(ctx);
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist) throw new Error("Playlist not found");
    if (playlist.ownerId !== currentUserId) throw new Error("Only owners can add collaborators");
    if (!playlist.isCollaborative) {
      await ctx.db.patch(args.playlistId, { isCollaborative: true, updatedAt: Date.now() });
    }
    if (args.userId === currentUserId) return null;

    const existing = await ctx.db
      .query("playlistCollaborators")
      .withIndex("by_playlist_user", (q) =>
        q.eq("playlistId", args.playlistId).eq("userId", args.userId),
      )
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("playlistCollaborators", {
      playlistId: args.playlistId,
      userId: args.userId,
      role: "editor",
      createdAt: Date.now(),
    });
  },
});

export const removeCollaborator = mutation({
  args: { playlistId: v.id("playlists"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const currentUserId = await requireNonGuestUserId(ctx);
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist) throw new Error("Playlist not found");
    if (playlist.ownerId !== currentUserId) throw new Error("Only owners can remove collaborators");

    const existing = await ctx.db
      .query("playlistCollaborators")
      .withIndex("by_playlist_user", (q) =>
        q.eq("playlistId", args.playlistId).eq("userId", args.userId),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const sharePlaylistAsPost = mutation({
  args: { playlistId: v.id("playlists"), caption: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const playlist = await ctx.db.get(args.playlistId);
    if (!playlist) throw new Error("Playlist not found");

    const canShare =
      playlist.ownerId === userId ||
      playlist.isPublic ||
      !!(await ctx.db
        .query("playlistCollaborators")
        .withIndex("by_playlist_user", (q) => q.eq("playlistId", args.playlistId).eq("userId", userId))
        .unique());
    if (!canShare) throw new Error("You do not have access to share this playlist");

    const tracks = await ctx.db
      .query("playlistTracks")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
      .order("asc")
      .take(5);

    const preview = tracks.map((track, index) => `${index + 1}. ${track.title}`).join("\n");
    const contentBase = `Playlist by ${playlist.ownerId === userId ? "me" : "a creator"}\n${preview}`;
    const content = args.caption?.trim() ? `${args.caption.trim()}\n\n${contentBase}` : contentBase;

    const postId = await ctx.db.insert("posts", {
      authorId: userId,
      type: "playlist",
      title: playlist.name,
      content,
      tags: ["playlist", "shared"],
      likesCount: 0,
      commentsCount: 0,
      repostsCount: 0,
      playCount: 0,
    });

    return postId;
  },
});

export const saveSongFromPost = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");
    if (post.type !== "song") throw new Error("Only song posts can be saved");

    const existing = await ctx.db
      .query("savedSongs")
      .withIndex("by_user_source_post", (q) => q.eq("userId", userId).eq("sourcePostId", args.postId))
      .unique();
    if (existing) return existing._id;

    const primaryUrl = post.spotifyUrl || post.appleMusicUrl || post.youtubeUrl;
    return await ctx.db.insert("savedSongs", {
      userId,
      sourcePostId: args.postId,
      title: post.title,
      artistOrContext: post.content,
      url: primaryUrl,
      platform: detectPlatform(primaryUrl),
      createdAt: Date.now(),
    });
  },
});

export const removeSavedSong = mutation({
  args: { savedSongId: v.id("savedSongs") },
  handler: async (ctx, args) => {
    const userId = await requireNonGuestUserId(ctx);
    const saved = await ctx.db.get(args.savedSongId);
    if (!saved || saved.userId !== userId) throw new Error("Saved song not found");
    await ctx.db.delete(args.savedSongId);
  },
});

export const getSavedSongs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("savedSongs")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const isSongSaved = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const existing = await ctx.db
      .query("savedSongs")
      .withIndex("by_user_source_post", (q) => q.eq("userId", userId).eq("sourcePostId", args.postId))
      .unique();
    return !!existing;
  },
});

export const getWritablePlaylists = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const owned = await ctx.db
      .query("playlists")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", userId))
      .order("desc")
      .collect();

    const collaborations = await ctx.db
      .query("playlistCollaborators")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const collabPlaylists = await Promise.all(collaborations.map((item) => ctx.db.get(item.playlistId)));

    const merged = [...owned, ...collabPlaylists.filter(Boolean)];
    const unique = new Map<string, any>();
    for (const playlist of merged) {
      unique.set(String(playlist!._id), playlist);
    }
    return Array.from(unique.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((playlist) => ({
        _id: playlist._id,
        name: playlist.name,
      }));
  },
});
