"use client";

// Passwordless (email-link) sign-in gate. Wraps the dashboard: only a
// signed-in, allowlisted user sees it. This is UX enforcement — the backend
// independently verifies every request, so a tampered client still can't read
// or write data.

import { useCallback, useEffect, useState } from "react";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type User,
} from "firebase/auth";
import { LoaderCircle, LogOut, MailCheck, ShieldAlert } from "lucide-react";
import { auth, firebaseEnabled, isAllowed } from "./firebase";

const STORAGE_KEY = "cortex.emailForSignIn";

export function signOutUser() {
  if (auth) void signOut(auth);
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Only show the "checking session" state when Firebase is actually configured.
  const [checking, setChecking] = useState(firebaseEnabled);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Complete an email-link sign-in if the page was opened from the link.
  useEffect(() => {
    if (!auth) return;
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const stored = window.localStorage.getItem(STORAGE_KEY) || window.prompt("Confirm your email to finish signing in") || "";
      signInWithEmailLink(auth, stored, window.location.href)
        .then(() => {
          window.localStorage.removeItem(STORAGE_KEY);
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(() => setError("That sign-in link is invalid or expired. Request a new one."));
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);
    });
    return () => unsub();
  }, []);

  const sendLink = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError("");
      const target = email.trim().toLowerCase();
      if (!isAllowed(target)) {
        setError("This email is not authorized for this application.");
        return;
      }
      if (!auth) return;
      setBusy(true);
      try {
        await sendSignInLinkToEmail(auth, target, {
          url: window.location.origin,
          handleCodeInApp: true,
        });
        window.localStorage.setItem(STORAGE_KEY, target);
        setSent(true);
      } catch {
        setError("Could not send the sign-in link. Check the Firebase config and try again.");
      } finally {
        setBusy(false);
      }
    },
    [email],
  );

  // Auth disabled (no Firebase config) — let local dev through untouched.
  if (!firebaseEnabled) return <>{children}</>;

  if (checking) {
    return (
      <div className="auth-screen">
        <LoaderCircle className="spin" size={22} /> Checking session…
      </div>
    );
  }

  // Signed in but not on the allowlist — refuse and offer sign-out.
  if (user && !isAllowed(user.email)) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <ShieldAlert size={28} />
          <h1>Access denied</h1>
          <p>{user.email} is not authorized to use this application.</p>
          <button className="primary-button" onClick={signOutUser}><LogOut size={16} /> Sign out</button>
        </div>
      </div>
    );
  }

  if (user) return <>{children}</>;

  // Not signed in — passwordless email-link form.
  return (
    <div className="auth-screen">
      <div className="auth-card">
        {sent ? (
          <>
            <MailCheck size={28} />
            <h1>Check your email</h1>
            <p>A sign-in link was sent to <b>{email.trim().toLowerCase()}</b>. Open it on this device to continue.</p>
            <button className="secondary-button" onClick={() => setSent(false)}>Use a different email</button>
          </>
        ) : (
          <>
            <h1>Cortex Bid Desk</h1>
            <p>Sign in with your authorized email — no password needed.</p>
            <form onSubmit={sendLink} className="auth-form">
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <MailCheck size={16} />} Send sign-in link
              </button>
            </form>
            {error && <p className="auth-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
