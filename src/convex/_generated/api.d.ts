/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as announcements from "../announcements.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as bots from "../bots.js";
import type * as browser from "../browser.js";
import type * as chatCore from "../chatCore.js";
import type * as conversations from "../conversations.js";
import type * as email from "../email.js";
import type * as files from "../files.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as lib_keys from "../lib/keys.js";
import type * as plugins from "../plugins.js";
import type * as projects from "../projects.js";
import type * as search from "../search.js";
import type * as settings from "../settings.js";
import type * as updates from "../updates.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  announcements: typeof announcements;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  bots: typeof bots;
  browser: typeof browser;
  chatCore: typeof chatCore;
  conversations: typeof conversations;
  email: typeof email;
  files: typeof files;
  github: typeof github;
  http: typeof http;
  "lib/keys": typeof lib_keys;
  plugins: typeof plugins;
  projects: typeof projects;
  search: typeof search;
  settings: typeof settings;
  updates: typeof updates;
  users: typeof users;
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
