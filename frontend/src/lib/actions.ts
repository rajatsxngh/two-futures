/**
 * App actions as plain functions.
 *
 * The screens call these on taps, and the voice lane (M8) registers the first
 * three as ElevenLabs client tools (`update_plan`, `start_transfer`,
 * `highlight_metric`). `start_transfer` only proposes: it opens the confirm
 * sheet, and money moves only after the user taps Yes there. So:
 * - signatures stay close to the API contract (`WhatIfRequest`, `TransferRequest`),
 * - each returns plain data the agent can read back (the API response, or a short status),
 * - none of them needs React; they write to the shared store in `store.ts`.
 */
import { api, type CustomerId, type Metric, type PathId, type TransferResponse, type UpdatePlanResponse, type WhatIfRequest } from "./api";
import { getState, initialState, setState, type Screen, type VoiceMode } from "./store";
import type { ProposalResult, ToolEvent, ToolEventName, TransferProposal, VoiceStatus } from "@/components/voice/types";
import { decisionNote, proposalReply, REPLY } from "@/components/voice/toolReplies";

// ---------------------------------------------------------------------------
// Agent-facing tools (M8 registers these)
// ---------------------------------------------------------------------------

/** What-if input: `WhatIfRequest` with `customer` optional (defaults to the current customer). */
export type UpdatePlanInput = Omit<WhatIfRequest, "customer"> & { customer?: CustomerId };

/**
 * Apply a what-if to the plan path (never the same path) and update the screen.
 * Resolves with the API response so the agent can read `sentence` and `deltas`.
 */
export async function updatePlan(input: UpdatePlanInput, source: "tap" | "voice" = "tap"): Promise<UpdatePlanResponse> {
  const customer = input.customer ?? getState().customer;
  setState({ whatIfPending: true, error: null });
  const done = source === "tap" ? tapEvent("update_plan", input as Record<string, unknown>) : null;
  try {
    const res = await api.updatePlan({ ...input, customer });
    // Futures now include every active what-if, so the plan card, fact sheets and next step all agree.
    const futures = await api.futures(customer).catch(() => null);
    setState((s) => ({ whatIf: res, whatIfPending: false, futures: futures ?? s.futures }));
    done?.({ phase: "ok", result: res, reply: res.sentence });
    return res;
  } catch (e) {
    setState({ whatIfPending: false, error: errorText(e) });
    done?.({ phase: "error", error: errorText(e) });
    throw e;
  }
}

/**
 * Propose a (simulated) transfer: opens the "Confirm your transfer" sheet over whatever screen is showing.
 * Nothing moves here. Agents (voice, text, saved answers) and the "Start this" button all come through this;
 * only `confirmTransfer`, run by the sheet's "Yes, schedule it" tap, ever calls the API.
 */
export function proposeTransfer(input: TransferProposal, source: "tap" | "voice" = "voice"): ProposalResult {
  const s = getState();
  if (s.transfer?.status === "scheduled") return { status: "already_scheduled", reply: REPLY.alreadyScheduled };
  if (s.transferProposal) return { status: "awaiting_tap", reply: REPLY.pending };
  const accounts = s.profile?.accounts ?? [];
  // Agents sometimes say the account's name ("Spend") instead of its id ("spend").
  const idOf = (v: string) => accounts.find((a) => a.id === v || a.name.toLowerCase() === v.toLowerCase())?.id ?? v;
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const step = s.futures?.next_step;
  const proposal: TransferProposal = { ...input, from_account_id: idOf(input.from_account_id), to_account_id: idOf(input.to_account_id) };
  if (step && (proposal.from_account_id !== step.from_account_id || proposal.to_account_id !== step.to_account_id)) {
    return {
      status: "refused",
      reply: `Not proposed. The only transfer you can offer goes from ${nameOf(step.from_account_id)} to ${nameOf(step.to_account_id)}. Restate it and ask again.`,
    };
  }
  setState({ transferProposal: { input: proposal, source, path: s.activePath ?? "plan" }, error: null });
  return {
    status: "awaiting_tap",
    reply: proposalReply(proposal, { from: nameOf(proposal.from_account_id), to: nameOf(proposal.to_account_id) }),
  };
}

