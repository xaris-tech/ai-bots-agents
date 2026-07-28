// Firebase client init + the email allowlist (UX-side). The REAL security gate
// is the FastAPI backend (app/auth.py) verifying the ID token — this file only
// controls what the browser shows and which token it sends.
//
// Configure via frontend/.env.local (NEXT_PUBLIC_* are exposed to the browser):
//   NEXT_PUBLIC_FIREBASE_API_KEY
//   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID
//   NEXT_PUBLIC_FIREBASE_APP_ID
//   NEXT_PUBLIC_ALLOWED_EMAILS   (optional; defaults to the two operators)
// When the config is absent, auth is disabled so local dev still runs.

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

const app: FirebaseApp | null = firebaseEnabled
  ? getApps()[0] ?? initializeApp(config)
  : null;

export const auth: Auth | null = app ? getAuth(app) : null;

export const ALLOWED_EMAILS = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAILS ??
  "ranjovidad@gmail.com,info@cortexconstruction.com"
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function isAllowed(email: string | null | undefined): boolean {
  return Boolean(email && ALLOWED_EMAILS.includes(email.toLowerCase()));
}

// Used by the module-level api() fetch helper to attach the bearer token.
export async function getIdToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch {
    return null;
  }
}
