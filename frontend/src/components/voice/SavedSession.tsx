"use client";

/**
 * Saved-answers session (F8): same look and props as VoiceSession, but the
 * replies come from `savedAgent` (offline, engine-grounded) and are read
 * aloud with the browser's built-in speech voice. Use it when the internet or
 * ElevenLabs is down: the main demo path still runs.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PathId } from "@/lib/api";
import { getState } from "@/lib/store";
import { newMemory, savedReply, type SavedMemory } from "./savedAgent";
import type { Caption, VoiceSessionProps } from "./types";

const PATH_LABEL: Record<PathId, string> = { same_path: "Same path", plan: "With a plan" };

const CHIPS: Record<PathId, string[]> = {
  same_path: ["Was buying the car worth it?", "How much is in my IRA?", "What if I take the Austin job?", "Are you real?"],
  plan: [
    "Was buying the car worth it?",
    "What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
    "What's my next step?",
    "Yes",
  ],
};

let idc = 0;
const cid = () => `cap_saved_${(idc++).toString(36)}`;

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices().filter((v) => v.lang.startsWith("en"));
  u.voice = voices.find((v) => /zira|samantha|jenny|aria|female/i.test(v.name)) ?? voices[0] ?? null;
  u.rate = 1.02;
  synth.speak(u);
}

export function SavedSession({
  path,
  factSheet,
  tools,
  onToolEvent,
  onStatusChange,
  queued,
  onQueuedSent,
  onAgentReply,
  className,
}: VoiceSessionProps) {
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [aloud, setAloud] = useState(true);
  const memories = useRef<Record<PathId, SavedMemory>>({ same_path: newMemory(), plan: newMemory() });
  const latest = useRef({ path, tools, onToolEvent, onAgentReply, aloud });
  useEffect(() => {
    latest.current = { path, tools, onToolEvent, onAgentReply, aloud };
  });

  // Each path opens with its own line (and a divider when switching).
  const shownPath = useRef<PathId | null>(null);
  useEffect(() => {
    const switched = shownPath.current !== null && shownPath.current !== path;
    shownPath.current = path;
    const t = setTimeout(() => {
      setCaptions((c) => [
        ...c,
        ...(switched ? [{ id: cid(), role: "system" as const, path, text: `Switched to ${PATH_LABEL[path]}` }] : []),
        { id: cid(), role: "agent" as const, path, text: factSheet.opening_line },
      ]);
      if (latest.current.aloud) speak(factSheet.opening_line);
    }, 0);
    return () => clearTimeout(t);
    // The opening line belongs to the path, not to each fact-sheet refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    onStatusChange?.("connected");
    return () => {
      onStatusChange?.("idle");
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [onStatusChange]);

  const send = useCallback(async (text: string, typedIn = true) => {
    const q = text.trim();
    if (!q) return;
    const p = latest.current.path;
    setCaptions((c) => [...c, { id: cid(), role: "user", path: p, text: q, typed: typedIn }]);
    setBusy(true);
    try {
      const { futures, transfer } = getState();
      if (!futures) throw new Error("No futures loaded");
      const { reply } = await savedReply(q, {
        path: p,
        futures,
        scheduled: transfer?.status === "scheduled",
        tools: latest.current.tools,
        emit: latest.current.onToolEvent,
        memory: memories.current[p],
      });
      setCaptions((c) => [...c, { id: cid(), role: "agent", path: p, text: reply }]);
      if (latest.current.aloud) speak(reply);
      latest.current.onAgentReply?.(p, reply);
    } catch {
      setCaptions((c) => [...c, { id: cid(), role: "agent", path: p, text: "That part is fuzzy for me. Try again?" }]);
    } finally {
      setBusy(false);
    }
  }, []);

  // Questions typed on a card, or from "Ask both".
  const sentQueue = useRef<number | null>(null);
  useEffect(() => {
    if (!queued || sentQueue.current === queued.id) return;
    const { id, text } = queued;
    const t = setTimeout(() => {
      if (sentQueue.current === id) return;
      sentQueue.current = id;
      onQueuedSent?.(id);
      void send(text);
    }, 0);
    return () => clearTimeout(t);
  }, [queued, onQueuedSent, send]);

  const captionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions, busy]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = typed;
    setTyped("");
    void send(text);
  };

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      <div
        ref={captionsRef}
        className="phone-scroll h-56 overflow-y-auto rounded-[22px] border border-white/5 bg-black/30 p-3.5 text-sm leading-[1.42]"
        aria-live="polite"
        aria-label="Live captions"
      >
        <ul className="flex flex-col gap-3">
          {captions.map((c) =>
            c.role === "system" ? (
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
                  }`}
                >
                  {c.text}
                </span>
              </li>
            ),
          )}
        </ul>
      </div>
      {busy && (
        <p className="text-center text-sm italic text-ember-text" role="status">
          Okay, let me think back…
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {CHIPS[path].map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => void send(q)}
            className="min-h-11 max-w-full truncate rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-xs font-medium text-snow transition hover:border-ember/50 hover:bg-white/10 disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type to her…"
          className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm text-snow placeholder:text-smoke focus:outline-none focus:ring-2 focus:ring-ember/50"
          aria-label="Type a message"
        />
        <button
          type="submit"
          disabled={!typed.trim() || busy}
          className="h-11 shrink-0 rounded-full bg-ember px-[18px] text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      </form>
      <label className="flex h-11 cursor-pointer items-center gap-2.5 text-[13px] text-fog">
        <input type="checkbox" checked={aloud} onChange={(e) => setAloud(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden
          className="relative h-6 w-10 shrink-0 rounded-full bg-white/[0.14] transition after:absolute after:left-[3px] after:top-[3px] after:h-[18px] after:w-[18px] after:rounded-full after:bg-snow after:transition peer-checked:bg-ember peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ember/60"
        />
        Read answers aloud (built-in voice, works offline)
      </label>
    </div>
  );
}
