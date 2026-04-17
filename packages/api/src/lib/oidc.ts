import { Issuer, generators, type Client, type TokenSet } from 'openid-client';

/**
 * OIDC integration for the admin surface.
 *
 * Provider-agnostic: any spec-compliant OIDC issuer works. The user
 * picks one via env (`OIDC_ISSUER_URL` + client credentials) — Auth0,
 * Clerk, WorkOS, Keycloak, Google, etc. This keeps Koe out of a
 * vendor lock-in and matches the meeting's recommendation
 * ("audited OIDC provider, not DIY").
 *
 * The flow is Authorization Code + PKCE (RFC 7636), with `state` and
 * `nonce` bound to the caller's session. State storage between the
 * redirect and the callback lives in a signed cookie — see
 * `routes/oidcAuth.ts` — so nothing about the handshake leaks to
 * persistent storage on the API side.
 */

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /**
   * Space-separated scopes requested from the provider. `openid email
   * profile` is the common-denominator set — `openid` is mandatory,
   * `email` is how we look the user up on our side, `profile` gives
   * us `name`/`preferred_username` for display. Override if your
   * provider needs more.
   */
  scopes?: string;
}

export interface AuthorizationDescriptor {
  authorizeUrl: string;
  state: SavedAuthorizationState;
}

export interface SavedAuthorizationState {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string | null;
}

export interface OidcUser {
  email: string;
  displayName: string | null;
}

export interface OidcService {
  /**
   * Produces the provider's authorize URL plus the transient secrets
   * that must travel back through the callback — the caller stores
   * them in a signed cookie.
   */
  beginLogin(returnTo: string | null): Promise<AuthorizationDescriptor>;
  /**
   * Validates the callback params against the saved state, exchanges
   * the code, and returns the user identity. Throws on any
   * validation failure — callers turn that into a uniform 401.
   */
  finishLogin(callbackUrl: URL, saved: SavedAuthorizationState): Promise<OidcUser>;
  /**
   * RP-initiated logout URL, or `null` if the issuer doesn't expose
   * `end_session_endpoint`. Falls back to a plain local logout
   * client-side when null.
   */
  endSessionUrl(idToken: string | null, postLogoutRedirectUri: string): Promise<string | null>;
}

export function createOidcService(config: OidcConfig): OidcService {
  const scopes = config.scopes ?? 'openid email profile';

  let clientPromise: Promise<Client> | null = null;
  const getClient = (): Promise<Client> => {
    if (!clientPromise) {
      clientPromise = Issuer.discover(config.issuerUrl).then(
        (issuer) =>
          new issuer.Client({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uris: [config.redirectUri],
            response_types: ['code'],
          }),
      );
    }
    return clientPromise;
  };

  return {
    async beginLogin(returnTo) {
      const client = await getClient();

      // PKCE + state + nonce, all fresh per attempt. The verifier is
      // kept server-side (in the signed state cookie); only the
      // challenge travels to the provider.
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();
      const nonce = generators.nonce();

      const authorizeUrl = client.authorizationUrl({
        scope: scopes,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      return {
        authorizeUrl,
        state: { codeVerifier, state, nonce, returnTo },
      };
    },

    async finishLogin(callbackUrl, saved) {
      const client = await getClient();
      const params = client.callbackParams(callbackUrl.toString());

      // `callback()` checks state / nonce, validates the id_token
      // signature + expiry, and exchanges the code + code_verifier.
      // Anything off throws — we surface that as a 401.
      const tokenSet: TokenSet = await client.callback(config.redirectUri, params, {
        state: saved.state,
        nonce: saved.nonce,
        code_verifier: saved.codeVerifier,
      });

      const claims = tokenSet.claims();
      const email = typeof claims.email === 'string' ? claims.email : null;
      if (!email) {
        // Different providers gate email visibility behind scopes or
        // account settings — tell the operator what to fix rather
        // than fail silently.
        throw new Error(
          'OIDC id_token did not include an email claim. Check the requested scopes.',
        );
      }

      const displayName =
        (typeof claims.name === 'string' && claims.name) ||
        (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
        null;

      return { email, displayName };
    },

    async endSessionUrl(idToken, postLogoutRedirectUri) {
      const client = await getClient();
      if (!client.issuer.metadata.end_session_endpoint) return null;
      return client.endSessionUrl({
        id_token_hint: idToken ?? undefined,
        post_logout_redirect_uri: postLogoutRedirectUri,
      });
    },
  };
}
