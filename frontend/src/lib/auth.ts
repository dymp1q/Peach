import { WebStorageStateStore } from "oidc-client-ts";
import type { AuthProviderProps } from "react-oidc-context";

/** Sign-in through Cognito (lab 4). Compiled in at build time from the auth
 *  stack's outputs, the same way as the API URL; all three empty means the
 *  build has no sign-in and the header shows no Sign in button. */
const authority = import.meta.env.VITE_COGNITO_AUTHORITY ?? "";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN ?? "";

export const authEnabled = Boolean(authority && clientId && cognitoDomain);

/** Must match a CallbackURL on the Cognito client exactly, trailing slash
 *  included. */
export const CALLBACK_PATH = "/auth/callback/";

export function oidcConfig(): AuthProviderProps {
  const origin = window.location.origin;
  return {
    authority,
    client_id: clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${origin}/`,
    scope: "openid email profile",
    // Survives a reload and a second tab; sessionStorage would sign the user
    // out of every new tab.
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    // Once the code is exchanged, drop ?code=&state= and leave the callback
    // page for the home page.
    onSigninCallback: () => navigate("/"),
  };
}

/** Cognito does not implement OIDC's end-session endpoint: forget the tokens
 *  here, then let Cognito end its own session and send the browser back. */
export function cognitoLogoutUrl(): string {
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: `${window.location.origin}/`,
  });
  return `${cognitoDomain}/logout?${params}`;
}

/** The app has a handful of pages and no router; this keeps the URL and the
 *  rendered page in step. */
export function navigate(path: string) {
  window.history.replaceState({}, document.title, path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
