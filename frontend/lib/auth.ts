/**
 * Sign-in against Cognito, straight from the browser (README section 6).
 *
 * - Email + password use Cognito's public API (InitiateAuth / SignUp /
 *   ConfirmSignUp): no secret is involved, the app client has none.
 * - Google goes through the pool's hosted domain with the OAuth code flow +
 *   PKCE, landing back on /auth/callback.
 *
 * Tokens live in localStorage. The ID token is what the API accepts; it is
 * renewed from the refresh token a minute before it expires.
 */

import { useSyncExternalStore } from "react";

const REGION = process.env.NEXT_PUBLIC_COGNITO_REGION || "us-east-1";
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "";
const DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "";

/** False until make deploy-cognito has been run and the ids compiled in. */
export const authConfigured = CLIENT_ID !== "";
export const googleEnabled =
  authConfigured &&
  DOMAIN !== "" &&
  process.env.NEXT_PUBLIC_COGNITO_GOOGLE_ENABLED === "true";

const STORAGE_KEY = "peach.auth";
const PKCE_KEY = "peach.pkce";
const RENEW_BEFORE_MS = 60_000;

type StoredTokens = {
  idToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

export type Session = {
  sub: string;
  email: string;
  name: string;
};

export class AuthError extends Error {
  constructor(
    /** Cognito's exception name, e.g. "NotAuthorizedException". */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/* --- storage + change notification --------------------------------------- */

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function readTokens(): StoredTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function writeTokens(tokens: StoredTokens | null) {
  try {
    if (tokens) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage blocked (private mode): the session lasts as long as the page.
  }
  notify();
}

function decodeClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    Array.from(
      atob(base64),
      (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join(""),
  );
  return JSON.parse(json) as Record<string, unknown>;
}

function store(result: {
  idToken: string;
  refreshToken?: string;
  expiresIn: number;
}) {
  const previous = readTokens();
  writeTokens({
    idToken: result.idToken,
    // A refresh response carries no new refresh token; keep the old one.
    refreshToken: result.refreshToken ?? previous?.refreshToken,
    expiresAt: Date.now() + result.expiresIn * 1000,
  });
}

/* --- Cognito's public API ------------------------------------------------ */

type AuthenticationResult = {
  IdToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
};

async function cognito<T>(action: string, body: object): Promise<T> {
  if (!authConfigured) {
    throw new AuthError("NotConfigured", "Sign-in is not configured yet.");
  }
  let response: Response;
  try {
    response = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("NetworkError", "Could not reach the sign-in service.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(data.__type ?? "UnknownError")
      .split("#")
      .pop()!;
    throw new AuthError(code, data.message ?? "Sign-in failed.");
  }
  return data as T;
}

export async function signIn(email: string, password: string) {
  const data = await cognito<{
    AuthenticationResult?: AuthenticationResult;
    ChallengeName?: string;
  }>("InitiateAuth", {
    ClientId: CLIENT_ID,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (!data.AuthenticationResult) {
    throw new AuthError(
      data.ChallengeName ?? "ChallengeRequired",
      "This account needs a step this app does not support yet.",
    );
  }
  store({
    idToken: data.AuthenticationResult.IdToken,
    refreshToken: data.AuthenticationResult.RefreshToken,
    expiresIn: data.AuthenticationResult.ExpiresIn,
  });
}

export async function signUp(name: string, email: string, password: string) {
  await cognito("SignUp", {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "name", Value: name },
    ],
  });
}

export async function confirmSignUp(email: string, code: string) {
  await cognito("ConfirmSignUp", {
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function resendCode(email: string) {
  await cognito("ResendConfirmationCode", {
    ClientId: CLIENT_ID,
    Username: email,
  });
}

/* --- Google: OAuth code flow + PKCE through the hosted domain ------------ */

function redirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

function randomString(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(values);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function startGoogleSignIn() {
  if (!googleEnabled) {
    throw new AuthError("NotConfigured", "Google sign-in is not enabled.");
  }
  const verifier = randomString(32);
  const state = randomString(16);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    identity_provider: "Google",
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state,
    code_challenge: base64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  });
  window.location.assign(`https://${DOMAIN}/oauth2/authorize?${params}`);
}

export async function completeGoogleSignIn(code: string, state: string) {
  const saved = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const pkce = saved
    ? (JSON.parse(saved) as { verifier: string; state: string })
    : null;
  if (!pkce || pkce.state !== state) {
    throw new AuthError("InvalidState", "This sign-in link is not valid.");
  }

  const response = await fetch(`https://${DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AuthError(
      data.error ?? "TokenError",
      "Google sign-in did not complete.",
    );
  }
  store({
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });
}

/* --- the session --------------------------------------------------------- */

let refreshing: Promise<string | null> | null = null;

async function refresh(refreshToken: string): Promise<string | null> {
  try {
    const data = await cognito<{ AuthenticationResult: AuthenticationResult }>(
      "InitiateAuth",
      {
        ClientId: CLIENT_ID,
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      },
    );
    store({
      idToken: data.AuthenticationResult.IdToken,
      expiresIn: data.AuthenticationResult.ExpiresIn,
    });
    return data.AuthenticationResult.IdToken;
  } catch {
    signOut();
    return null;
  }
}

/** The ID token to send to the API, renewed first if it is about to expire. */
export async function getIdToken(): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - RENEW_BEFORE_MS > Date.now()) return tokens.idToken;
  if (!tokens.refreshToken) {
    signOut();
    return null;
  }
  // One refresh at a time, however many requests are waiting on it.
  refreshing ??= refresh(tokens.refreshToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export function signOut() {
  writeTokens(null);
}

let cachedToken: string | null = null;
let cachedSession: Session | null = null;

function sessionSnapshot(): Session | null {
  const token = readTokens()?.idToken ?? null;
  if (token !== cachedToken) {
    cachedToken = token;
    try {
      const claims = token ? decodeClaims(token) : null;
      const email = String(claims?.email ?? "");
      cachedSession = claims
        ? {
            sub: String(claims.sub),
            email,
            name: String(claims.name ?? (email.split("@")[0] || "you")),
          }
        : null;
    } catch {
      cachedSession = null;
    }
  }
  return cachedSession;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab signing in or out changes the same storage key.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The signed-in person, or null. Always null while prerendering. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, sessionSnapshot, () => null);
}

/** False while prerendering and hydrating, true once running in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
