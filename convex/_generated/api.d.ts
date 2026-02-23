/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as files from "../files.js";
import type * as functions_files from "../functions/files.js";
import type * as growth from "../growth.js";
import type * as http from "../http.js";
import type * as messages from "../messages.js";
import type * as monetization from "../monetization.js";
import type * as notifications from "../notifications.js";
import type * as player from "../player.js";
import type * as playlists from "../playlists.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as push from "../push.js";
import type * as router from "../router.js";
import type * as social from "../social.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  files: typeof files;
  "functions/files": typeof functions_files;
  growth: typeof growth;
  http: typeof http;
  messages: typeof messages;
  monetization: typeof monetization;
  notifications: typeof notifications;
  player: typeof player;
  playlists: typeof playlists;
  posts: typeof posts;
  profiles: typeof profiles;
  push: typeof push;
  router: typeof router;
  social: typeof social;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
