"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { LifeEvent, Metric, PathId, PathResult } from "@/lib/api";
import {
  agentReplied,
  askBoth,
  askFuture,
  goTo,
  highlightMetric,
  openWhatIf,
  queuedQuestionSent,
  recordToolEvent,
  selectFuture,
  setVoiceMode,
  setVoiceStatus,
  startTransfer,
  updatePlan,
  voiceFailed,
} from "@/lib/actions";
import { useApp } from "@/lib/store";
import { SavedSession, VoiceSession, type VoiceTools } from "../voice";
import type { VoiceMode } from "@/lib/store";
import { CountUp, MetricValue } from "../ui";
import { JobLossCheck } from "../JobLossCheck";

// The agent's client tools are the same functions the buttons use, so a spoken
// what-if or "yes" changes exactly the same state as a tap.
const VOICE_TOOLS: VoiceTools = {
  updatePlan: (input) => updatePlan(input, "voice"),
  startTransfer: (input) => startTransfer(input, "voice"),
  highlightMetric,
};
const PATH_LABEL: Record<PathId, string> = { same_path: "Same path", plan: "With a plan" };

export function FuturesScreen() {
  const futures = useApp((s) => s.futures)!;
  const whatIf = useApp((s) => s.whatIf);
  const planPath = whatIf?.result ?? futures.paths.plan;

  return (
    <div className="space-y-3 px-3 py-4">
      <div className="px-1">
        <h1 className="text-2xl font-semibold text-navy">Meet {futures.target_year}</h1>
        <p className="text-sm text-muted">Same you, same surprises, two paths. Tap a side to talk.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FutureSide id="same_path" path={futures.paths.same_path} year={futures.target_year} />
        <FutureSide id="plan" path={planPath} year={futures.target_year} />
      </div>

      <VoicePanel />
      <AskBoth />
      <WhatIfResult />
      <JobLossCheck />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => openWhatIf(true)}
          className="rounded-2xl border-2 border-plan/40 bg-plan-soft py-3 text-sm font-semibold text-plan hover:border-plan"
        >
          Try a what-if
        </button>
        <button onClick={() => goTo("next")} className="rounded-2xl bg-accent py-3 text-sm font-semibold text-white shadow-md shadow-accent/25 hover:bg-accent-dark">
          Your next step
        </button>
      </div>
      <p className="px-1 text-[11px] leading-snug text-muted">{futures.assumptions.slice(1).join(" ")}</p>
    </div>
  );
}

function FutureSide({ id, path, year }: { id: PathId; path: PathResult; year: number }) {
  const active = useApp((s) => s.activePath === id);
  const isPlan = id === "plan";
  const last = path.snapshots[path.snapshots.length - 1];

  return (
    <section
      onClick={() => selectFuture(id)}
      aria-label={path.label}
      className={`flex min-w-0 cursor-pointer flex-col rounded-2xl border-2 p-2.5 transition ${
        isPlan ? "border-plan/30 bg-plan-soft shadow-[0_0_28px_-6px_rgba(217,102,63,0.45)]" : "border-same/25 bg-same-soft"
      } ${active ? (isPlan ? "ring-2 ring-plan" : "ring-2 ring-same") : ""}`}
    >
      <p className={`text-center text-xs font-bold uppercase tracking-wide ${isPlan ? "text-plan" : "text-same"}`}>{path.label}</p>
      <div className="mt-1 flex justify-center">
        <Avatar warm={isPlan} />
      </div>
      <p className="text-center text-xs text-muted">
        {last ? `Age ${last.age}` : ""} · {year}
      </p>

      <div className="mt-2 space-y-2">
        {path.key_numbers.map((m) => (
          <KeyNumber key={m.id} metric={m} warm={isPlan} />
        ))}
      </div>

      <Timeline events={path.events} warm={isPlan} />
      <AskBox path={id} warm={isPlan} />
    </section>
  );
}

function KeyNumber({ metric, warm }: { metric: Metric; warm: boolean }) {
  // "6.0 months" -> big "6.0" + small "months", so the number stays 32px in a half-width column.
  const months = metric.unit === "months" ? metric.display.match(/^([\d.,-]+)\s+(.*)$/) : null;
  return (
    <div>
      <p className="text-[11px] font-medium text-muted">{metric.label}</p>
      <MetricValue metric={metric} className={`font-semibold leading-none ${warm ? "text-navy" : "text-navy/70"}`}>
        {months ? (
          <>
            <span className="text-[32px]">
              <CountUp text={months[1]} />
            </span>{" "}
            <span className="text-sm font-medium">{months[2]}</span>
          </>
        ) : (
          <span className={metric.unit === "date" ? "text-[26px]" : "text-[32px]"}>
            <CountUp text={metric.display} />
          </span>
        )}
      </MetricValue>
    </div>
  );
}

