/**
 * Turns agent tool parameters into typed app inputs, and app results into the
 * short strings the agent is allowed to say. Numbers in replies come only from
 * engine fields (`sentence`, `display`), never computed here.
 */
import type { TransferResponse, UpdatePlanResponse, WhatIfRequest } from "@/lib/api";
import type { TransferInput, UpdatePlanInput } from "./types";

const PRESETS: WhatIfRequest["preset"][] = [
  "new_job",
  "move",
  "big_purchase",
  "save_more",
  "job_loss",
  "buy_home",
  "custom",
];
const FREQUENCIES: TransferInput["frequency"][] = ["payday", "monthly", "once"];

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
  return input;
}

/** Returns null when the agent didn't send a usable, confirmed transfer. */
export function toTransferInput(raw: Record<string, unknown>): TransferInput | null {
  const amount = num(raw.amount);
  const from = str(raw.from_account_id);
  const to = str(raw.to_account_id);
  const frequency = str(raw.frequency) as TransferInput["frequency"] | undefined;
  const confirmed = raw.confirmed === true || raw.confirmed === "true";
  if (!confirmed || amount === undefined || amount <= 0 || !from || !to) return null;
  if (!frequency || !FREQUENCIES.includes(frequency)) return null;
  return { amount, from_account_id: from, to_account_id: to, frequency, confirmed: true };
}

export function updatePlanReply(res: UpdatePlanResponse): string {
  const numbers = res.result.key_numbers.map((m) => `${m.label} ${m.display}`).join("; ");
  const deltas = res.deltas.map((m) => `${m.label} ${m.display}`).join("; ");
  return [
    `SAY THIS: ${res.sentence}`,
    numbers && `New 2031 numbers (these replace your earlier 2031 numbers): ${numbers}.`,
    deltas && `Change from before: ${deltas}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function transferReply(res: TransferResponse): string {
  return `SAY THIS: ${res.sentence}\nStatus: ${res.status}. First date: ${res.first_date}. ${
    res.simulated ? "This is a simulated demo transfer." : ""
  }`.trim();
}

export const REPLY = {
  notPlanPath:
    "Not available: you are the same-path future. You can only remember how things actually went. Suggest trying this what-if on the plan side.",
  needsYes:
    "Not scheduled. You need a clear yes to the amount, the accounts and how often first. Restate the details and ask.",
  fuzzy: "That part is fuzzy. Tell the user that part is fuzzy for you and ask them to try again.",
};
