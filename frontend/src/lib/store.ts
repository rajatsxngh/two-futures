/**
 * Shared app state for the phone screens.
 *
 * A tiny external store (no extra dependency). Screens read it with `useApp`,
 * and the plain functions in `actions.ts` write to it. Keeping writes outside
 * React is what lets the voice agent (M8) call the same functions as client
 * tools without touching any component.
 */
import { useSyncExternalStore } from "react";
import type {
  CustomerId,
  Metric,
  ForecastResponse,
  FuturesResponse,
  HealthResponse,
  PathId,
  ProfileResponse,
  TransferResponse,
  UpdatePlanResponse,
} from "./api";
import type { ToolEvent, TransferProposal, VoiceStatus } from "@/components/voice/types";

export type Screen = "today" | "forecast" | "futures" | "next";

export type AskedQuestion = { path: PathId; text: string; at: number };

/** A typed question waiting to be sent into the voice session (id changes per question). */
export type QueuedQuestion = { id: number; text: string; path: PathId };

export type AppState = {
  customer: CustomerId;
  screen: Screen;
  loading: boolean;
  error: string | null;
  profile: ProfileResponse | null;
  health: HealthResponse | null;
  forecast: ForecastResponse | null;
  futures: FuturesResponse | null;
  /** Latest what-if result for the plan path (null = untouched plan). */
  whatIf: UpdatePlanResponse | null;
  whatIfPending: boolean;
  whatIfDrawerOpen: boolean;
  /** The latest scheduled (or stopped) simulated transfer. */
  transfer: TransferResponse | null;
  transferPending: boolean;
  /** A transfer waiting for the user's tap on the "Confirm your transfer" sheet (shown over any screen). */
  transferProposal: TransferProposalState | null;
  /** The user's latest tap on the sheet or Stop, for the live agent to hear about (id changes per tap). */
  transferNotice: { id: number; text: string } | null;
  /** Metric id currently glowing (highlight_metric). */
  highlighted: string | null;
  /** Today: the 8 indicator tiles are open (drill-down from the score). */
  showIndicators: boolean;
  /** Which future self is selected on Two Futures (the voice lane starts that path's session). */
  activePath: PathId | null;
  /** Typed questions to a future self (also sent into the voice session). */
  questions: AskedQuestion[];
  /** Next question for the voice session to send; cleared once sent. */
  voiceQueue: QueuedQuestion | null;
  /** "Ask both": the question still to be asked of the plan path once the same path answers. */
  askBothPending: string | null;
  voiceStatus: VoiceStatus;
  /** Every agent tool call and outcome, newest last (the M9 activity panel reads this). */
  toolEvents: ToolEvent[];
  /** The number whose "show the math" sheet is open. */
  mathMetric: Metric | null;
  /** How the future self talks: live ElevenLabs voice, ElevenLabs text, or offline saved answers. */
  voiceMode: VoiceMode;
  /** True once someone picked a mode by hand (stops the automatic switch to saved answers). */
  voiceModeChosen: boolean;
};

export type VoiceMode = "live" | "text" | "saved";

export type TransferProposalState = {
  input: TransferProposal;
  /** Who opened the sheet: the user's own tap on "Start this", or an agent (voice, text or saved). */
  source: "tap" | "voice";
  path: PathId;
};

export const initialState: AppState = {
  customer: "maya",
  screen: "today",
  loading: false,
  error: null,
  profile: null,
  health: null,
  forecast: null,
  futures: null,
  whatIf: null,
  whatIfPending: false,
  whatIfDrawerOpen: false,
  transfer: null,
  transferPending: false,
  transferProposal: null,
  transferNotice: null,
  highlighted: null,
  showIndicators: false,
  activePath: null,
  questions: [],
  voiceQueue: null,
  askBothPending: null,
  voiceStatus: "idle",
  toolEvents: [],
  mathMetric: null,
  voiceMode: "live",
  voiceModeChosen: false,
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read one slice of app state. The selector must return an existing reference (no new objects). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initialState),
  );
}