function Timeline({ events, warm }: { events: LifeEvent[]; warm: boolean }) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ol className={`mt-3 space-y-1.5 border-l-2 pl-2.5 ${warm ? "border-plan/40" : "border-same/40"}`}>
      {sorted.map((e, i) => (
        <li key={`${e.date}-${i}`} className="relative">
          <span className={`absolute -left-[15px] top-1 h-2 w-2 rounded-full ${e.shared ? "bg-navy" : warm ? "bg-plan" : "bg-same"}`} />
          <p className="text-[11px] font-semibold leading-tight text-navy">
            {e.date.slice(0, 4)} · {e.title}
            {e.shared && <span className="ml-1 rounded bg-navy/10 px-1 text-[9px] font-medium uppercase text-navy">both</span>}
          </p>
          <p className="text-[10px] leading-snug text-muted">{e.description}</p>
        </li>
      ))}
    </ol>
  );
}

function AskBox({ path, warm }: { path: PathId; warm: boolean }) {
  const [text, setText] = useState("");
  const lastQuestion = useApp((s) => {
    for (let i = s.questions.length - 1; i >= 0; i--) if (s.questions[i].path === path) return s.questions[i];
    return null;
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    askFuture(path, text);
    setText("");
  };

  return (
    <div className="mt-auto pt-3" onClick={(e) => e.stopPropagation()}>
      {lastQuestion && (
        <p className="mb-1.5 rounded-lg bg-white/70 px-2 py-1 text-[11px] leading-snug text-navy" aria-live="polite">
          <span className="font-semibold">You:</span> {lastQuestion.text}
        </p>
      )}
      <form onSubmit={submit} className="flex gap-1">
        <label className="sr-only" htmlFor={`ask-${path}`}>
          Ask this future self
        </label>
        <input
          id={`ask-${path}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => selectFuture(path)}
          placeholder="Ask me..."
          className="min-w-0 flex-1 rounded-full border border-line bg-white px-2.5 py-1.5 text-xs text-navy placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send question"
          className={`shrink-0 rounded-full p-1.5 text-white ${warm ? "bg-plan" : "bg-same"}`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M3.4 2.6a.75.75 0 0 1 .82-.1l13 6.75a.75.75 0 0 1 0 1.33l-13 6.75A.75.75 0 0 1 3.15 16.5L5 10 3.15 3.5a.75.75 0 0 1 .25-.9ZM6.3 10.75l-1.2 4.1L14.86 10 5.1 5.15l1.2 4.1H11a.75.75 0 0 1 0 1.5H6.3Z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

/** The live conversation with whichever future self is selected. */
function VoicePanel() {
  const path = useApp((s) => s.activePath);
  const sheets = useApp((s) => s.futures?.fact_sheets);
  const queue = useApp((s) => s.voiceQueue);
  const name = useApp((s) => s.profile?.customer.name ?? "You");
  const mode = useApp((s) => s.voiceMode);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/voice/signed-url?check=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { configured?: boolean }) => {
        if (!alive) return;
        setConfigured(Boolean(b.configured));
        if (!b.configured) setVoiceMode("saved", true); // no key: fall back to saved answers
      })
      .catch(() => {
        if (!alive) return;
        setConfigured(false);
        setVoiceMode("saved", true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!path || !sheets) return null;
  const warm = path === "plan";
  return (
    <section
      aria-label={`Talking to ${name} 2031`}
      className={`fade-in rounded-2xl border-2 bg-white p-3 ${warm ? "border-plan/40" : "border-same/30"}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={`text-xs font-bold uppercase tracking-wide ${warm ? "text-plan" : "text-same"}`}>
          Talking to {name} 2031 · {PATH_LABEL[path]}
        </p>
        <button onClick={() => selectFuture(null)} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:text-navy">
          Close
        </button>
      </div>
      <ModeSwitch mode={mode} />
      {configured === false && mode !== "saved" && (
        <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-snug text-amber-800">
          Live voice is off: add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to frontend/.env.local, then restart. Saved answers work without it.
        </p>
      )}
      {mode === "saved" ? (
        <SavedSession
          path={path}
          factSheet={sheets[path]}
          tools={VOICE_TOOLS}
          onToolEvent={recordToolEvent}
          onStatusChange={setVoiceStatus}
          queued={queue && queue.path === path ? queue : null}
          onQueuedSent={queuedQuestionSent}
          onAgentReply={agentReplied}
        />
      ) : (
        <VoiceSession
          key={mode}
          path={path}
          factSheet={sheets[path]}
          tools={VOICE_TOOLS}
          onToolEvent={recordToolEvent}
          onStatusChange={setVoiceStatus}
          queued={queue && queue.path === path ? queue : null}
          onQueuedSent={queuedQuestionSent}
          onAgentReply={agentReplied}
          onError={voiceFailed}
          hideMic={mode === "text"}
        />
      )}
    </section>
  );
}

const MODES: { id: VoiceMode; label: string; hint: string }[] = [
  { id: "live", label: "Live voice", hint: "ElevenLabs voice in and out" },
  { id: "text", label: "Text", hint: "Same agent, typed (mic trouble)" },
  { id: "saved", label: "Saved answers", hint: "Offline, read aloud by the browser" },
];

function ModeSwitch({ mode }: { mode: VoiceMode }) {
  return (
    <div role="radiogroup" aria-label="How she talks" className="mb-2 grid grid-cols-3 gap-1 rounded-full bg-surface p-1">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          title={m.hint}
          onClick={() => setVoiceMode(m.id)}
          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${mode === m.id ? "bg-white text-navy shadow-sm" : "text-muted hover:text-navy"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** One typed question to both futures in turn: same path first, then the plan. */
function AskBoth() {
  const [text, setText] = useState("");
  const pending = useApp((s) => s.askBothPending);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    askBoth(text);
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <label className="sr-only" htmlFor="ask-both">
        Ask both futures
      </label>
      <input
        id="ask-both"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask both, e.g. Was buying the car worth it?"
        className="min-w-0 flex-1 rounded-full border border-line bg-white px-3 py-2 text-sm text-navy placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={!text.trim() || pending !== null}
        className="shrink-0 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {pending ? "Asking…" : "Ask both"}
      </button>
    </form>
  );
}

function WhatIfResult() {
  const whatIf = useApp((s) => s.whatIf);
  const pending = useApp((s) => s.whatIfPending);
  if (pending && !whatIf) return <p className="px-1 text-sm text-muted">Working it out...</p>;
  if (!whatIf) return null;
  return (
    <div className="fade-in rounded-2xl border border-plan/30 bg-white p-3" aria-live="polite">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-plan">What-if on the plan</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {whatIf.deltas.map((d) => (
          <MetricValue key={d.id} metric={d} animate className="text-lg font-semibold text-navy" />
        ))}
      </div>
      <p className="mt-1 text-sm leading-snug text-navy/85">{whatIf.sentence}</p>
    </div>
  );
}

/** One simple illustrated avatar, used on both sides. Never a photo or an aged face. */
export function Avatar({ warm, size = 64 }: { warm: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Future you" className={warm ? "drop-shadow-[0_0_10px_rgba(239,106,26,0.45)]" : ""}>
      <circle cx="32" cy="32" r="31" fill={warm ? "#ffe2cf" : "#e4e8ee"} />
      {/* hair back */}
      <path d="M17 31c0-11 6.5-18 15-18s15 7 15 18v9H17z" fill="#3b2a24" />
      {/* shoulders (scrubs) */}
      <path d="M12 62c1.5-11 9.5-16 20-16s18.5 5 20 16z" fill={warm ? "#d9663f" : "#8792a2"} />
      <path d="M27 46l5 6 5-6" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" />
      {/* neck + face */}
      <rect x="28" y="38" width="8" height="8" rx="3" fill="#c98e6b" />
      <ellipse cx="32" cy="30" rx="11" ry="12.5" fill="#dca681" />
      {/* fringe */}
      <path d="M21 27c3-7 8-9.5 13-9.5 4.5 0 8 2.5 9 8-5-1-10-3.5-12.5-6.5-2 3.5-5.5 6.5-9.5 8z" fill="#3b2a24" />
      {/* face */}
      <circle cx="27.5" cy="31" r="1.4" fill="#2a1d18" />
      <circle cx="36.5" cy="31" r="1.4" fill="#2a1d18" />
      <path d="M28.5 36.5c2 1.8 5 1.8 7 0" fill="none" stroke="#2a1d18" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
