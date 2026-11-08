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
  proposeTransfer,
  queuedQuestionSent,
  recordToolEvent,
  selectFuture,
  setVoiceMode,
  setVoiceStatus,
  updatePlan,
  voiceFailed,
} from "@/lib/actions";
import { useApp } from "@/lib/store";
import { SavedSession, VoiceSession, type VoiceTools } from "../voice";
import type { VoiceMode } from "@/lib/store";
import { CountUp, Hero, MetricValue, PaperSheet } from "../ui";
import { JobLossCheck } from "../JobLossCheck";
import { CarOptions, WhatIfDeltas } from "../WhatIfDrawer";
import { IconArrowRight, IconArrowUp, IconMic } from "../icons";

// The agent's client tools are the same functions the buttons use, so a spoken
// what-if changes exactly the same state as a tap. A spoken "yes" to the transfer
// only opens the same confirm sheet as the "Start this" button: money moves on a tap.
const VOICE_TOOLS: VoiceTools = {
  updatePlan: (input) => updatePlan(input, "voice"),
  proposeTransfer: (input) => proposeTransfer(input, "voice"),
  highlightMetric,
};
const PATH_LABEL: Record<PathId, string> = { same_path: "Same path", plan: "With a plan" };

export function FuturesScreen() {
  const futures = useApp((s) => s.futures)!;
  const customer = useApp((s) => s.customer);
  const whatIf = useApp((s) => s.whatIf);
  const planPath = whatIf?.result ?? futures.paths.plan;

  return (
    <div className="flex flex-1 flex-col">
      <Hero>
        <h1 className="text-[36px] font-semibold leading-[1.04] tracking-[-0.045em] text-snow">Meet {futures.target_year}</h1>
        <p className="mt-2 text-sm leading-[1.45] text-fog [text-wrap:pretty]">Same you, same surprises, two paths. Tap a side to talk.</p>

        <div className="mt-[22px] grid grid-cols-2 gap-2.5">
          <FutureSide id="same_path" path={futures.paths.same_path} year={futures.target_year} />
          <FutureSide id="plan" path={planPath} year={futures.target_year} />
        </div>

        <VoicePanel />
      </Hero>

      <PaperSheet label="Ask, test and decide">
        <div className="mt-[18px] flex flex-col gap-4">
          {customer === "maya" && <AskBoth />}
          <WhatIfResult />
          <JobLossCheck />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            onClick={() => openWhatIf(true)}
            className="h-14 rounded-full bg-ember-soft text-[15px] font-semibold text-ember-ink shadow-[inset_0_0_0_1px_rgba(255,107,26,0.3)] transition hover:shadow-[inset_0_0_0_1.5px_rgba(255,107,26,0.55)] active:scale-[0.99]"
          >
            Try a what-if
          </button>
          <button
            onClick={() => goTo("next")}
            className="flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-semibold text-snow transition hover:bg-black active:scale-[0.99]"
          >
            Your next step
            <IconArrowRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <h2 className="mt-[26px] text-[13px] font-semibold text-ink-2">Assumptions</h2>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-ink-3 [text-wrap:pretty]">{futures.assumptions.slice(1).join(" ")}</p>
      </PaperSheet>
    </div>
  );
}

