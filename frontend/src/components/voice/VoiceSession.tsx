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
import { REPLY, toTransferInput, toUpdatePlanInput, transferReply, updatePlanReply } from "./toolReplies";
import type { Caption, ToolEvent, VoiceSessionProps, VoiceStatus, VoiceToolName } from "./types";
import { Waveform } from "./Waveform";

type SessionMode = "voice" | "text";

const PATH_LABEL: Record<PathId, string> = { same_path: "Same path", plan: "With a plan" };

let idCounter = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export function VoiceSession(props: VoiceSessionProps) {
  const { path } = props;
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [activeMode, setActiveMode] = useState<SessionMode | null>(null);
  const [pushToTalk, setPushToTalk] = useState(props.defaultPushToTalk ?? false);
  const [micMuted, setMicMuted] = useState(props.defaultPushToTalk ?? false);

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
    <ConversationProvider key={path} isMuted={micMuted} onMutedChange={setMicMuted}>
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
};

function VoiceSessionInner({
  path,
  factSheet,
  tools,
  onToolEvent,
  onStatusChange,
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
}: InnerProps) {
  const controls = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();

  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const [toolsRunning, setToolsRunning] = useState(0);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<SessionMode | null>(null);

  // Latest props for callbacks that outlive renders.
  const latest = useRef({ path, factSheet, tools, onToolEvent });
  useEffect(() => {
    latest.current = { path, factSheet, tools, onToolEvent };
  });
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
        pushCaption({ role: "user", text: message });
        return;
      }
      setCaptions((list) => {
        const last = list[list.length - 1];
        const streamedId = streamedIdRef.current;
        streamedIdRef.current = null;
        if (last && last.role === "agent" && (last.live || last.id === streamedId)) {
          return [...list.slice(0, -1), { ...last, text: message, live: false }];
        }
        return [...list, { id: nextId("cap"), role: "agent", path, text: message }];
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
          return [...list.slice(0, -1), { ...last, live: false }];
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
          const res = await latest.current.tools.startTransfer(input);
          return { phase: "ok", reply: transferReply(res), result: res };
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
      const fs = latest.current.factSheet;
      controls.startSession({
        signedUrl,
        connectionType: "websocket",
        textOnly: m === "text",
        dynamicVariables: {
          path: latest.current.path,
          fact_sheet: fs.text,
          opening_line: fs.opening_line,
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
    [clientTools, controls, onActiveModeChange, onAgentChatResponsePart, onMessage, signedUrlEndpoint],
  );

  const end = useCallback(() => {
    userEndedRef.current = true;
    controls.endSession();
    onActiveModeChange(null);
    setMode(null);
  }, [controls, onActiveModeChange]);

  // Start the other future right after a path switch, if one was live.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    const t = setTimeout(() => void begin(autoStart), 0);
    return () => {
      clearTimeout(t);
      autoStarted.current = false;
    };
  }, [autoStart, begin]);

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
    if (connected) controls.sendUserMessage(text);
    else if (!connecting) void begin("text", text);
  };

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
        className="h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[15px] leading-snug"
        aria-live="polite"
        aria-label="Live captions"
      >
        {captions.length === 0 ? (
          <p className="text-slate-400">Captions appear here as you talk.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {captions.map((c) =>
              c.role === "system" ? (
                <li key={c.id} className="text-center text-xs uppercase tracking-wide text-slate-400">
                  {c.text}
                </li>
              ) : (
                <li key={c.id} className={c.role === "user" ? "self-end text-right" : "self-start"}>
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {c.role === "user" ? (c.typed ? "You (typed)" : "You") : `Maya 2031 · ${PATH_LABEL[c.path]}`}
                  </span>
                  <span
                    className={`inline-block rounded-2xl px-3 py-2 ${
                      c.role === "user" ? "bg-[#1b2a4a] text-white" : "bg-white text-[#1b2a4a] shadow-sm"
                    } ${c.live ? "opacity-80" : ""}`}
                  >
                    {c.text}
                    {c.live && <span className="ml-1 animate-pulse">▍</span>}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {toolsRunning > 0 && (
        <p className="text-center text-sm italic text-orange-600" role="status">
          Okay, let me think back…
        </p>
      )}

      {/* Big mic button + waveform */}
      <div className="flex flex-col items-center gap-2">
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
          className={`relative flex h-24 w-24 touch-none select-none items-center justify-center rounded-full text-white shadow-lg transition ${
            listening ? "bg-orange-500 ring-8 ring-orange-200" : voiceLive ? "bg-orange-400" : "bg-[#1b2a4a]"
          } ${connecting ? "opacity-60" : "hover:scale-105 active:scale-95"}`}
        >
          <MicIcon muted={voiceLive && micMuted} />
        </button>
        <Waveform
          getData={getWave}
          active={voiceLive && (isSpeaking || !micMuted)}
          color={isSpeaking ? "#1b2a4a" : "#f97316"}
          className="h-8 w-48"
        />
        <p className="text-sm text-slate-600">{micLabel}</p>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={pushToTalk} onChange={togglePushToTalk} />
          Push-to-talk (loud room)
        </label>
        {connected || connecting ? (
          <button type="button" onClick={end} className="rounded-full border border-slate-300 px-3 py-1 text-slate-700">
            End
          </button>
        ) : dropped ? (
          <button
            type="button"
            onClick={() => void begin("voice")}
            className="rounded-full border border-orange-400 px-3 py-1 text-orange-700"
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
          className="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-2 text-[15px]"
          aria-label="Type a message"
        />
        <button
          type="submit"
          disabled={!typed.trim() || connecting}
          className="rounded-full bg-orange-500 px-4 py-2 font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {dropped && !error && <p className="text-sm text-amber-700">The call dropped. Captions are kept; tap Reconnect.</p>}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      {muted && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
