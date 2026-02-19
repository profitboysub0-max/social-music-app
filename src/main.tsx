import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { PlayerProvider } from "./context/PlayerProvider";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;

const hasValidConvexUrl =
  !!convexUrl &&
  (convexUrl.startsWith("http://") || convexUrl.startsWith("https://"));

const convexClient = hasValidConvexUrl ? new ConvexReactClient(convexUrl) : null;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {!hasValidConvexUrl ? (
      <div style={{ padding: "24px", fontFamily: "sans-serif" }}>
        <h1>Missing Convex URL</h1>
        <p>
          Set <code>VITE_CONVEX_URL</code> in <code>.env.local</code> (or run
          <code> npx convex dev</code>) and restart the dev server.
        </p>
      </div>
    ) : (
      <ConvexAuthProvider client={convexClient!}>
        <PlayerProvider>
          <App />
        </PlayerProvider>
      </ConvexAuthProvider>
    )}
  </React.StrictMode>
);
