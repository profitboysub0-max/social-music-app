import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { toast } from "sonner";

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(timestamp: number) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / (1000 * 60));
  const hrs = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

export function DirectMessages() {
  const [selectedConversationId, setSelectedConversationId] = useState<Id<"conversations"> | null>(
    null,
  );
  const [selectedRecipientId, setSelectedRecipientId] = useState<Id<"users"> | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const conversations = useQuery(api.messages.getConversations);
  const searchUsers = useQuery(api.messages.searchUsersForMessages, { searchTerm });
  const messages = useQuery(
    api.messages.getConversationMessages,
    selectedConversationId ? { conversationId: selectedConversationId, limit: 100 } : "skip",
  );

  const sendMessage = useMutation(api.messages.sendMessage);
  const markConversationAsRead = useMutation(api.messages.markConversationAsRead);

  useEffect(() => {
    if (!selectedConversationId) return;
    void markConversationAsRead({ conversationId: selectedConversationId });
  }, [markConversationAsRead, selectedConversationId]);

  useEffect(() => {
    if (!conversations || conversations.length === 0) return;
    if (!selectedConversationId) {
      setSelectedConversationId(conversations[0]._id);
      setSelectedRecipientId(conversations[0].otherUser.id);
    }
  }, [conversations, selectedConversationId]);

  const selectedConversation = useMemo(
    () => conversations?.find((conversation) => conversation._id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );

  const handleStartConversation = (userId: Id<"users">) => {
    setSelectedRecipientId(userId);
    const existingConversation = conversations?.find(
      (conversation) => conversation.otherUser.id === userId,
    );
    if (existingConversation) {
      setSelectedConversationId(existingConversation._id);
    } else {
      setSelectedConversationId(null);
    }
    setSearchTerm("");
  };

  const handleSelectConversation = (conversationId: Id<"conversations">, recipientId: Id<"users">) => {
    setSelectedConversationId(conversationId);
    setSelectedRecipientId(recipientId);
  };

  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = messageText.trim();
    if (!trimmed) return;
    if (!selectedRecipientId) {
      toast.error("Select a user to message.");
      return;
    }

    try {
      setIsSending(true);
      const result = await sendMessage({
        recipientId: selectedRecipientId,
        content: trimmed,
      });
      setSelectedConversationId(result.conversationId);
      setMessageText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] gap-4">
      <aside className="bg-white rounded-lg shadow-sm border p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Direct Messages</h2>
          <p className="text-sm text-gray-600">Start a chat or open a conversation.</p>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search users..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          {searchTerm.trim() && (
            <div className="border rounded-lg divide-y max-h-52 overflow-y-auto">
              {!searchUsers ? (
                <div className="p-3 text-sm text-gray-500">Searching...</div>
              ) : searchUsers.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">No users found.</div>
              ) : (
                searchUsers.map((user) => (
                  <button
                    type="button"
                    key={user.userId}
                    onClick={() => handleStartConversation(user.userId)}
                    className="w-full text-left p-3 hover:bg-gray-50 flex items-center gap-2"
                  >
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.displayName}
                        className="h-8 w-8 rounded-full object-cover border border-gray-200"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                        {user.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm font-medium text-gray-900">{user.displayName}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Conversations</h3>
          <div className="border rounded-lg divide-y max-h-[420px] overflow-y-auto">
            {!conversations ? (
              <div className="p-3 text-sm text-gray-500">Loading conversations...</div>
            ) : conversations.length === 0 ? (
              <div className="p-3 text-sm text-gray-500">No conversations yet.</div>
            ) : (
              conversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation._id}
                  onClick={() => handleSelectConversation(conversation._id, conversation.otherUser.id)}
                  className={`w-full text-left p-3 hover:bg-gray-50 ${
                    selectedConversationId === conversation._id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {conversation.otherUser.avatarUrl ? (
                      <img
                        src={conversation.otherUser.avatarUrl}
                        alt={conversation.otherUser.displayName}
                        className="h-8 w-8 rounded-full object-cover border border-gray-200"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                        {conversation.otherUser.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {conversation.otherUser.displayName}
                        </p>
                        <span className="text-xs text-gray-500">
                          {formatRelative(conversation.lastMessageAt)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 truncate">{conversation.lastMessagePreview}</p>
                      {conversation.unreadCount > 0 ? (
                        <span className="inline-flex mt-1 items-center justify-center min-w-5 h-5 px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold">
                          {conversation.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <section className="bg-white rounded-lg shadow-sm border p-4 flex flex-col min-h-[640px]">
        <div className="border-b pb-3 mb-3">
          <h3 className="font-semibold text-gray-900">
            {selectedConversation?.otherUser.displayName || "New message"}
          </h3>
          <p className="text-sm text-gray-500">
            {selectedConversation ? "Conversation updates in real time." : "Select a user and send a message."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {!selectedConversationId ? (
            <div className="text-sm text-gray-500">
              {selectedRecipientId ? "Send the first message to start this conversation." : "No conversation selected."}
            </div>
          ) : !messages ? (
            <div className="text-sm text-gray-500">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-gray-500">No messages yet.</div>
          ) : (
            messages.map((message) => (
              <div
                key={message._id}
                className={`flex ${message.isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                    message.isMine ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
                  }`}
                >
                  {!message.isMine ? (
                    <div className="text-[11px] font-semibold mb-0.5">{message.sender.displayName}</div>
                  ) : null}
                  <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                  <div
                    className={`text-[10px] mt-1 ${
                      message.isMine ? "text-blue-100" : "text-gray-500"
                    }`}
                  >
                    {formatTime(message._creationTime)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSendMessage} className="mt-3 pt-3 border-t flex gap-2">
          <input
            type="text"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder={
              selectedRecipientId
                ? "Write a message..."
                : "Select a user from search or conversations"
            }
            disabled={!selectedRecipientId || isSending}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-500"
          />
          <button
            type="submit"
            disabled={!selectedRecipientId || !messageText.trim() || isSending}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </form>
      </section>
    </div>
  );
}
