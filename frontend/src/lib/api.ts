/**
 * Typed client for the Future You API.
 *
 * Types come from `api-schema.ts`, which is generated from the backend's
 * Pydantic models. Never edit that file by hand: run `npm run gen:types`.
 */
import type { components } from "./api-schema";

type S = components["schemas"];

export type Metric = S["Metric"];
export type MathInfo = S["Math"];
export type Customer = S["Customer"];
export type Account = S["Account"];
export type AccountType = S["AccountType"];
export type AccountGroup = S["AccountGroup"];
export type Bill = S["Bill"];
export type UpcomingBill = S["UpcomingBill"];
export type ProfileResponse = S["ProfileResponse"];
export type Indicator = S["Indicator"];
export type Pillar = S["Pillar"];
export type HealthResponse = S["HealthResponse"];
export type ForecastPoint = S["ForecastPoint"];
export type ForecastResponse = S["ForecastResponse"];
export type PathResult = S["PathResult"];
export type YearSnapshot = S["YearSnapshot"];
export type LifeEvent = S["LifeEvent"];
export type Plan = S["Plan"];
export type PlanAction = S["PlanAction"];
export type NextStep = S["NextStep"];
export type FactSheet = S["FactSheet"];
export type FuturesResponse = S["FuturesResponse"];
export type WhatIfRequest = S["WhatIfRequest"];
export type UpdatePlanResponse = S["UpdatePlanResponse"];
export type TransferRequest = S["TransferRequest"];
export type TransferResponse = S["TransferResponse"];
export type ResetResponse = S["ResetResponse"];
export type SetupAnswers = S["SetupAnswers"];
export type ShockRequest = S["ShockRequest"];
export type ShockResponse = S["ShockResponse"];
export type PathId = "same_path" | "plan";
export type CustomerId = "maya" | "household";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`API ${status}: ${detail}`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      // body wasn't JSON; keep statusText
    }
    throw new ApiError(res.status, String(detail));
  }
  return res.json() as Promise<T>;
}

const q = (customer: CustomerId) => `?customer=${customer}`;

export const api = {
  profile: (c: CustomerId = "maya") => call<ProfileResponse>(`/api/profile${q(c)}`),
  health: (c: CustomerId = "maya") => call<HealthResponse>(`/api/health${q(c)}`),
  forecast: (c: CustomerId = "maya") => call<ForecastResponse>(`/api/forecast${q(c)}`),
  futures: (c: CustomerId = "maya") => call<FuturesResponse>(`/api/futures${q(c)}`),
  updatePlan: (body: WhatIfRequest) =>
    call<UpdatePlanResponse>("/api/update_plan", { method: "POST", body: JSON.stringify(body) }),
  startTransfer: (body: TransferRequest) =>
    call<TransferResponse>("/api/start_transfer", { method: "POST", body: JSON.stringify(body) }),
  reset: (c: CustomerId = "maya") => call<ResetResponse>(`/api/reset${q(c)}`, { method: "POST" }),
  shock: (body: ShockRequest) => call<ShockResponse>("/api/shock", { method: "POST", body: JSON.stringify(body) }),
  setup: (customer: CustomerId, setup: SetupAnswers) =>
    call<HealthResponse>("/api/setup", { method: "POST", body: JSON.stringify({ customer, setup }) }),
};
