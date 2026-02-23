import React, { useEffect, useState } from "react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { Toaster } from "sonner";

import { UserProfile } from "./components/UserProfile";
import { CreatePost } from "./components/CreatePost";
import { MusicFeed } from "./components/MusicFeed";
import { SearchUsers } from "./components/SearchUsers";
import { SignInForm } from "./components/SignInForm";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { SignOutButton } from "./SignOutButton";
import { DirectMessages } from "./components/DirectMessages";
import { PlaylistsPanel } from "./components/PlaylistsPanel";
import { InvestorDashboard } from "./components/InvestorDashboard";

const AUTHORIZED_INVESTOR_EMAILS = new Set(["profitboysub0@gmail.com"]);

export default function App() {
  const convex = useConvex();
  const [activeTab, setActiveTab] = useState<
    | "home"
    | "public"
    | "feed"
    | "profile"
    | "search"
    | "notifications"
    | "messages"
    | "playlists"
    | "investor"
  >("home");
  const [focusedPostId, setFocusedPostId] = useState<Id<"posts"> | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<Id<"comments"> | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<Id<"users"> | null>(null);
  const [isNightMode, setIsNightMode] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseNight = savedTheme ? savedTheme === "night" : prefersDark;
    setIsNightMode(shouldUseNight);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("night", isNightMode);
    window.localStorage.setItem("theme", isNightMode ? "night" : "day");
  }, [isNightMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const postId = params.get("postId");
    const commentId = params.get("commentId");
    const userId = params.get("userId");

    if (
      tab === "notifications" ||
      tab === "feed" ||
      tab === "search" ||
      tab === "playlists" ||
      tab === "investor"
    ) {
      setActiveTab(tab);
    }
    if (postId) {
      setFocusedPostId(postId as Id<"posts">);
    }
    if (commentId) {
      setFocusedCommentId(commentId as Id<"comments">);
    }
    if (userId) {
      setSelectedUserId(userId as Id<"users">);
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      const pathMatch = window.location.pathname.match(/^\/r\/([a-z0-9]+)$/i);
      if (!pathMatch) return;
      const code = pathMatch[1];
      try {
        const ref = await convex.query(api.posts.resolveShareReference, { code });
        if (!ref?.postId) return;
        setFocusedPostId(ref.postId);
        setFocusedCommentId(null);
        setActiveTab("feed");
        const url = new URL(window.location.href);
        url.pathname = "/";
        url.searchParams.set("tab", "feed");
        url.searchParams.set("postId", String(ref.postId));
        window.history.replaceState({}, "", url.toString());
      } catch {
        // Ignore invalid share code lookups.
      }
    };
    void run();
  }, [convex]);

  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureSeedWarmWelcome = useMutation(api.growth.ensureSeedWarmWelcome);
  const currentUser = useQuery(api.auth.loggedInUser);
  const unreadNotificationsCount = useQuery(api.social.getUnreadNotificationCount);
  const unreadMessagesCount = useQuery(api.messages.getUnreadMessageCount);
  const isSignedIn = isAuthenticated || !!currentUser;
  const isGuest = !!(currentUser as { isAnonymous?: boolean } | null)?.isAnonymous;
  const normalizedEmail = String((currentUser as { email?: string } | null)?.email || "")
    .trim()
    .toLowerCase();
  const canViewInvestorDashboard = AUTHORIZED_INVESTOR_EMAILS.has(normalizedEmail);
  const showNav = isSignedIn;
  const notificationsCount = unreadNotificationsCount ?? 0;
  const messagesCount = unreadMessagesCount ?? 0;

  useEffect(() => {
    if (!currentUser || (currentUser as { isAnonymous?: boolean }).isAnonymous) return;
    void ensureSeedWarmWelcome({}).catch(() => undefined);
  }, [currentUser, ensureSeedWarmWelcome]);

  const handleNavigateToPost = (postId: Id<"posts">, commentId?: Id<"comments"> | null) => {
    setFocusedPostId(postId);
    setFocusedCommentId(commentId ?? null);
    setActiveTab("feed");
  };

  const handleNavigateToProfile = (userId: Id<"users">) => {
    setSelectedUserId(userId);
    setActiveTab("search");
  };

  const clearFocus = () => {
    setFocusedPostId(null);
    setFocusedCommentId(null);
  };

  const renderMainContent = () => {
    if (activeTab === "home") {
      return (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border p-8">
            <h1 className="text-2xl font-bold text-gray-900">Home</h1>
            <p className="text-gray-600 mt-1">
              Jump into your feed, discover new creators, and post what you are listening to.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab("feed")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Share a song now
              </button>
              <button
                onClick={() => setActiveTab("profile")}
                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Edit profile
              </button>
            </div>
          </div>
          <CreatePost />
          <MusicFeed scope="public" onNavigateToProfile={handleNavigateToProfile} />
        </div>
      );
    }

    if (activeTab === "public") {
      return <MusicFeed scope="public" onNavigateToProfile={handleNavigateToProfile} />;
    }

    if (activeTab === "feed") {
      return (
        <>
          <CreatePost />
          <MusicFeed
            scope="personal"
            focusPostId={focusedPostId}
            focusCommentId={focusedCommentId}
            onFocusHandled={clearFocus}
            onNavigateToProfile={handleNavigateToProfile}
          />
        </>
      );
    }

    if (activeTab === "search") {
      return <SearchUsers initialSelectedUserId={selectedUserId} />;
    }

    if (activeTab === "notifications") {
      return (
        <NotificationsPanel
          onNavigateToPost={handleNavigateToPost}
          onNavigateToProfile={handleNavigateToProfile}
        />
      );
    }

    if (activeTab === "messages") {
      if (isGuest) {
        return (
          <div className="bg-white rounded-lg shadow-sm border p-6 text-center">
            <h2 className="text-xl font-semibold text-gray-900">Messages are for members</h2>
            <p className="text-gray-600 mt-2">
              Create an account to start direct messages with other users.
            </p>
          </div>
        );
      }
      return <DirectMessages />;
    }

    if (activeTab === "playlists") {
      return <PlaylistsPanel />;
    }

    if (activeTab === "investor") {
      if (!canViewInvestorDashboard) {
        return (
          <div className="bg-white rounded-lg shadow-sm border p-6 text-center">
            <h2 className="text-xl font-semibold text-gray-900">Investor dashboard is restricted</h2>
            <p className="text-gray-600 mt-2">
              Sign in with your authorized Profit account to view investor metrics.
            </p>
          </div>
        );
      }
      return <InvestorDashboard />;
    }

    return <UserProfile />;
  };

  return (
    <div className="app-shell flex flex-col min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-5 py-4 md:h-20 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <div className="flex items-center justify-between gap-3">
            <div className="logo-lockup leading-tight min-w-0">
              <h2 className="text-xl font-bold text-blue-600 tracking-tight">Put Me On</h2>
              <p className="text-xs text-gray-500">Developed by Profit Boy</p>
            </div>
            <button
              type="button"
              onClick={() => setIsNightMode((current) => !current)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 transition-colors"
            >
              {isNightMode ? "Day mode" : "Night mode"}
            </button>
          </div>

          {showNav && (
            <div className="flex items-center gap-3 min-w-0">
              <nav className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1 md:pb-0">
                <button
                  onClick={() => setActiveTab("home")}
                  className={`px-3 py-2 rounded-lg ${
                    activeTab === "home"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Home
                </button>
                <button
                  onClick={() => setActiveTab("public")}
                  className={`px-3 py-2 rounded-lg ${
                    activeTab === "public"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Public
                </button>
                <button
                  onClick={() => setActiveTab("feed")}
                  className={`px-3 py-2 rounded-lg ${
                    activeTab === "feed"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Feed
                </button>
                <button
                  onClick={() => setActiveTab("search")}
                  className={`px-3 py-2 rounded-lg ${
                    activeTab === "search"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Discover
                </button>
                <button
                  onClick={() => setActiveTab("playlists")}
                  className={`px-3 py-2 rounded-lg ${
                    activeTab === "playlists"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Playlists
                </button>
                {canViewInvestorDashboard ? (
                  <button
                    onClick={() => setActiveTab("investor")}
                    className={`px-3 py-2 rounded-lg ${
                      activeTab === "investor"
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Investor
                  </button>
                ) : null}
                <button
                  onClick={() => setActiveTab("profile")}
                  className={`px-3 py-2 rounded-lg ${
                    activeTab === "profile"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Profile
                </button>
                <button
                  onClick={() => setActiveTab("notifications")}
                  className={`px-3 py-2 rounded-lg flex items-center gap-1 ${
                    activeTab === "notifications"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <span>🔔</span>
                  <span>Notifications</span>
                  {notificationsCount > 0 ? (
                    <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-xs font-semibold">
                      {notificationsCount}
                    </span>
                  ) : null}
                </button>
                <button
                  onClick={() => setActiveTab("messages")}
                  className={`px-3 py-2 rounded-lg flex items-center gap-1 ${
                    activeTab === "messages"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <span>💬</span>
                  <span>Messages</span>
                  {messagesCount > 0 ? (
                    <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                      {messagesCount}
                    </span>
                  ) : null}
                </button>
              </nav>
              <div className="shrink-0">
                <SignOutButton />
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-5 py-8 pb-28 md:py-10 md:pb-32 space-y-6">
        {isSignedIn ? (
          renderMainContent()
        ) : (
          <div className="text-center py-8 md:py-14 space-y-5">
            <div className="entrance-logo text-5xl md:text-6xl">🎵</div>
            <h1 className="entrance-text text-4xl font-bold">Put Me On</h1>
            <p className="entrance-text text-lg text-gray-700 mb-1 max-w-2xl mx-auto">
              A social music app where you share tracks, discover new sounds, see what friends are listening to in real time and make money.
            </p>
            <div className="entrance-text max-w-2xl mx-auto text-left sm:text-center">
              <div className="inline-flex flex-col gap-2 text-sm text-gray-600">
                <span>✅ Share songs and playlists in one tap</span>
                <span>✅ Follow creators and get live listening updates</span>
                <span>✅ Save tracks and build collaborative playlists</span>
              </div>
            </div>
            <div className="text-sm text-blue-700 font-medium">
              Sign up takes under 30 seconds.
            </div>
            {isLoading ? <p className="text-sm text-gray-500 mb-3">Connecting to auth...</p> : null}
            <div className="entrance-button">
              <SignInForm />
            </div>
          </div>
        )}
      </main>

      <Toaster />
    </div>
  );
}
