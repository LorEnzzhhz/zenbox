// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";

// Email + password login ("Gmail with password"). Passwords are hashed
// with Scrypt; the account lives in the standard authTables.
export const passwordAuth = Password({
  profile(params) {
    return {
      email: params.email as string,
      name: (params.name as string) || (params.email as string),
    };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp, passwordAuth, Anonymous],
});