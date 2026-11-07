/**
 * App actions as plain functions.
 *
 * The screens call these on taps, and the voice lane (M8) registers the first
 * three as ElevenLabs client tools (`update_plan`, `start_transfer`,
 * `highlight_metric`). So:
 * - signatures stay close to the API contract (`WhatIfRequest`, `TransferRequest`),
 * - each returns plain data the agent can read back (the API response, or a short status),
 * - none of them needs React; they write to the shared store in `store.ts`.
 */
import { api, type CustomerId, type PathId, type TransferRequest, type TransferResponse, type UpdatePlanResponse, type WhatIfRequest } from "./api";
import { getState, initialState, setState, type Screen } from "./store";
import type { ToolEvent, VoiceStatus } from "@/components/voice/types";

// ---------------------------------------------------------------------------
// Agent-facing tools (M8 registers these)
// ---------------------------------------------------------------------------

/** What-if input: `WhatIfRequest` with `customer` optional (defaults to the current customer). */
export type UpdatePlanInput = Omit<WhatIfRequest, "customer"> & { customer?: CustomerId };

/**
 * Apply a what-if to the plan path (never the same path) and update the screen.
 * Resolves with the API response so the agent can read `sentence` and `deltas`.
 */
export async function updatePlan(input: UpdatePlanInput): Promise<UpdatePlanResponse> {
  const customer = input.customer ?? getState().customer;
  setState({ whatIfPending: true, error: null });
  try {
    const res = await api.updatePlan({ ...input, customer });
    // Futures now include every active what-if, so the plan card, fact sheets and next step all agree.
    const futures = await api.futures(customer).catch(() => null);
    setState((s) => ({ whatIf: res, whatIfPending: false, futures: futures ?? s.futures }));
    return res;
  } catch (e) {
    setState({ whatIfPending: false, error: errorText(e) });
    throw e;
  }
}

/** Transfer input: `TransferRequest` with `customer` optional. `confirmed` must be true or the API refuses. */
export type StartTransferInput = Omit<TransferRequest, "customer"> & { customer?: CustomerId };

/** Schedule a (simulated) transfer. Only call after a clear yes from the user. */
export async function startTransfer(input: StartTransferInput): Promise<TransferResponse> {
  const customer = input.customer ?? getState().customer;
  setState({ transferPending: true, error: null });
  try {
    const res = await api.startTransfer({ ...input, customer });
    setState({ transfer: res, transferPending: false });
    return res;
  } catch (e) {
    setState({ transferPending: false, error: errorText(e) });
    throw e;
  }
}

let highlightTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Make the on-screen number with this `Metric.id` glow, switching to its
 * screen and scrolling it into view. Returns whether it was found.
 * Every rendered Metric carries `data-metric-id="<id>"` (see `MetricValue`).
 */
export function highlightMetric(metricId: string, durationMs = 3000): { ok: boolean; metricId: string } {
  const screen = screenForMetric(metricId);
  if (screen && getState().screen !== screen) setState({ screen });
  // Indicator values live behind the score drill-down on Today.
  const isIndicator = metricId.startsWith("health.") && metricId !== "health.score" && !metricId.startsWith("health.pillar.");
  setState({ highlighted: metricId, ...(isIndicator ? { showIndicators: true } : {}) });

  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (getState().highlighted === metricId) setState({ highlighted: null });
  }, durationMs);

  if (typeof document === "undefined") return { ok: screen !== null, metricId };
  // Let the screen render first, then scroll.
  requestAnimationFrame(() => {
    findMetricElement(metricId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  return { ok: screen !== null || findMetricElement(metricId) !== null, metricId };
}

export function findMetricElement(metricId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-metric-id="${CSS.escape(metricId)}"]`);
}

/** Which screen shows a metric id, from its prefix. */
export function screenForMetric(metricId: string): Screen | null {
  if (metricId.startsWith("today.") || metricId.startsWith("health.") || metricId.startsWith("account.")) return "today";
  if (metricId.startsWith("forecast.")) return "forecast";
  if (metricId.startsWith("same_path.") || metricId.startsWith("plan.") || metricId.startsWith("whatif.")) return "futures";
  if (metricId.startsWith("next_step.")) return "next";
  return null;
}

// ---------------------------------------------------------------------------
// Screen actions
// ---------------------------------------------------------------------------

/** Load every read endpoint for a customer. */
export async function loadCustomer(customer: CustomerId = getState().customer) {
  setState({ customer, loading: true, error: null });
  try {
    const [profile, health, forecast, futures] = await Promise.all([
      api.profile(customer),
      api.health(customer),
      api.forecast(customer),
      api.futures(customer),
    ]);
    // Ignore a slow response for a customer we've already switched away from.
    if (getState().customer !== customer) return;
    setState({ profile, health, forecast, futures, loading: false });
  } catch (e) {
    setState({ loading: false, error: errorText(e) });
  }
}

/** Switch customer: clears what-ifs and transfers, then reloads. */
export function switchCustomer(customer: CustomerId) {
  if (customer === getState().customer) return;
  setState({ ...initialState, customer, screen: getState().screen });
  void loadCustomer(customer);
}

/** Demo reset: server state back to start, front-end state cleared, back to Today. */
export async function resetDemo() {
  const customer = getState().customer;
  try {
    await api.reset(customer);
  } catch {
    // Fixture mode can't fail here; keep going so the UI still resets.
  }
  setState({ ...initialState, customer });
  await loadCustomer(customer);
}

/** Tab navigation. Tapping Today always lands on the main Today view. */
export function goTo(screen: Screen) {
  setState({ screen, ...(screen === "today" ? { showIndicators: false } : {}) });
}

export function showIndicators(open = true) {
  setState({ showIndicators: open });
}

export function openWhatIf(open = true) {
  setState({ whatIfDrawerOpen: open });
}

/** Select one future self (tapping its side). The voice lane hooks session switching onto this. */
export function selectFuture(path: PathId | null) {
  setState({ activePath: path });
}

let queueId = 0;

/** Typed question to one future self: opens that path's voice session and sends it there. */
export function askFuture(path: PathId, text: string) {
  const q = text.trim();
  if (!q) return;
  setState((s) => ({
    activePath: path,
    questions: [...s.questions, { path, text: q, at: Date.now() }],
    voiceQueue: { id: ++queueId, text: q, path },
  }));
}

/** "Ask both": the same path answers first, then the plan path gets the same question. */
export function askBoth(text: string) {
  const q = text.trim();
  if (!q) return;
  setState({ askBothPending: q });
  askFuture("same_path", q);
}

/** The voice session sent a queued question. */
export function queuedQuestionSent(id: number) {
  if (getState().voiceQueue?.id === id) setState({ voiceQueue: null });
}

/** A future self finished a reply. Continues "Ask both" on the plan path. */
export function agentReplied(path: PathId) {
  const pending = getState().askBothPending;
  if (pending && path === "same_path") {
    setState({ askBothPending: null });
    askFuture("plan", pending);
  }
}

/** The voice session failed: stop waiting on "Ask both". */
export function voiceFailed() {
  if (getState().askBothPending) setState({ askBothPending: null });
}

export function recordToolEvent(e: ToolEvent) {
  setState((s) => ({ toolEvents: [...s.toolEvents, e].slice(-60) }));
}

export function setVoiceStatus(status: VoiceStatus) {
  if (getState().voiceStatus !== status) setState({ voiceStatus: status });
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
