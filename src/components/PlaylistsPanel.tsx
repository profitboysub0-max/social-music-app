import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { toast } from "sonner";

export function PlaylistsPanel() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [isCollaborative, setIsCollaborative] = useState(true);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<Id<"playlists"> | null>(null);
  const [trackTitle, setTrackTitle] = useState("");
  const [trackUrl, setTrackUrl] = useState("");
  const [collabSearch, setCollabSearch] = useState("");

  const myPlaylists = useQuery(api.playlists.getMyPlaylists);
  const playlistDetail = useQuery(
    api.playlists.getPlaylistById,
    selectedPlaylistId ? { playlistId: selectedPlaylistId } : "skip",
  );
  const savedSongs = useQuery(api.playlists.getSavedSongs);
  const userSearch = useQuery(
    api.messages.searchUsersForMessages,
    collabSearch.trim() ? { searchTerm: collabSearch.trim() } : { searchTerm: "" },
  );

  const createPlaylist = useMutation(api.playlists.createPlaylist);
  const addTrackToPlaylist = useMutation(api.playlists.addTrackToPlaylist);
  const removeTrackFromPlaylist = useMutation(api.playlists.removeTrackFromPlaylist);
  const addCollaborator = useMutation(api.playlists.addCollaborator);
  const removeCollaborator = useMutation(api.playlists.removeCollaborator);
  const sharePlaylistAsPost = useMutation(api.playlists.sharePlaylistAsPost);
  const removeSavedSong = useMutation(api.playlists.removeSavedSong);

  const collaboratorIds = useMemo(
    () => new Set((playlistDetail?.collaborators ?? []).map((collab) => String(collab.userId))),
    [playlistDetail],
  );

  const handleCreatePlaylist = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Playlist name is required.");
      return;
    }
    try {
      const id = await createPlaylist({
        name: name.trim(),
        description: description.trim() || undefined,
        isPublic,
        isCollaborative,
      });
      setName("");
      setDescription("");
      setSelectedPlaylistId(id);
      toast.success("Playlist created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create playlist");
    }
  };

  const handleAddTrack = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlaylistId) return;
    if (!trackTitle.trim()) {
      toast.error("Track title is required.");
      return;
    }
    try {
      await addTrackToPlaylist({
        playlistId: selectedPlaylistId,
        title: trackTitle.trim(),
        url: trackUrl.trim() || undefined,
      });
      setTrackTitle("");
      setTrackUrl("");
      toast.success("Track added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add track");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-semibold text-gray-900">Create Playlist</h2>
        <p className="text-sm text-gray-600 mt-1">
          Build personal or collaborative playlists and share them to your feed.
        </p>
        <form onSubmit={handleCreatePlaylist} className="mt-4 space-y-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Playlist name"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg resize-none"
          />
          <div className="flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
              />
              Public
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={isCollaborative}
                onChange={(event) => setIsCollaborative(event.target.checked)}
              />
              Collaborative
            </label>
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Create
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border p-4 space-y-3">
          <h3 className="font-semibold text-gray-900">Your Playlists</h3>
          {!myPlaylists ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : myPlaylists.length === 0 ? (
            <div className="text-sm text-gray-500">No playlists yet.</div>
          ) : (
            myPlaylists.map((playlist) => (
              <button
                key={playlist._id}
                type="button"
                onClick={() => setSelectedPlaylistId(playlist._id)}
                className={`w-full text-left rounded-lg border px-3 py-2 ${
                  selectedPlaylistId === playlist._id
                    ? "border-blue-400 bg-blue-50"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="font-medium text-sm text-gray-900">{playlist.name}</div>
                <div className="text-xs text-gray-500">
                  {playlist.tracksCount} tracks • {playlist.isCollaborative ? "Collab" : "Private edits"}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border p-4 space-y-4">
          {!playlistDetail ? (
            <div className="text-sm text-gray-500">Select a playlist to manage tracks.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{playlistDetail.name}</h3>
                  <p className="text-sm text-gray-600">
                    {playlistDetail.description || "No description yet."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await sharePlaylistAsPost({ playlistId: playlistDetail._id });
                      toast.success("Playlist shared to feed.");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to share playlist");
                    }
                  }}
                  className="px-3 py-2 rounded-lg border border-blue-200 text-blue-700 text-sm hover:bg-blue-50"
                >
                  Share playlist
                </button>
              </div>

              {playlistDetail.canEdit ? (
                <form onSubmit={handleAddTrack} className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    value={trackTitle}
                    onChange={(event) => setTrackTitle(event.target.value)}
                    placeholder="Track title"
                    className="px-3 py-2 border border-gray-200 rounded-lg"
                  />
                  <input
                    value={trackUrl}
                    onChange={(event) => setTrackUrl(event.target.value)}
                    placeholder="Track URL (optional)"
                    className="px-3 py-2 border border-gray-200 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
                  >
                    Add track
                  </button>
                </form>
              ) : null}

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">Tracks</h4>
                {playlistDetail.tracks.length === 0 ? (
                  <div className="text-sm text-gray-500">No tracks yet.</div>
                ) : (
                  playlistDetail.tracks.map((track) => (
                    <div
                      key={track._id}
                      className="rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">{track.title}</div>
                        {track.url ? (
                          <a
                            href={track.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline break-all"
                          >
                            {track.url}
                          </a>
                        ) : (
                          <div className="text-xs text-gray-500">No URL</div>
                        )}
                      </div>
                      {playlistDetail.canEdit ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await removeTrackFromPlaylist({
                                playlistId: playlistDetail._id,
                                trackId: track._id,
                              });
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to remove track");
                            }
                          }}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              {playlistDetail.canManageCollaborators ? (
                <div className="space-y-2 border-t pt-3">
                  <h4 className="text-sm font-semibold text-gray-900">Collaborators</h4>
                  <input
                    value={collabSearch}
                    onChange={(event) => setCollabSearch(event.target.value)}
                    placeholder="Search users to add"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  />
                  <div className="space-y-2">
                    {(userSearch ?? [])
                      .filter((user) => !collaboratorIds.has(String(user.userId)))
                      .slice(0, 5)
                      .map((user) => (
                        <div key={user.userId} className="flex items-center justify-between rounded border px-3 py-2">
                          <span className="text-sm text-gray-900">{user.displayName}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await addCollaborator({
                                  playlistId: playlistDetail._id,
                                  userId: user.userId,
                                });
                                toast.success("Collaborator added.");
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : "Failed to add collaborator");
                              }
                            }}
                            className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                  </div>
                  <div className="space-y-2">
                    {(playlistDetail.collaborators ?? []).map((collab) => (
                      <div key={collab.userId} className="flex items-center justify-between rounded border px-3 py-2">
                        <span className="text-sm text-gray-900">{collab.displayName}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await removeCollaborator({
                                playlistId: playlistDetail._id,
                                userId: collab.userId,
                              });
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Failed to remove collaborator");
                            }
                          }}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900">Saved Songs</h3>
        {!savedSongs ? (
          <div className="text-sm text-gray-500 mt-2">Loading...</div>
        ) : savedSongs.length === 0 ? (
          <div className="text-sm text-gray-500 mt-2">No saved songs yet. Save from the feed.</div>
        ) : (
          <div className="mt-3 space-y-2">
            {savedSongs.map((song) => (
              <div
                key={song._id}
                className="rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{song.title}</div>
                  {song.artistOrContext ? (
                    <div className="text-xs text-gray-600 truncate">{song.artistOrContext}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {song.url ? (
                    <a
                      href={song.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                    >
                      Open
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await removeSavedSong({ savedSongId: song._id });
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Failed to remove saved song");
                      }
                    }}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
