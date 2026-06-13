// Transak on/off-ramp. Uses the API-based widget URL flow (the old direct-param
// URLs are deprecated): the backend gets a partner access token, then creates a
// short-lived session widgetUrl that the client opens. Funds route to/from the
// user's own Base wallet (USDC). Server-side only — keys never reach the client.
const ENV = (process.env.TRANSAK_ENV ?? "STAGING").toUpperCase();
const IS_PROD = ENV === "PRODUCTION";
const AUTH_BASE = IS_PROD ? "https://api.transak.com" : "https://api-stg.transak.com";
const GATEWAY_BASE = IS_PROD
  ? "https://api-gateway.transak.com"
  : "https://api-gateway-stg.transak.com";

const API_KEY = process.env.TRANSAK_API_KEY;
const API_SECRET = process.env.TRANSAK_API_SECRET;

export type RampProduct = "BUY" | "SELL";

export function isTransakConfigured() {
  return !!API_KEY && !!API_SECRET;
}

// Partner access token is valid ~7 days and each refresh invalidates the prior
// one, so cache it in-process rather than refreshing per request.
let _token: { value: string; expSec: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (_token && _token.expSec > now + 3600) return _token.value;
  const res = await fetch(`${AUTH_BASE}/partners/api/v2/refresh-token`, {
    method: "POST",
    headers: { "api-secret": API_SECRET!, "content-type": "application/json" },
    body: JSON.stringify({ apiKey: API_KEY }),
  });
  if (!res.ok) throw new Error(`Transak refresh-token failed: ${res.status}`);
  const d = await res.json();
  const value = d?.data?.accessToken as string;
  let exp = Number(d?.data?.expiresAt ?? 0);
  if (exp > 1e12) exp = exp / 1000; // normalize ms → s
  if (!value) throw new Error("Transak refresh-token returned no accessToken");
  _token = { value, expSec: exp || now + 6 * 86_400 };
  return value;
}

/** Creates a session widgetUrl for buying (onramp) or selling (offramp) USDC on Base. */
export async function createWidgetUrl(opts: {
  walletAddress: string;
  product: RampProduct;
  referrerDomain: string;
}): Promise<string> {
  const token = await accessToken();
  const res = await fetch(`${GATEWAY_BASE}/api/v2/auth/session`, {
    method: "POST",
    headers: { "access-token": token, "content-type": "application/json" },
    body: JSON.stringify({
      widgetParams: {
        apiKey: API_KEY,
        referrerDomain: opts.referrerDomain,
        walletAddress: opts.walletAddress,
        network: "base",
        cryptoCurrencyCode: "USDC",
        defaultCryptoCurrency: "USDC",
        productsAvailed: opts.product,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Transak session failed ${res.status}: ${t}`);
  }
  const d = await res.json();
  const url = d?.data?.widgetUrl as string;
  if (!url) throw new Error("Transak session returned no widgetUrl");
  return url;
}
