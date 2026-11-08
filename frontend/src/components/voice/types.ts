import type {
  FactSheet,
  PathId,
  TransferRequest,
  UpdatePlanResponse,
  WhatIfRequest,
} from "@/lib/api";

/** What the agent can send to update_plan. The app fills in `customer`. */
export type UpdatePlanInput = Omit<WhatIfRequest, "customer">;

/**
 * What the agent can propose with start_transfer. The app fills in `customer`, and `confirmed`
 * is only ever sent by the on-screen "Yes, schedule it" tap, never by an agent.
 */
export type TransferProposal = Omit<TransferRequest, "customer" | "confirmed">;

/** What proposing a transfer did. Agents never schedule: they only open the confirm sheet. */
export type ProposalResult = {
  status: "awaiting_tap" | "already_scheduled" | "refused";
  /** The string handed back to the agent. Never says the transfer is done. */
  reply: string;
};

/**
 * The app-side functions the agent's client tools call.
 * M8's wire step passes the screens lane's `updatePlan` / `proposeTransfer` /
 * `highlightMetric` here, so a voice what-if updates the same state as a tap.
 */
export interface VoiceTools {
  updatePlan: (input: UpdatePlanInput) => Promise<UpdatePlanResponse>;
  /** Opens the "Confirm your transfer" sheet. Money moves only if the user taps Yes there. */
  proposeTransfer: (input: TransferProposal) => ProposalResult | Promise<ProposalResult>;
  highlightMetric?: (metricId: string) => void;
}

export type VoiceToolName = "update_plan" | "start_transfer" | "highlight_metric";
/** Everything the activity panel logs: the agent's tools plus the user's own Stop tap. */
export type ToolEventName = VoiceToolName | "stop_transfer";

/** One client-tool call, reported to `onToolEvent` (for the activity panel in M9). */
export interface ToolEvent {
  /** Same id for the "called" event and its outcome. */
  id: string;
  name: ToolEventName;
  path: PathId;
  /** "proposed": the confirm sheet is open, waiting for a tap. "declined": the user tapped Not now. */
  phase: "called" | "ok" | "proposed" | "declined" | "refused" | "error";
  params: Record<string, unknown>;
  /** The string handed back to the agent (absent for "called" and highlight_metric). */
  reply?: string;
  /** The raw app result (UpdatePlanResponse / TransferResponse / ProposalResult), for "ok" and "proposed". */
  result?: unknown;
  error?: string;
  ms?: number;
  at: number;
  /** Who started it: the agent (default) or a tap on screen. */
  source?: "voice" | "tap";
}

export interface Caption {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  path: PathId;
  /** True while an agent line is still streaming in. */
  live?: boolean;
  typed?: boolean;
}

export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

export interface VoiceSessionProps {
  path: PathId;
  /** The fact sheet for `path` (from GET /api/futures, or the newest update_plan result). */
  factSheet: FactSheet;
  tools: VoiceTools;
  /** Every tool call and its outcome, in order. */
  onToolEvent?: (event: ToolEvent) => void;
  /** Fires on every status change, e.g. to dim other UI while connecting. */
  onStatusChange?: (status: VoiceStatus) => void;
  /** Where to get a signed URL. Defaults to the Next route `/api/voice/signed-url`. */
  signedUrlEndpoint?: string;
  /** Start push-to-talk instead of an open mic (for loud rooms). */
  defaultPushToTalk?: boolean;
  /** A question to send as if typed. Starts a text session if none is live. Send a new id for each question. */
  queued?: { id: number; text: string } | null;
  /** A note for the agent about what the user tapped (confirm sheet, Stop). Sent once per id if a session is live. */
  notice?: { id: number; text: string } | null;
  /** Called once `queued` has been sent (or handed to a starting session). */
  onQueuedSent?: (id: number) => void;
  /** Called when the agent finishes answering a user message (not for her opening line). */
  onAgentReply?: (path: PathId, text: string) => void;
  /** Called when a session can't start or fails (no key, mic blocked, network). */
  onError?: (message: string) => void;
  /** Text-only mode: hide the mic; typing starts a text session with the same agent. */
  hideMic?: boolean;
  className?: string;
}
