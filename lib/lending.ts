import { getStore } from "./store";
import { listEvents } from "./events";
import { getScoringConfig } from "./scoring";
import { computeAnalytics } from "./analytics";
import { computeLoanTerms } from "./flowpool";

export type LoanRequest = {
  id: string;
  receiver: string;
  sender: string;
  amount: number; // USD
  status: "pending" | "quoted" | "funded" | "repaid" | "declined";
  created_at: string;
};

export type Terms = {
  senderScore: number;
  lineScore: number;
  collateralBps: number;
  interestBps: number;
  collateral: number; // USD the sender must post
  interest: number; // USD interest due
  hasLine: boolean;
};

/** Loan terms for a sender→receiver line + amount, from FlowScore + LineScore. */
export async function termsFor(sender: string, receiver: string, amount: number): Promise<Terms> {
  const [events, config] = await Promise.all([listEvents(5000), getScoringConfig()]);
  const a = computeAnalytics(events, config);
  const s = sender.toLowerCase();
  const r = receiver.toLowerCase();
  const senderScore = a.users.find((u) => u.address === s)?.flowScore ?? 0;
  const line = a.flowLines.find((l) => l.id === `${s}->${r}`);
  const lineScore = line?.lineScore ?? 0;
  const { collateralBps, interestBps } = computeLoanTerms(senderScore, lineScore, config);
  return {
    senderScore,
    lineScore,
    collateralBps,
    interestBps,
    collateral: +((amount * collateralBps) / 10000).toFixed(2),
    interest: +((amount * interestBps) / 10000).toFixed(2),
    hasLine: !!line,
  };
}

const reqKey = (id: string) => `loanreq:${id}`;
const inKey = (a: string) => `loanreq:in:${a.toLowerCase()}`; // sender's incoming
const outKey = (a: string) => `loanreq:out:${a.toLowerCase()}`; // receiver's outgoing

export async function createRequest(
  receiver: string,
  sender: string,
  amount: number
): Promise<LoanRequest> {
  const store = getStore();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req: LoanRequest = {
    id,
    receiver: receiver.toLowerCase(),
    sender: sender.toLowerCase(),
    amount,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  await store.set(reqKey(id), req);
  await store.set(inKey(sender), [id, ...((await store.get<string[]>(inKey(sender))) ?? [])].slice(0, 50));
  await store.set(outKey(receiver), [id, ...((await store.get<string[]>(outKey(receiver))) ?? [])].slice(0, 50));
  return req;
}

export async function getRequest(id: string) {
  return getStore().get<LoanRequest>(reqKey(id));
}

export async function setRequestStatus(id: string, status: LoanRequest["status"]) {
  const store = getStore();
  const r = await store.get<LoanRequest>(reqKey(id));
  if (r) {
    r.status = status;
    await store.set(reqKey(id), r);
  }
}

export async function listRequests(address: string) {
  const store = getStore();
  const a = address.toLowerCase();
  const inIds = (await store.get<string[]>(inKey(a))) ?? [];
  const outIds = (await store.get<string[]>(outKey(a))) ?? [];
  const fetch = async (ids: string[]) =>
    (await Promise.all(ids.map((id) => store.get<LoanRequest>(reqKey(id))))).filter(
      Boolean
    ) as LoanRequest[];
  return { incoming: await fetch(inIds), outgoing: await fetch(outIds) };
}
