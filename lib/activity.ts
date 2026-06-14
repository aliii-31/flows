import { getStore } from "./store";
import { logEvent } from "./events";

export type Activity = {
  direction: "sent" | "received";
  counterparty: string; // the other wallet
  counterparty_name?: string; // their Flows name, snapshotted at send time
  counterparty_country?: string; // their ISO country code
  amount: string; // human-readable USDC, e.g. "5.00"
  hash: string; // tx hash
  at: string; // ISO timestamp
};

type Profile = { name?: string; country?: string };

const activityKey = (address: string) => `activity:${address.toLowerCase()}`;
const profileKey = (address: string) => `profile:${address.toLowerCase()}`;

async function append(address: string, entry: Activity) {
  const store = getStore();
  const key = activityKey(address);
  const existing = (await store.get<Activity[]>(key)) ?? [];
  // Newest first, cap the list so it stays small.
  await store.set(key, [entry, ...existing].slice(0, 50));
}

/**
 * Record a confirmed transfer: a "sent" entry for the sender and a mirrored
 * "received" entry for the recipient, plus the remittance events that feed
 * scoring. Used by both the client-confirmed /api/activity and the scheduled
 * payment executor.
 */
export async function recordTransfer(
  from: string,
  to: string,
  amount: string,
  hash: string,
  scheduled = false
) {
  const store = getStore();
  const [fromProfile, toProfile] = await Promise.all([
    store.get<Profile>(profileKey(from)),
    store.get<Profile>(profileKey(to)),
  ]);

  const at = new Date().toISOString();
  await Promise.all([
    append(from, {
      direction: "sent",
      counterparty: to,
      counterparty_name: toProfile?.name,
      counterparty_country: toProfile?.country,
      amount,
      hash,
      at,
    }),
    append(to, {
      direction: "received",
      counterparty: from,
      counterparty_name: fromProfile?.name,
      counterparty_country: fromProfile?.country,
      amount,
      hash,
      at,
    }),
  ]);

  const usd = Number(amount);
  await Promise.all([
    logEvent({
      type: "remittance.sent",
      address: from,
      amount_usd: usd,
      payload: { to, to_name: toProfile?.name, to_country: toProfile?.country, hash, scheduled },
    }),
    logEvent({
      type: "remittance.received",
      address: to,
      amount_usd: usd,
      payload: { from, from_name: fromProfile?.name, from_country: fromProfile?.country, hash, scheduled },
    }),
  ]);
}
