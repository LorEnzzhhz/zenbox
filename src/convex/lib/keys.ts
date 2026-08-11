// Server-side key handling.
//
// User API keys are stored in the `settings` table and are NEVER returned to
// clients — queries only expose a masked preview. They are persisted as-is
// (Convex encrypts data at rest); if you want additional at-rest encryption,
// set ZENBOX_API_KEY_SECRET and move sealing to a "use node" file using
// node:crypto (AES-256-GCM). Keep the sealing call sites in one place here.
//
// NOTE: this module deliberately avoids Node-only imports so it bundles in
// the default Convex runtime on every deployment.

export function seal(plain: string): string {
  return plain;
}

export function unseal(stored: string | null): string | null {
  return stored;
}
