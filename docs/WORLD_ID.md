# World ID 4.0 in Inflow

How Inflow integrates World ID, why it's load-bearing rather than decorative,
and how the integration maps to the Track B (World ID) requirements.

---

## TL;DR

Inflow is a remittance neobank whose premise is **"money that arrives builds
your score"** — a FlowScore credit layer that grows as a person receives money
over time, and eventually unlocks under-collateralized credit (advances against
expected inflows).

That premise only works if **one human = one score**. World ID 4.0 is the
constraint that makes it true: a person proves they're a unique human, and that
proof is bound to exactly one account. Without it, the entire credit layer is
Sybil-farmable and worthless.

We verify with `@worldcoin/idkit` 4.x and validate every proof **server-side**
against the World ID v4 verification endpoint, with an RP-signed request and a
wallet-binding check.

---

## What breaks without World ID

FlowScore is reputation that converts into money (credit). Reputation that
converts into money is the single most attacked surface in fintech. Without a
proof of unique personhood:

- **Sybil score farming** — one person creates N accounts, cycles the same
  funds through them, and farms N scores. Any credit extended against those
  scores is drained instantly.
- **Onboarding/referral abuse** — any "one per human" incentive (signup bonus,
  fee waiver, referral reward) is multiplied by however many accounts a person
  can spin up.
- **No basis for unsecured credit** — under-collateralized lending *requires*
  knowing a borrower is a real, single, non-duplicable identity. No personhood,
  no credit product. Full stop.

So World ID is not a "login with extra steps." It's the precondition for the
product's core value (credit from reputation) to exist at all. **It's a real
constraint: remove it and the product collapses to a plain wallet.**

We use World ID specifically for **uniqueness / one-per-human** — the
qualification's first and clearest constraint category.

---

## Architecture

World ID 4.0 introduces a **Relying Party (RP)** model: your backend signs each
proof request with a secret key, so proofs can't be replayed against your app by
a third party. Inflow implements the full round-trip.

```
                    ┌─────────────────────────────────────────────┐
   user taps        │  Inflow client (Next.js)                     │
   "Verify"  ─────► │  components/world-id-verify.tsx              │
                    │   1. POST /api/worldid/sign  ───────────────┐│
                    └──────────────────────────────────────────────┘│
                                                                     ▼
                    ┌─────────────────────────────────────────────┐
   RP signature     │  app/api/worldid/sign/route.ts               │
   (backend)        │   signRequest({ signingKeyHex, action })     │
                    │   → { rp_id, nonce, created_at,              │
                    │       expires_at, signature }   (5-min TTL)  │
                    └─────────────────────────────────────────────┘
                                   │ rp_context
                                   ▼
                    ┌─────────────────────────────────────────────┐
   2. IDKit widget  │  IDKitRequestWidget                          │
      collects proof│   preset: proofOfHuman({ signal: wallet })   │
                    │   World App / simulator → ZK proof           │
                    └─────────────────────────────────────────────┘
                                   │ idkitResponse
                                   ▼
                    ┌─────────────────────────────────────────────┐
   3. backend       │  app/api/verify-worldid/route.ts (POST)      │
      validation    │   a. POST proof → developer.world.org        │
                    │        /api/v4/verify/{rp_id}                │
                    │   b. signal_hash === hashSignal(wallet)?     │
                    │   c. nullifier already bound to a            │
                    │        different wallet? → 409               │
                    │   d. persist { nullifier, wallet, action }   │
                    └─────────────────────────────────────────────┘
                                   │
                                   ▼
                       store (Supabase, or local JSON fallback)
```

### The three steps in detail

**1. Sign the request (backend).** `app/api/worldid/sign/route.ts` calls
`signRequest({ signingKeyHex: WLD_RP_SIGNING_KEY, action })` from
`@worldcoin/idkit/signing`. The **action is signed from a server env var, never
from client input**, so a client can't change what it's proving. The response is
an `rp_context` (rp_id, nonce, signature, created/expiry — a 5-minute TTL).

**2. Collect the proof (client).** `components/world-id-verify.tsx` fetches the
`rp_context`, then opens `IDKitRequestWidget` with
`preset={proofOfHuman({ signal: walletAddress })}`. The user's World App (or the
staging simulator) produces a zero-knowledge proof. The **signal is the user's
embedded-wallet address**, which commits the proof to that specific wallet.

