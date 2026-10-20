/** Garmin login tokens, the same way the garminconnect Python library (0.3.x) gets them.
 *
 * 1. You sign in on Garmin's own sign-in page (shown in the app, see LoginScreen) - the same page
 *    the Garmin Connect Android app uses. Your password goes straight to Garmin; the app never
 *    sees it. Two-step verification codes are handled by that page too.
 * 2. Garmin answers with a one-time "service ticket", which is exchanged here for a DI OAuth2
 *    token (what the Garmin Connect app uses) plus a refresh token.
 * 3. The tokens are kept in the phone's secure storage (Android Keystore / iOS Keychain) and are
 *    refreshed automatically. Log out in Settings to delete them.
 */

import * as SecureStore from 'expo-secure-store';

export const SSO = 'https://sso.garmin.com';
export const CONNECTAPI = 'https://connectapi.garmin.com';
export const MOBILE_SSO_CLIENT_ID = 'GCM_ANDROID_DARK';
export const MOBILE_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/android';
export const LOGIN_URL =
  `${SSO}/mobile/sso/en_US/sign-in?clientId=${MOBILE_SSO_CLIENT_ID}&service=${encodeURIComponent(MOBILE_SERVICE_URL)}`;

const DI_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const DI_GRANT_TYPE = 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket';
const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  'GARMIN_CONNECT_MOBILE_IOS_DI',
];

/** Headers the Garmin Connect Android app sends to the API. */
export function nativeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': 'GCM-Android-5.23',
    'X-Garmin-User-Agent': 'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0',
    'X-Garmin-Paired-App-Version': '10861',
    'X-Garmin-Client-Platform': 'Android',
    'X-App-Ver': '10861',
    'X-Lang': 'en',
    'X-GCExperience': 'GC5',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };
}

export interface Tokens {
  di_token: string;
  di_refresh_token: string | null;
  di_client_id: string;
}

export class GarminAuthError extends Error {}
export class GarminRateLimitError extends Error {}

/** The service ticket in a URL Garmin redirects to after sign-in, if there is one. */
export function ticketFrom(url: string): string | null {
  const m = /[?&]ticket=(ST-[^&#\s"]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** fetch that gives up after `ms`, so a stalled request ends in an error instead of a spinner. */
export async function fetchWithTimeout(url: string, init: RequestInit, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`Garmin didn't answer within ${ms / 1000} seconds. Check your connection and try again.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const form = (data: Record<string, string>) =>
  Object.entries(data).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

function jwtPayload(token: string): any {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
}

const clientIdOf = (token: string): string | null => jwtPayload(token)?.client_id ?? null;

/** True when the token expires within 15 minutes. */
export function expiresSoon(token: string): boolean {
  const exp = Number(jwtPayload(token)?.exp);
  return Number.isFinite(exp) && Date.now() / 1000 > exp - 900;
}

function diPost(clientId: string, accept: string, data: Record<string, string>) {
  return fetchWithTimeout(DI_TOKEN_URL, {
    method: 'POST',
    headers: nativeHeaders({
      Authorization: 'Basic ' + btoa(`${clientId}:`),
      Accept: accept,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    }),
    body: form(data),
  });
}

/** Exchange the sign-in ticket for DI OAuth2 tokens, trying each client ID in turn. */
export async function exchangeTicket(ticket: string, serviceUrl = MOBILE_SERVICE_URL): Promise<Tokens> {
  let lastStatus = 0;
  for (const clientId of DI_CLIENT_IDS) {
    const r = await diPost(clientId, 'application/json,text/html;q=0.9,*/*;q=0.8', {
      client_id: clientId, service_ticket: ticket, grant_type: DI_GRANT_TYPE, service_url: serviceUrl,
    });
    if (r.status === 429) throw new GarminRateLimitError('Garmin is rate-limiting logins - wait an hour and try again.');
    lastStatus = r.status;
    if (!r.ok) continue;
    try {
      const d = await r.json();
      return { di_token: d.access_token, di_refresh_token: d.refresh_token ?? null, di_client_id: clientIdOf(d.access_token) ?? clientId };
    } catch {
      continue;
    }
  }
  throw new GarminAuthError(`Garmin didn't accept the sign-in (HTTP ${lastStatus}). Try signing in again.`);
}

export async function refreshTokens(t: Tokens): Promise<Tokens> {
  if (!t.di_refresh_token) throw new GarminAuthError('Login expired - sign in again.');
  const r = await diPost(t.di_client_id, 'application/json', {
    grant_type: 'refresh_token', client_id: t.di_client_id, refresh_token: t.di_refresh_token,
  });
  if (!r.ok) throw new GarminAuthError(`Login expired (refresh failed: HTTP ${r.status}) - sign in again.`);
  const d = await r.json();
  return {
    di_token: d.access_token,
    di_refresh_token: d.refresh_token ?? t.di_refresh_token,
    di_client_id: clientIdOf(d.access_token) ?? t.di_client_id,
  };
}

// Secure storage keeps each value small, so the three parts are stored separately.
const KEYS = { di_token: 'gg_di_token', di_refresh_token: 'gg_di_refresh', di_client_id: 'gg_di_client' } as const;

export async function saveTokens(t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(KEYS.di_token, t.di_token);
  await SecureStore.setItemAsync(KEYS.di_client_id, t.di_client_id);
  if (t.di_refresh_token) await SecureStore.setItemAsync(KEYS.di_refresh_token, t.di_refresh_token);
  else await SecureStore.deleteItemAsync(KEYS.di_refresh_token);
}

export async function loadTokens(): Promise<Tokens | null> {
  const di_token = await SecureStore.getItemAsync(KEYS.di_token);
  const di_client_id = await SecureStore.getItemAsync(KEYS.di_client_id);
  if (!di_token || !di_client_id) return null;
  return { di_token, di_client_id, di_refresh_token: await SecureStore.getItemAsync(KEYS.di_refresh_token) };
}

export async function clearTokens(): Promise<void> {
  for (const k of Object.values(KEYS)) await SecureStore.deleteItemAsync(k);
}

/** Tokens pasted from the computer's ~/.garminconnect/garmin_tokens.json (fallback login). */
export function parseTokenFile(text: string): Tokens {
  const d = JSON.parse(text);
  if (!d.di_token) throw new GarminAuthError('No "di_token" in that text - paste the whole garmin_tokens.json.');
  return { di_token: d.di_token, di_refresh_token: d.di_refresh_token ?? null, di_client_id: d.di_client_id ?? clientIdOf(d.di_token) ?? DI_CLIENT_IDS[0] };
}