function FutureSide({ id, path, year }: { id: PathId; path: PathResult; year: number }) {
  const active = useApp((s) => s.activePath === id);
  const name = useApp((s) => s.profile?.customer.name ?? "You");
  const isPlan = id === "plan";
  const last = path.snapshots[path.snapshots.length - 1];
  const rule = isPlan ? "bg-ember/[0.22]" : "bg-white/[0.08]";

  return (
    <section
      onClick={() => selectFuture(id)}
      aria-label={path.label}
      className={`flex min-w-0 cursor-pointer flex-col rounded-[26px] px-3 pb-3 pt-3.5 transition ${
        isPlan
          ? "border border-ember/40 bg-[linear-gradient(180deg,rgba(255,107,26,0.17)_0%,rgba(255,107,26,0.06)_38%,rgba(255,107,26,0.035)_100%)] shadow-[0_30px_70px_-30px_rgba(255,107,26,0.6)]"
          : "glass"
      } ${active ? (isPlan ? "ring-2 ring-ember" : "ring-2 ring-silver/70") : ""}`}
    >
      <p className={`text-center text-[12.5px] font-semibold tracking-[0.01em] ${isPlan ? "text-ember-text" : "text-fog"}`}>{path.label}</p>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          selectFuture(id);
        }}
        aria-label={`Talk to ${name} ${year}, ${path.label}`}
        className={`relative mx-auto mt-3 block h-[72px] w-[72px] rounded-full ${
          isPlan
            ? "animate-breathe shadow-[0_0_0_2px_#0a0a0b,0_0_0_3.5px_#ff6b1a,0_0_26px_rgba(255,107,26,0.55)]"
            : "shadow-[0_0_0_1px_rgba(255,255,255,0.14)]"
        }`}
      >
        <span className="block h-full w-full overflow-hidden rounded-full">
          <Avatar warm={isPlan} size={72} />
        </span>
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full ${
            isPlan ? "bg-ember text-ink shadow-[0_0_0_2.5px_#1d120c]" : "bg-[#3f3f46] text-snow shadow-[0_0_0_2.5px_#121213]"
          }`}
        >
          <IconMic className="h-[13px] w-[13px]" strokeWidth={2} />
        </span>
      </button>
      <p className="tabular mt-2.5 text-center text-xs text-smoke">
        {last ? `Age ${last.age}` : ""} · {year}
      </p>

      <div aria-hidden className={`mb-1.5 mt-3.5 h-px ${rule}`} />
      <div className="flex flex-col gap-1">
        {path.key_numbers.map((m) => (
          <KeyNumber key={m.id} metric={m} warm={isPlan} />
        ))}
      </div>
      <div aria-hidden className={`mb-4 mt-2.5 h-px ${rule}`} />

      <Timeline events={path.events} warm={isPlan} />
      <AskBox path={id} warm={isPlan} />
    </section>
  );
}

function KeyNumber({ metric, warm }: { metric: Metric; warm: boolean }) {
  // "6.0 months" -> big "6.0" + small "months", so the number stays big in a half-width column.
  const months = metric.unit === "months" ? metric.display.match(/^([\d.,-]+)\s+(.*)$/) : null;
  return (
    <div className="flex flex-col">
      <span className="text-[11.5px] text-smoke">{metric.label}</span>
      <MetricValue
        metric={metric}
        className={`inline-flex min-h-11 items-center self-start font-semibold leading-none tracking-[-0.045em] ${warm ? "text-white" : "text-[#d4d4d8]"}`}
      >
        <span className="inline-flex items-baseline">
          {months ? (
            <>
              <span className="text-[30px]">
                <CountUp text={months[1]} />
              </span>
              <span className="ml-1 text-[13px] font-medium tracking-normal text-fog">{months[2]}</span>
            </>
          ) : (
            <span className={metric.unit === "date" ? "text-[24px]" : "text-[30px]"}>
              <CountUp text={metric.display} />
            </span>
          )}
        </span>
      </MetricValue>
    </div>
  );
}

function Timeline({ events, warm }: { events: LifeEvent[]; warm: boolean }) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  return (
    <div className="relative">
      <span aria-hidden className={`absolute bottom-1.5 left-[3px] top-1.5 w-[1.5px] rounded-full ${warm ? "bg-ember/40" : "bg-white/[0.12]"}`} />
      <ol aria-label="Along the way" className="flex flex-col gap-3.5 pl-4">
        {sorted.map((e, i) => (
          <li key={`${e.date}-${i}`} className="relative">
            <span
              aria-hidden
              className={`absolute -left-4 top-1 h-2 w-2 rounded-full ${e.shared ? "bg-snow" : warm ? "bg-ember" : "bg-smoke"}`}
            />
            <p className="text-xs font-semibold leading-[1.35] text-snow">
              <span className="tabular text-smoke">{e.date.slice(0, 4)}</span> · {e.title}
              {e.shared && (
                <span className="ml-1 inline-block rounded-full bg-white/[0.12] px-1.5 py-px align-[1px] text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[#e4e4e7]">
                  Both
                </span>
              )}
            </p>
            <p className="mt-[3px] text-[11px] leading-[1.4] text-fog">{e.description}</p>
          </li>
        ))}
      </ol>
    </div>
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
    <div className="mt-auto pt-[18px]" onClick={(e) => e.stopPropagation()}>
      {lastQuestion && (
        <p className="mb-2 rounded-xl bg-black/30 px-2.5 py-1.5 text-[11px] leading-snug text-snow" aria-live="polite">
          <span className="font-semibold">You:</span> {lastQuestion.text}
        </p>
      )}
      <form onSubmit={submit} className="relative">
        <label className="sr-only" htmlFor={`ask-${path}`}>
          Ask this future self
        </label>
        <input
          id={`ask-${path}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => selectFuture(path)}
          placeholder="Ask me…"
          className={`h-11 w-full rounded-full border pl-3.5 pr-12 text-[13px] text-snow placeholder:text-smoke focus:outline-none focus:ring-2 ${
            warm ? "border-ember/30 bg-black/35 focus:ring-ember/60" : "border-white/10 bg-white/[0.06] focus:ring-white/30"
          }`}
        />
        <button
          type="submit"
          aria-label="Send question"
          className={`absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full transition hover:brightness-110 ${
            warm ? "bg-ember text-ink" : "bg-[#3f3f46] text-snow"
          }`}
        >
          <IconArrowUp className="h-[15px] w-[15px]" strokeWidth={2} />
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
  const notice = useApp((s) => s.transferNotice);
  const name = useApp((s) => s.profile?.customer.name ?? "You");
  const customer = useApp((s) => s.customer);
  const mode = useApp((s) => s.voiceMode);
  const status = useApp((s) => s.voiceStatus);
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
  if (customer !== "maya") {
    // The agent's persona is written for Maya; a couple's future self would get a confused voice.
    return (
      <section className="glass fade-in mt-3.5 rounded-[28px] p-4 text-sm text-snow">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold text-fog">Talking to 2031</p>
          <button onClick={() => selectFuture(null)} className="glass h-11 rounded-full px-4 text-[13px] font-medium text-snow hover:bg-white/10">
            Close
          </button>
        </div>
        <p className="mt-2 leading-relaxed text-fog">
          The future-self conversation is set up for Maya, the demo customer. Switch the customer to Maya at the top to talk to her two
          futures. Everything else on this screen works for {name}.
        </p>
      </section>
    );
  }
  const warm = path === "plan";
  return (
    <section
      aria-label={`Talking to ${name} 2031`}
      className={`fade-in mt-3.5 flex flex-col rounded-[30px] bg-white/[0.045] px-3.5 pb-3.5 pt-3 ${
        warm ? "border border-ember/[0.36] shadow-[0_40px_80px_-40px_rgba(255,107,26,0.45)]" : "border border-white/10"
      }`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <p className={`flex min-w-0 items-center gap-2 text-[12.5px] font-semibold ${warm ? "text-ember-text" : "text-fog"}`}>
          <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${status === "connected" ? "animate-live bg-good" : "bg-smoke"}`} />
          <span className="truncate">
            Talking to {name} 2031 · {PATH_LABEL[path]}
          </span>
        </p>
        <button onClick={() => selectFuture(null)} className="glass h-11 shrink-0 rounded-full px-3.5 text-[13px] font-medium text-snow hover:bg-white/10">
          Close
        </button>
      </div>
      <ModeSwitch mode={mode} />
      {configured === false && mode !== "saved" && (
        <p className="mt-2 rounded-2xl border border-fair/25 bg-fair/10 px-3 py-2 text-xs leading-snug text-[#fde68a]">
          Live voice is off: add ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to frontend/.env.local, then restart. Saved answers work without it.
        </p>
      )}
      <div className="mt-3">
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
            notice={notice}
            onQueuedSent={queuedQuestionSent}
            onAgentReply={agentReplied}
            onError={voiceFailed}
            hideMic={mode === "text"}
          />
        )}
      </div>
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
    <div role="radiogroup" aria-label="How she talks" className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-white/[0.06] p-1">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          title={m.hint}
          onClick={() => setVoiceMode(m.id)}
          className={`h-11 rounded-full text-[13px] font-semibold transition ${mode === m.id ? "bg-snow text-ink" : "text-fog hover:text-snow"}`}
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
    <form onSubmit={submit} className="flex items-center gap-2 rounded-full bg-tile py-1.5 pl-2.5 pr-1.5 focus-within:ring-2 focus-within:ring-ember/40">
      <span aria-hidden className="flex shrink-0">
        <span className="h-[22px] w-[22px] rounded-full bg-[#71717a] shadow-[0_0_0_2px_#f4f4f5]" />
        <span className="-ml-[7px] h-[22px] w-[22px] rounded-full bg-ember shadow-[0_0_0_2px_#f4f4f5]" />
      </span>
      <label className="sr-only" htmlFor="ask-both">
        Ask both futures
      </label>
      <input
        id="ask-both"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask both, e.g. Was buying the car worth it?"
        className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!text.trim() || pending !== null}
        className="h-11 shrink-0 rounded-full bg-ink px-[18px] text-sm font-semibold text-snow transition hover:bg-black disabled:opacity-40"
      >
        {pending ? "Asking…" : "Ask both"}
      </button>
    </form>
  );
}

function WhatIfResult() {
  const whatIf = useApp((s) => s.whatIf);
  const pending = useApp((s) => s.whatIfPending);
  if (pending && !whatIf) return <p className="text-sm text-ink-3">Working it out…</p>;
  if (!whatIf) return null;
  return (
    <div className="fade-in rounded-[22px] bg-ember-soft p-4" aria-live="polite">
      <p className="text-xs font-semibold text-ember-ink">What-if on the plan</p>
      <WhatIfDeltas deltas={whatIf.deltas} />
      <p className="mt-3 text-sm leading-[1.45] text-ink-2 [text-wrap:pretty]">{whatIf.sentence}</p>
      <CarOptions options={whatIf.car_options} />
    </div>
  );
}

/** One simple illustrated avatar, used on both sides. Never a photo or an aged face. */
export function Avatar({ warm, size = 64 }: { warm: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Future you">
      <rect width="64" height="64" fill={warm ? "#2A1409" : "#1F1F23"} />
      {/* hair back */}
      <path d="M15.5 33c0-11.6 7.2-19 16.5-19s16.5 7.4 16.5 19v12h-33z" fill="#2B1D17" />
      {/* shoulders (scrubs) */}
      <path d="M9 66c1.8-12 10.6-18 23-18s21.2 6 23 18z" fill={warm ? "#FF6B1A" : "#71717A"} />
      <path d="M26.5 48.6 32 55l5.5-6.4" fill="none" stroke="#0A0A0B" strokeOpacity="0.3" strokeWidth="2" strokeLinejoin="round" />
      {/* neck + face */}
      <path d="M28 40h8v7.5a4 4 0 0 1-8 0z" fill="#C68B67" />
      <ellipse cx="32" cy="30.5" rx="10.8" ry="12.2" fill="#DCA681" />
      {/* fringe */}
      <path d="M21 28.2c2.2-7.4 7.2-10.6 12.6-10.6 5 0 9 3 10.4 8.6-5.6-.8-10.6-3.6-13.2-6.8-2.2 4-6 7.4-9.8 8.8z" fill="#2B1D17" />
      {/* face */}
      <circle cx="27.6" cy="31.2" r="1.25" fill="#2A1D18" />
      <circle cx="36.4" cy="31.2" r="1.25" fill="#2A1D18" />
      <path d="M29 36.2c1.8 1.5 4.2 1.5 6 0" fill="none" stroke="#2A1D18" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}
