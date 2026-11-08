"use client";

/**
 * Future Maya voice session (M8 build half).
 *
 * - One ElevenLabs agent; this component starts it with dynamic variables
 *   `path`, `fact_sheet` and `opening_line` from the engine's FactSheet.
 * - Changing `path` ends the session and starts a new one on the other path
 *   (the provider is keyed by path). Same agent, so same voice.
 * - Live captions are always on and survive path switches and drops.
 * - Big mic button with a waveform; mute doubles as push-to-talk.
 * - Typing works in the same session (or starts a text-only one if the mic
 *   isn't available).
 * - Client tools call the functions passed in `tools`, so the wire step (M8)
 *   can hand over the screens lane's updatePlan / startTransfer / highlightMetric.
 */
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
  type HookOptions,
} from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { PathId } from "@/lib/api";
import { REPLY, toTransferInput, toUpdatePlanInput, updatePlanReply } from "./toolReplies";
import type { Caption, ToolEvent, VoiceSessionProps, VoiceStatus, VoiceToolName } from "./types";
import { Waveform } from "./Waveform";

type SessionMode = "voice" | "text";

const PATH_LABEL: Record<PathId, string> = { same_path: "Same path", plan: "With a plan" };

let idCounter = 0;

/**
 * The agent's expressive voice can add audio tags like "[sad]" or "[laughs]". They shape how she sounds,
 * so they stay in what she says, but captions are for reading: hide them there.
 */
export function stripVoiceTags(text: string): string {
  return text.replace(/\[[^\]\n]{1,30}\]\s*/g, "").trimStart();
}

/** Streamed parts and the final message can both arrive, in either order: never show the same line twice in a row. */
function collapse(list: Caption[]): Caption[] {
  const n = list.length;
  if (n < 2) return list;
  const a = list[n - 2];
  const b = list[n - 1];
  if (a.role === "agent" && b.role === "agent" && a.path === b.path && !b.live && a.text.trim() === b.text.trim()) {
    return [...list.slice(0, n - 2), { ...a, live: false }];
  }
  return list;
}
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export function VoiceSession(props: VoiceSessionProps) {
  const { path } = props;
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [activeMode, setActiveMode] = useState<SessionMode | null>(null);
  const [pushToTalk, setPushToTalk] = useState(props.defaultPushToTalk ?? false);
  const [micMuted, setMicMuted] = useState(props.defaultPushToTalk ?? false);
  // The SDK mutes the mic whenever isMuted is a boolean, and a text session throws on that.
  // So text sessions get no isMuted at all; the inner part reports its mode before connecting.
  const [startingMode, setStartingMode] = useState<SessionMode | null>(null);
  const textSession = props.hideMic || startingMode === "text";

  // Path switch: remember whether a session was live so the new provider
  // (keyed by path) starts the other future right away.
  const [shownPath, setShownPath] = useState(path);
  const [autoStart, setAutoStart] = useState<SessionMode | null>(null);
  if (path !== shownPath) {
    setShownPath(path);
    setAutoStart(activeMode);
    setActiveMode(null);
    setMicMuted(pushToTalk);
    setCaptions((c) => [
      ...c,
      { id: nextId("sys"), role: "system", path, text: `Switched to ${PATH_LABEL[path]}` },
    ]);
  }

  return (
    <ConversationProvider key={path} isMuted={textSession ? undefined : micMuted} onMutedChange={setMicMuted}>
      <VoiceSessionInner
        {...props}
        captions={captions}
        setCaptions={setCaptions}
        autoStart={autoStart}
        onActiveModeChange={setActiveMode}
        pushToTalk={pushToTalk}
        setPushToTalk={setPushToTalk}
        micMuted={micMuted}
        setMicMuted={setMicMuted}
        onBeginMode={setStartingMode}
      />
    </ConversationProvider>
  );
}

