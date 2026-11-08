/**
 * Turns agent tool parameters into typed app inputs, and app results into the
 * short strings the agent is allowed to say. Numbers in replies come only from
 * engine fields (`sentence`, `display`), never computed here.
 */
import type { TransferResponse, UpdatePlanResponse, WhatIfRequest } from "@/lib/api";
import type { TransferProposal, UpdatePlanInput } from "./types";

const PRESETS: WhatIfRequest["preset"][] = [
  "new_job",
  "move",
  "big_purchase",
  "save_more",
  "job_loss",
  "buy_home",
  "buy_car",
  "custom",
];
const FREQUENCIES: TransferProposal["frequency"][] = ["payday", "monthly", "once"];

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

export function toUpdatePlanInput(raw: Record<string, unknown>): UpdatePlanInput {
  const preset = str(raw.preset) as WhatIfRequest["preset"] | undefined;
  const jobLoss = num(raw.job_loss_months);
  const startMonth = str(raw.start_month);
  const input: UpdatePlanInput = {
    description: str(raw.description) ?? "A change the user described",
    preset: preset && PRESETS.includes(preset) ? preset : "custom",
  };
  const income = num(raw.income_change_yearly);
  const spending = num(raw.spending_change_monthly);
  const savings = num(raw.savings_change_monthly);
  const oneTime = num(raw.one_time_cost);
  if (income !== undefined) input.income_change_yearly = income;
  if (spending !== undefined) input.spending_change_monthly = spending;
  if (savings !== undefined) input.savings_change_monthly = savings;
  if (oneTime !== undefined) input.one_time_cost = oneTime;
  if (jobLoss !== undefined) input.job_loss_months = Math.round(jobLoss);
  if (startMonth && /^\d{4}-\d{2}$/.test(startMonth)) input.start_month = startMonth;
  // Buy a home: flat params from the agent (or a nested `home` object).
  const nested = (raw.home ?? {}) as Record<string, unknown>;
  const price = num(raw.home_price ?? nested.price);
  const down = num(raw.home_down_payment ?? nested.down_payment);
  const rate = num(raw.home_rate ?? nested.rate);
  if (price !== undefined && down !== undefined && rate !== undefined) {
    input.home = { price, down_payment: down, rate, term_years: Math.round(num(raw.home_term_years ?? nested.term_years) ?? 30) };
    input.preset = "buy_home";
  }
  // Buy a car: flat params from the agent (or a nested `car` object). The term defaults to 60 months.
  const car = (raw.car ?? {}) as Record<string, unknown>;
  const carPrice = num(raw.car_price ?? car.price);
  const carDown = num(raw.car_down ?? car.down);
  const carApr = num(raw.car_apr ?? car.apr);
  if (carPrice !== undefined && carDown !== undefined && carApr !== undefined) {
    input.car = { price: carPrice, down: carDown, apr: carApr, term_months: Math.round(num(raw.car_term_months ?? car.term_months) ?? 60) };
    input.preset = "buy_car";
  }
  return input;
}

/**
 * Returns null when the agent didn't send a usable transfer after hearing a clear yes.
 * Even a usable one is only a proposal: it opens the confirm sheet, and nothing moves until the user taps Yes.
 */
export function toTransferInput(raw: Record<string, unknown>): TransferProposal | null {
  const amount = num(raw.amount);
  const from = str(raw.from_account_id);
  const to = str(raw.to_account_id);
  const frequency = str(raw.frequency) as TransferProposal["frequency"] | undefined;
  const heardYes = raw.confirmed === true || raw.confirmed === "true";
  if (!heardYes || amount === undefined || amount <= 0 || !from || !to) return null;
  if (!frequency || !FREQUENCIES.includes(frequency)) return null;
  return { amount, from_account_id: from, to_account_id: to, frequency };
}

const FREQ_WORDS: Record<TransferProposal["frequency"], string> = {
  payday: "every payday",
  monthly: "every month",
  once: "once",
};

/** Formats an amount the agent or the engine already gave (no math). */
function dollars(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });
}

/** What the agent hears after proposing: it's on screen, waiting for the user's tap. Never "done". */
export function proposalReply(p: TransferProposal, names: { from: string; to: string }): string {
  return [
    `NOT SCHEDULED YET. A confirm sheet is now on the user's screen: ${dollars(p.amount)} from ${names.from} to ${names.to} ${FREQ_WORDS[p.frequency]}.`,
    'Nothing moves unless the user taps "Yes, schedule it" on that sheet. It is a simulated demo transfer: no real money moves.',
    "SAY THIS: It's on your screen now. Check the details, and tap yes if it looks right.",
    "Do not say it's done, scheduled or set up. You'll get a note when they tap.",
  ].join("\n");
}

/** Sent to the agent (as a contextual update) when the user taps on the confirm sheet or stops the transfer. */
export function decisionNote(kind: "confirmed" | "declined" | "stopped", sentence?: string): string {
  if (kind === "confirmed") {
    return `The user tapped Yes on screen, so the simulated transfer is scheduled. ${sentence ?? ""} You can tell them it's set up, that it's a simulated demo transfer (no real money moves), and that they can stop it any time.`;
  }
  if (kind === "stopped") return `The user tapped Stop on screen, so the simulated transfer is stopped. ${sentence ?? ""}`.trim();
  return "The user tapped Not now on screen. Nothing was scheduled. Say that's completely fine, and don't offer it again in this conversation.";
}

export function updatePlanReply(res: UpdatePlanResponse): string {
  const numbers = res.result.key_numbers.map((m) => `${m.label} ${m.display}`).join("; ");
  const deltas = res.deltas.map((m) => `${m.label} ${m.display}`).join("; ");
  const car = (res.car_options ?? [])
    .map((o) => `${o.term_months} months at ${o.apr}%: ${dollars(Math.round(o.payment))} a month, ${dollars(Math.round(o.total_interest))} total interest`)
    .join("; ");
  return [
    `SAY THIS: ${res.sentence}`,
    numbers && `New 2031 numbers (these replace your earlier 2031 numbers): ${numbers}.`,
    deltas && `Change from before: ${deltas}.`,
    car && `Same car loan, other options (only if asked): ${car}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function transferReply(res: TransferResponse): string {
  return `SAY THIS: ${res.sentence}\nStatus: ${res.status}. First date: ${res.first_date}. This is a simulated demo transfer: no real money moves.`;
}

export const REPLY = {
  notPlanPath:
    "Not available: you are the same-path future. You can only remember how things actually went. Suggest trying this what-if on the plan side.",
  needsYes:
    "Not scheduled. You need a clear yes to the amount, the accounts and how often first. Restate the details and ask.",
  alreadyScheduled:
    "Already scheduled earlier (a simulated demo transfer: no real money moves). Nothing new was set up. Tell the user it's already on its way and they can stop it any time on the Next step screen.",
  pending: "NOT SCHEDULED. The confirm sheet is already on the user's screen. Ask them to check it and tap yes or not now.",
  fuzzy: "That part is fuzzy. Tell the user that part is fuzzy for you and ask them to try again.",
};