**3. Validate the proof (backend).** `app/api/verify-worldid/route.ts` does four
things on `POST`:
   - **a.** Forwards the proof to `https://developer.world.org/api/v4/verify/{rp_id}`
     for cryptographic verification. We never trust the client's word that a
     proof is valid.
   - **b.** Recomputes `hashSignal(wallet)` and checks it equals the proof's
     `signal_hash`. This stops a valid proof from being replayed to bind a
     *different* account.
   - **c.** Looks up the proof's `nullifier`. If it's already bound to a
     different wallet → **HTTP 409** ("one human, one account"). Same wallet →
     idempotent success.
   - **d.** Persists `{ nullifier, wallet_address, action, verified_at }` keyed
     both by nullifier and by wallet.

`GET /api/verify-worldid?address=…` returns whether a wallet is verified. The
home screen reads this on load — **verification state lives on the server, never
in localStorage.**

### File map

| File | Role |
|---|---|
| `app/api/worldid/sign/route.ts` | Backend RP signing (`signRequest`) |
| `app/api/verify-worldid/route.ts` | Backend proof validation + nullifier binding + status |
| `components/world-id-verify.tsx` | Client: fetch signature → IDKit widget → post proof |
| `components/flow-score-ring.tsx` | UI: unverified vs verified (score ring) state |
| `lib/store.ts` | Storage adapter (Supabase or local JSON) for verification records |

---

## Security properties

- **Server-side validation only.** A client claiming "I'm verified" proves
  nothing; the proof is checked against World's v4 endpoint on the backend.
- **Replay-bound to a wallet.** `signal_hash` must equal `hashSignal(wallet)`,
  so a leaked/valid proof can't be reused to verify someone else's account.
- **RP-signed requests.** Each request is signed with a secret key
  (`WLD_RP_SIGNING_KEY`), preventing third parties from issuing proof requests
  as Inflow. The action is signed server-side and never client-controlled.
- **One human, one account.** A nullifier already bound to a wallet can't be
  re-bound to another → HTTP 409. This is the uniqueness constraint, enforced
  at write time.
- **No client-trusted state.** Verification status is read from the server, not
  localStorage, so it can't be spoofed by editing browser storage.

---

## How this maps to Track B (World ID) requirements

| Requirement | Inflow |
|---|---|
| Uses **World ID 4.0** | `@worldcoin/idkit` 4.x, `IDKitRequestWidget`, `proofOfHuman`, RP signing, `/api/v4/verify` |
| **As a real constraint** | Uniqueness (one human, one account) gates the FlowScore credit layer |
| **What breaks without it** | Sybil score-farming makes any credit product worthless; unsecured credit is impossible without personhood |
| **Working application** | Login (Privy) → verify (World ID) → send/receive USDC on Arc, with persisted state |
| **Proof validation in a web backend** | `/api/verify-worldid` forwards to the v4 endpoint *and* binds `signal_hash` to the wallet |

---

## Configuration

```
NEXT_PUBLIC_WLD_APP_ID=app_…      # Developer Portal app id (public)
NEXT_PUBLIC_WLD_RP_ID=rp_…        # Relying Party id from "Enable World ID 4.0" (public)
WLD_RP_SIGNING_KEY=…              # server-only secret; signs proof requests
NEXT_PUBLIC_WLD_ACTION=verify-human
NEXT_PUBLIC_WLD_ENV=staging       # "staging" → simulator; "production" → real World App
```

## Testing without a World App

1. Set `NEXT_PUBLIC_WLD_ENV=staging` (default).
2. On a **desktop** browser, log in and tap **Verify**.
3. In the IDKit dialog, click **"Testing in staging? → open in simulator"** —
   this opens [simulator.worldcoin.org](https://simulator.worldcoin.org) with
   the request preloaded.
4. Approve in the simulator (it provides an orb-verified test identity). The
   proof returns over the staging bridge, the backend validates it, and the
   FlowScore ring flips to its verified state.
5. To see the uniqueness constraint: verify a second account with the **same**
   simulator identity → it's rejected with HTTP 409.