/** The user tapped "Yes, schedule it" on the confirm sheet: the only place a transfer is ever scheduled. */
export async function confirmTransfer(): Promise<TransferResponse | null> {
  const proposal = getState().transferProposal;
  if (!proposal || getState().transferPending) return null;
  const customer = getState().customer;
  setState({ transferPending: true, error: null });
  const done = tapEvent("start_transfer", proposal.input as Record<string, unknown>, proposal.path);
  try {
    const res = await api.startTransfer({ ...proposal.input, customer, confirmed: true });
    setState({ transfer: res, transferPending: false, transferProposal: null });
    done({ phase: "ok", result: res, reply: res.sentence });
    notifyAgent(decisionNote("confirmed", res.sentence));
    return res;
  } catch (e) {
    // Keep the sheet open so the error shows there.
    setState({ transferPending: false, error: errorText(e) });
    done({ phase: "error", error: errorText(e) });
    return null;
  }
}

/** The user tapped "Not now" (or outside the sheet). Nothing is scheduled. */
export function declineTransfer() {
  const proposal = getState().transferProposal;
  if (!proposal) return;
  setState({ transferProposal: null, error: null });
  tapEvent("start_transfer", proposal.input as Record<string, unknown>, proposal.path)({ phase: "declined" });
  // A "Start this" tap the user backs out of is between them and the screen; only tell an agent that asked.
  if (proposal.source === "voice") notifyAgent(decisionNote("declined"));
}

/** The user tapped Stop on a scheduled (simulated) transfer. */
export async function stopTransfer(): Promise<TransferResponse | null> {
  const t = getState().transfer;
  if (!t || t.status !== "scheduled" || getState().transferPending) return null;
  setState({ transferPending: true, error: null });
  const done = tapEvent("stop_transfer", { amount: t.amount, from_account_id: t.from_account_id, to_account_id: t.to_account_id, frequency: t.frequency, transfer_id: t.id });
  try {
    const res = await api.stopTransfer(getState().customer, t.id);
    setState({ transfer: res, transferPending: false });
    done({ phase: "ok", result: res, reply: res.sentence });
    notifyAgent(decisionNote("stopped", res.sentence));
    return res;
  } catch (e) {
    setState({ transferPending: false, error: errorText(e) });
    done({ phase: "error", error: errorText(e) });
    return null;
  }
}

let noticeId = 0;
/** Queue a note for the live agent (VoiceSession sends it as a contextual update if a session is live). */
function notifyAgent(text: string) {
  setState({ transferNotice: { id: ++noticeId, text } });
}

let tapId = 0;
/** Log a tapped action in the activity panel, the same way the agent's tool calls are logged. */
function tapEvent(name: ToolEventName, params: Record<string, unknown>, onPath?: PathId) {
  const id = `tap_${++tapId}`;
  const t0 = Date.now();
  const path = name === "update_plan" ? "plan" : (onPath ?? getState().activePath ?? "plan");
  recordToolEvent({ id, name, path, phase: "called", params, at: t0, source: "tap" });
  return (e: Pick<ToolEvent, "phase"> & Partial<ToolEvent>) =>
    recordToolEvent({ id, name, path, params, at: Date.now(), ms: Date.now() - t0, source: "tap", ...e });
}

/** Pick how the future self talks. `auto` is the app's own choice (e.g. no ElevenLabs key -> saved answers). */
export function setVoiceMode(mode: VoiceMode, auto = false) {
  if (auto && getState().voiceModeChosen) return;
  setState({ voiceMode: mode, ...(auto ? {} : { voiceModeChosen: true }) });
}

/** Answer the two setup questions; the score and futures re-score, so reload everything. */
export async function answerSetup(setup: import("./api").SetupAnswers) {
  const customer = getState().customer;
  await api.setup(customer, setup);
  await loadCustomer(customer);
}

/** Open the "show the math" sheet for one number. */
export function openMath(metric: Metric) {
  setState({ mathMetric: metric });
}

export function closeMath() {
  setState({ mathMetric: null });
}

let highlightTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Make the on-screen number with this `Metric.id` glow, switching to its
 * screen and scrolling it into view. Returns whether it was found.
 * Every rendered Metric carries `data-metric-id="<id>"` (see `MetricValue`).
 */
export function highlightMetric(metricId: string, durationMs = 3000): { ok: boolean; metricId: string } {
  const screen = screenForMetric(metricId);
  // Never leave the screen mid-call: switching screens would unmount the live voice session.
  const inCall = getState().voiceStatus === "connected" || getState().voiceStatus === "connecting";
  if (screen && getState().screen !== screen && !inCall) setState({ screen });
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
  const { voiceMode, voiceModeChosen } = getState();
  setState({ ...initialState, customer, voiceMode, voiceModeChosen });
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