type InnerProps = VoiceSessionProps & {
  captions: Caption[];
  setCaptions: React.Dispatch<React.SetStateAction<Caption[]>>;
  autoStart: SessionMode | null;
  onActiveModeChange: (m: SessionMode | null) => void;
  pushToTalk: boolean;
  setPushToTalk: (v: boolean) => void;
  micMuted: boolean;
  setMicMuted: (v: boolean) => void;
  onBeginMode: (m: SessionMode) => void;
};

function VoiceSessionInner({
  path,
  factSheet,
  tools,
  onToolEvent,
  onStatusChange,
  queued,
  notice,
  onQueuedSent,
  onAgentReply,
  onError,
  hideMic,
  signedUrlEndpoint = "/api/voice/signed-url",
  className,
  captions,
  setCaptions,
  autoStart,
  onActiveModeChange,
  pushToTalk,
  setPushToTalk,
  micMuted,
  setMicMuted,
  onBeginMode,
}: InnerProps) {
  const controls = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();

  const [fetching, setFetching] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  const setError = useCallback((message: string | null) => {
    setErrorState(message);
    if (message) onErrorRef.current?.(message);
  }, []);
  const [dropped, setDropped] = useState(false);
  const [toolsRunning, setToolsRunning] = useState(0);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<SessionMode | null>(null);

  // Latest props for callbacks that outlive renders.
  const latest = useRef({ path, factSheet, tools, onToolEvent, onAgentReply });
  useEffect(() => {
    latest.current = { path, factSheet, tools, onToolEvent, onAgentReply };
  });
  // True after the user says or types something, until the agent's next finished reply.
  const awaitingReplyRef = useRef(false);
  // The id of the last queued question already sent (or handed to a starting session).
  const sentQueue = useRef<number | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const streamedIdRef = useRef<string | null>(null);
  const userEndedRef = useRef(false);
  // Late callbacks from a session whose provider already unmounted (path switch) must not touch shared state.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connected = status === "connected";
  const connecting = fetching || status === "connecting";

  // ---- captions -----------------------------------------------------------
  const pushCaption = useCallback(
    (c: Omit<Caption, "id" | "path">) => setCaptions((list) => [...list, { ...c, id: nextId("cap"), path }]),
    [path, setCaptions],
  );

  const onMessage: NonNullable<HookOptions["onMessage"]> = useCallback(
    ({ message, role }) => {
      if (!message) return;
      if (role === "user") {
        awaitingReplyRef.current = true;
        pushCaption({ role: "user", text: message });
        return;
      }
      // Report a finished answer (her opening line doesn't count as one).
      const opening = latest.current.factSheet.opening_line.slice(0, 24);
      const isOpening = opening.length > 0 && message.trim().startsWith(opening);
      if (!isOpening && awaitingReplyRef.current) {
        awaitingReplyRef.current = false;
        latest.current.onAgentReply?.(latest.current.path, message);
      }
      setCaptions((list) => {
        const last = list[list.length - 1];
        const streamedId = streamedIdRef.current;
        streamedIdRef.current = null;
        if (last && last.role === "agent" && (last.live || last.id === streamedId)) {
          return collapse([...list.slice(0, -1), { ...last, text: message, live: false }]);
        }
        return collapse([...list, { id: nextId("cap"), role: "agent", path, text: message }]);
      });
    },
    [path, pushCaption, setCaptions],
  );

  const onAgentChatResponsePart: NonNullable<HookOptions["onAgentChatResponsePart"]> = useCallback(
    (part) => {
      if (part.type === "start") {
        streamedIdRef.current = null;
        setCaptions((list) => [...list, { id: nextId("cap"), role: "agent", path, text: part.text ?? "", live: true }]);
      } else if (part.type === "delta") {
        setCaptions((list) => {
          const last = list[list.length - 1];
          if (!last || !last.live) return [...list, { id: nextId("cap"), role: "agent", path, text: part.text, live: true }];
          return [...list.slice(0, -1), { ...last, text: last.text + part.text }];
        });
      } else if (part.type === "stop") {
        setCaptions((list) => {
          const last = list[list.length - 1];
          if (!last || !last.live) return list;
          streamedIdRef.current = last.id;
          return collapse([...list.slice(0, -1), { ...last, live: false }]);
        });
      }
    },
    [path, setCaptions],
  );

  // ---- client tools -------------------------------------------------------
  const runTool = useCallback(
    async (
      name: VoiceToolName,
      params: Record<string, unknown>,
      body: () => Promise<{ phase: ToolEvent["phase"]; reply?: string; result?: unknown }>,
      waits = true,
    ): Promise<string | undefined> => {
      const id = nextId("tool");
      const t0 = performance.now();
      const p = latest.current.path;
      const emit = (e: Partial<ToolEvent> & Pick<ToolEvent, "phase">) =>
        latest.current.onToolEvent?.({ id, name, path: p, params, at: Date.now(), ...e });
      emit({ phase: "called" });
      if (waits) setToolsRunning((n) => n + 1);
      try {
        const out = await body();
        emit({ ...out, ms: Math.round(performance.now() - t0) });
        return out.reply;
      } catch (e) {
        emit({ phase: "error", error: e instanceof Error ? e.message : String(e), reply: REPLY.fuzzy, ms: Math.round(performance.now() - t0) });
        return REPLY.fuzzy;
      } finally {
        if (waits) setToolsRunning((n) => Math.max(0, n - 1));
      }
    },
    [],
  );

  const clientTools = useCallback(
    () => ({
      update_plan: (params: Record<string, unknown>) =>
        runTool("update_plan", params, async () => {
          if (latest.current.path !== "plan") return { phase: "refused", reply: REPLY.notPlanPath };
          const res = await latest.current.tools.updatePlan(toUpdatePlanInput(params));
          return { phase: "ok", reply: updatePlanReply(res), result: res };
        }),
      start_transfer: (params: Record<string, unknown>) =>
        runTool("start_transfer", params, async () => {
          const input = toTransferInput(params);
          if (!input) return { phase: "refused", reply: REPLY.needsYes };
          // Agents only propose: this opens the on-screen confirm sheet. Nothing moves until the user taps Yes.
          const res = await latest.current.tools.proposeTransfer(input);
          return { phase: res.status === "awaiting_tap" ? "proposed" : "refused", reply: res.reply, result: res };
        }),
      highlight_metric: (params: Record<string, unknown>) => {
        void runTool(
          "highlight_metric",
          params,
          async () => {
            const metricId = typeof params.metric_id === "string" ? params.metric_id : "";
            if (!metricId) return { phase: "refused" };
            latest.current.tools.highlightMetric?.(metricId);
            return { phase: "ok" };
          },
          false,
        );
      },
    }),
    [runTool],
  );

  // ---- session lifecycle --------------------------------------------------
  const begin = useCallback(
    async (m: SessionMode, firstText?: string) => {
      setError(null);
      setDropped(false);
      userEndedRef.current = false;
      pendingTextRef.current = firstText ?? null;
      setFetching(true);
      let signedUrl: string;
      try {
        const res = await fetch(signedUrlEndpoint, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { signedUrl?: string; detail?: string };
        if (!res.ok || !body.signedUrl) throw new Error(body.detail ?? `Signed URL request failed (${res.status})`);
        signedUrl = body.signedUrl;
      } catch (e) {
        setFetching(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      setFetching(false);
      setMode(m);
      onBeginMode(m);
      const fs = latest.current.factSheet;
      controls.startSession({
        signedUrl,
        connectionType: "websocket",
        textOnly: m === "text",
        dynamicVariables: {
          path: latest.current.path,
          fact_sheet: fs.text,
          // Started by a question (Ask both, a card's "Ask me"): skip the greeting and answer straight away.
          // An empty first message makes the agent wait for the user's message instead of greeting.
          opening_line: firstText ? "" : fs.opening_line,
        },
        clientTools: clientTools(),
        onMessage,
        onAgentChatResponsePart,
        onConnect: () => {
          if (!mountedRef.current) return;
          onActiveModeChange(m);
          const text = pendingTextRef.current;
          pendingTextRef.current = null;
          if (text) controls.sendUserMessage(text);
        },
        onDisconnect: (details) => {
          if (!mountedRef.current) return;
          onActiveModeChange(null);
          if (details.reason !== "user" && !userEndedRef.current) setDropped(true);
        },
        onError: (message) => {
          const micBlocked = /permission|notallowed|microphone|getusermedia/i.test(message);
          setError(micBlocked ? "Microphone blocked. You can type instead; it's the same agent." : message);
        },
      });
    },
    [clientTools, controls, onActiveModeChange, onAgentChatResponsePart, onBeginMode, onMessage, setError, signedUrlEndpoint],
  );

  const end = useCallback(() => {
    userEndedRef.current = true;
    controls.endSession();
    onActiveModeChange(null);
    setMode(null);
  }, [controls, onActiveModeChange]);

  // Start the other future right after a path switch, if one was live. If a question is already
  // waiting for this path ("Ask both"), start with it: no greeting, straight to the answer.
  const autoStarted = useRef(false);
  const queuedRef = useRef(queued);
  useEffect(() => {
    queuedRef.current = queued;
  });
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    const t = setTimeout(() => {
      const q = queuedRef.current;
      if (q && sentQueue.current !== q.id) {
        sentQueue.current = q.id;
        pushCaption({ role: "user", text: q.text, typed: true });
        awaitingReplyRef.current = true;
        void begin(autoStart, q.text);
        onQueuedSent?.(q.id);
      } else {
        void begin(autoStart);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      autoStarted.current = false;
    };
  }, [autoStart, begin, pushCaption, onQueuedSent]);

  useEffect(() => {
    const s: VoiceStatus = status === "error" ? "error" : connecting ? "connecting" : connected ? "connected" : "idle";
    onStatusChange?.(s);
  }, [status, connecting, connected, onStatusChange]);

  // ---- mic / push-to-talk -------------------------------------------------
  const voiceLive = connected && mode === "voice";
  const holdStart = () => {
    if (voiceLive && pushToTalk) setMicMuted(false);
  };
  const holdEnd = () => {
    if (voiceLive && pushToTalk) setMicMuted(true);
  };
  const onMicClick = () => {
    if (connecting) return;
    if (!connected) return void begin("voice");
    if (mode === "text") {
      end();
      setTimeout(() => void begin("voice"), 0);
      return;
    }
    if (!pushToTalk) setMicMuted(!micMuted);
  };
  const onMicKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!voiceLive || !pushToTalk || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    if (e.type === "keydown" && !e.repeat) setMicMuted(false);
    if (e.type === "keyup") setMicMuted(true);
  };
  const togglePushToTalk = () => {
    const next = !pushToTalk;
    setPushToTalk(next);
    setMicMuted(next);
  };

  const getWave = useCallback(() => {
    try {
      return isSpeaking ? controls.getOutputByteFrequencyData() : controls.getInputByteFrequencyData();
    } catch {
      return undefined;
    }
  }, [controls, isSpeaking]);

  // ---- typed fallback -----------------------------------------------------
  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    pushCaption({ role: "user", text, typed: true });
    awaitingReplyRef.current = true;
    if (connected) controls.sendUserMessage(text);
    else if (!connecting) void begin("text", text);
  };

  // ---- queued questions (typed on a card, or "Ask both") ------------------
  // Right after a path switch the auto-start owns the first connection; wait for it.
  const waitForAuto = useRef(autoStart !== null);
  useEffect(() => {
    if (connected || error) waitForAuto.current = false;
  }, [connected, error]);
  useEffect(() => {
    if (!queued || sentQueue.current === queued.id) return;
    if (!connected && (connecting || waitForAuto.current)) return;
    const { id, text } = queued;
    // Deferred a tick (like the auto-start above) so state updates don't run inside the effect body.
    // Marked sent only when it actually goes, so a re-run that cancels this timer retries it.
    const t = setTimeout(() => {
      if (sentQueue.current === id) return;
      sentQueue.current = id;
      pushCaption({ role: "user", text, typed: true });
      awaitingReplyRef.current = true;
      if (connected) controls.sendUserMessage(text);
      // Live voice mode answers asked questions out loud ("same voice, two lives"); Text mode stays typed.
      else void begin(mode ?? (hideMic ? "text" : "voice"), text);
      onQueuedSent?.(id);
    }, 0);
    return () => clearTimeout(t);
  }, [queued, connected, connecting, controls, begin, mode, hideMic, pushCaption, onQueuedSent]);

  // ---- what the user tapped (confirm sheet, Stop): tell the agent quietly --
  const sentNotice = useRef<number | null>(notice?.id ?? null);
  useEffect(() => {
    if (!notice || sentNotice.current === notice.id) return;
    sentNotice.current = notice.id;
    // Only live sessions hear it; a session started later gets the current state from the screen instead.
    if (!connected) return;
    try {
      controls.sendContextualUpdate(notice.text);
    } catch {
      // The session ended between the tap and now; the agent will see the new state next time.
    }
  }, [notice, connected, controls]);

  // Keep the newest caption in view.
  const captionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions]);

  const listening = voiceLive && !micMuted && !isSpeaking;
  const micLabel = connecting
    ? "Connecting…"
    : !connected
      ? "Tap to talk to 2031"
      : mode === "text"
        ? "Switch to voice"
        : pushToTalk
          ? micMuted
            ? "Hold to talk"
            : "Listening…"
          : micMuted
            ? "Muted · tap to unmute"
            : isSpeaking
              ? "She's talking…"
              : "Listening… tap to mute";

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      {/* Captions: always on */}
      <div
        ref={captionsRef}
        className="phone-scroll h-56 overflow-y-auto rounded-[22px] border border-white/5 bg-black/30 p-3.5 text-sm leading-[1.42]"
        aria-live="polite"
        aria-label="Live captions"
      >
        {captions.length === 0 ? (
          <p className="text-smoke">Captions appear here as you talk.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {captions.map((c) =>
              // A line that was only an expressive tag ("[warmly]") has nothing to read: skip it.
              c.role === "agent" && !c.live && !stripVoiceTags(c.text).trim() ? null : c.role === "system" ? (
                <li key={c.id} className="text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] text-smoke">
                  {c.text}
                </li>
              ) : (
                <li key={c.id} className={`flex flex-col gap-1.5 ${c.role === "user" ? "items-end text-right" : "items-start"}`}>
                  <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-smoke">
                    {c.role === "user" ? (c.typed ? "You (typed)" : "You") : `Maya 2031 · ${PATH_LABEL[c.path]}`}
                  </span>
                  <span
                    className={`inline-block max-w-[92%] px-3 py-2.5 text-left ${
                      c.role === "user" ? "rounded-[18px_18px_6px_18px] bg-snow text-ink" : "rounded-[18px_18px_18px_6px] bg-white/[0.08] text-snow"
                    } ${c.live ? "opacity-80" : ""}`}
                  >
                    {c.role === "agent" ? stripVoiceTags(c.text) : c.text}
                    {c.live && <span className="ml-1 animate-pulse">▍</span>}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {toolsRunning > 0 && (
        <p className="text-center text-sm italic text-ember-text" role="status">
          Okay, let me think back…
        </p>
      )}

      {/* Mic orb, with the waveform on both sides */}
      <div className={`flex flex-col items-center gap-2.5 ${hideMic ? "hidden" : ""}`}>
        <div className="flex items-center justify-center gap-4">
          <Waveform
            getData={getWave}
            active={voiceLive && (isSpeaking || !micMuted)}
            color={isSpeaking ? "#F4F4F5" : "#FF6B1A"}
            className="h-8 w-[84px] -scale-x-100"
          />
          <button
            type="button"
            onClick={onMicClick}
            onPointerDown={holdStart}
            onPointerUp={holdEnd}
            onPointerLeave={holdEnd}
            onPointerCancel={holdEnd}
            onKeyDown={onMicKey}
            onKeyUp={onMicKey}
            disabled={connecting}
            aria-pressed={voiceLive ? !micMuted : undefined}
            aria-label={micLabel}
            className={`relative flex h-[72px] w-[72px] shrink-0 touch-none select-none items-center justify-center rounded-full transition ${
              listening
                ? "bg-[radial-gradient(circle_at_34%_28%,#ffb27e_0%,#ff6b1a_46%,#de520a_100%)] text-ink shadow-[0_0_0_7px_rgba(255,107,26,0.16),0_14px_40px_rgba(255,107,26,0.55),inset_0_1px_0_rgba(255,255,255,0.4)]"
                : voiceLive
                  ? "bg-ember text-ink shadow-[0_10px_30px_-8px_rgba(255,107,26,0.6)]"
                  : "glass-strong text-snow"
            } ${connecting ? "opacity-60" : "hover:scale-105 active:scale-95"}`}
          >
            {listening && (
              <>
                <span aria-hidden className="absolute inset-0 animate-ring rounded-full border-2 border-ember/60" />
                <span aria-hidden className="absolute inset-0 animate-ring rounded-full border-2 border-ember/60 [animation-delay:-1s]" />
              </>
            )}
            <MicIcon muted={voiceLive && micMuted} />
          </button>
          <Waveform
            getData={getWave}
            active={voiceLive && (isSpeaking || !micMuted)}
            color={isSpeaking ? "#F4F4F5" : "#FF6B1A"}
            className="h-8 w-[84px]"
          />
        </div>
        <p className="text-[13px] text-fog">{micLabel}</p>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <label className="flex h-11 cursor-pointer items-center gap-2.5 text-[13px] text-fog">
          <input type="checkbox" checked={pushToTalk} onChange={togglePushToTalk} className="peer sr-only" />
          <span
            aria-hidden
            className="relative h-6 w-10 shrink-0 rounded-full bg-white/[0.14] transition after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-snow after:transition peer-checked:bg-ember peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ember/60"
          />
          Push-to-talk (loud room)
        </label>
        {connected || connecting ? (
          <button type="button" onClick={end} className="glass h-11 rounded-full px-[18px] text-sm font-semibold text-snow transition hover:bg-white/10">
            End
          </button>
        ) : dropped ? (
          <button
            type="button"
            onClick={() => void begin("voice")}
            className="h-11 rounded-full border border-ember/60 px-[18px] text-sm font-semibold text-ember-text transition hover:bg-ember/10"
          >
            Reconnect
          </button>
        ) : null}
      </div>

      {/* Typed fallback, same agent */}
      <form onSubmit={submitTyped} className="flex gap-2">
        <input
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (connected) controls.sendUserActivity();
          }}
          placeholder={connected ? "Or type to her…" : "Type a question (starts a text chat)"}
          className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm text-snow placeholder:text-smoke focus:outline-none focus:ring-2 focus:ring-ember/50"
          aria-label="Type a message"
        />
        <button
          type="submit"
          disabled={!typed.trim() || connecting}
          className="h-11 shrink-0 rounded-full bg-ember px-[18px] text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {dropped && !error && <p className="text-[13px] text-[#fde68a]">The call dropped. Captions are kept; tap Reconnect.</p>}
      {error && (
        <p className="rounded-2xl border border-poor/30 bg-poor/10 px-3 py-2 text-[13px] leading-snug text-[#fecaca]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      {muted && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
