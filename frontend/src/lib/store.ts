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
  ForecastResponse,
  FuturesResponse,
  HealthResponse,
  PathId,
  ProfileResponse,
  TransferResponse,
  UpdatePlanResponse,
} from "./api";

export type Screen = "today" | "forecast" | "futures" | "next";

export type AskedQuestion = { path: PathId; text: string; at: number };

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
  transfer: TransferResponse | null;
  transferPending: boolean;
  /** Metric id currently glowing (highlight_metric). */
  highlighted: string | null;
  /** Today: the 8 indicator tiles are open (drill-down from the score). */
  showIndicators: boolean;
  /** Which future self is selected on Two Futures (the voice lane starts that path's session). */
  activePath: PathId | null;
  /** Typed questions to a future self. The voice lane replaces this with a real session. */
  questions: AskedQuestion[];
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
  highlighted: null,
  showIndicators: false,
  activePath: null,
  questions: [],
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
