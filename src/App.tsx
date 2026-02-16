import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { SignInForm } from "./SignInForm";
import { SignOutButton } from "./SignOutButton";
import { Toaster } from "sonner";
import { MusicFeed } from "./components/MusicFeed";
import { CreatePost } from "./components/CreatePost";
import { UserProfile } from "./components/UserProfile";
import { SearchUsers } from "./components/SearchUsers";
import { useState } from "react";

export default function App() {
  const [activeTab, setActiveTab] = useState<"feed" | "profile" | "search">("feed");
  
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-16 flex justify-between items-center">
          <h2 className="text-xl font-bold text-blue-600">🎵 SocialBeats Developed by Profit Boy</h2>
          <Authenticated>
            <div className="flex items-center gap-4">
              <nav className="flex gap-2">
                <button
                  onClick={() => setActiveTab("feed")}
                  className={`px-3 py-2 rounded-lg font-medium transition-colors ${
                    activeTab === "feed" 
                      ? "bg-blue-100 text-blue-700" 
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Feed
                </button>
                <button
                  onClick={() => setActiveTab("search")}
                  className={`px-3 py-2 rounded-lg font-medium transition-colors ${
                    activeTab === "search" 
                      ? "bg-blue-100 text-blue-700" 
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Discover
                </button>
                <button
                  onClick={() => setActiveTab("profile")}
                  className={`px-3 py-2 rounded-lg font-medium transition-colors ${
                    activeTab === "profile" 
                      ? "bg-blue-100 text-blue-700" 
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Profile
                </button>
              </nav>
              <SignOutButton />
            </div>
          </Authenticated>
          <Unauthenticated>
            <div className="text-sm text-gray-600">Sign in to share music</div>
          </Unauthenticated>
        </div>
      </header>
      
      <main className="flex-1 max-w-4xl mx-auto w-full p-4">
        <Content activeTab={activeTab} />
      </main>
      <Toaster />
    </div>
  );
}

function Content({ activeTab }: { activeTab: "feed" | "profile" | "search" }) {
  const loggedInUser = useQuery(api.auth.loggedInUser);

  if (loggedInUser === undefined) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Unauthenticated>
        <div className="text-center py-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            🎵 Welcome to SocialBeats
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Share your favorite music and discover new sounds with friends
          </p>
          <SignInForm />
        </div>
      </Unauthenticated>

      <Authenticated>
        {activeTab === "feed" && (
          <div className="space-y-6">
            <CreatePost />
            <MusicFeed />
          </div>
        )}
        
        {activeTab === "search" && <SearchUsers />}
        
        {activeTab === "profile" && <UserProfile />}
      </Authenticated>
    </div>
  );
}
