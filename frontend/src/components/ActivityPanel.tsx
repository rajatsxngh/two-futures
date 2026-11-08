"use client";

/**
 * Agent activity panel (F10): each tool call in plain words, where judges can
 * see it. Voice calls come from VoiceSession's onToolEvent; taps are logged by
 * the same actions, so the panel works with or without voice.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolEvent } from "./voice";
import type { TransferResponse, UpdatePlanResponse } from "@/lib/api";
import { useApp } from "@/lib/store";
import { StatusIcon, usd } from "./ui";

const PATH_LABEL = { same_path: "Same path", plan: "With a plan" } as const;

type Entry = { first: ToolEvent; last: ToolEvent };

function describeWhatIf(p: Record<string, unknown>): string {
  if (typeof p.description === "string" && p.description.trim()) return p.description.trim();
  const parts: string[] = [];
  const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : null);
  if (n("income_change_yearly")) parts.push(`${n("income_change_yearly")! > 0 ? "+" : "−"}${usd(Math.abs(n("income_change_yearly")!))}/yr pay`);
  if (n("spending_change_monthly")) parts.push(`${n("spending_change_monthly")! > 0 ? "+" : "−"}${usd(Math.abs(n("spending_change_monthly")!))}/mo spending`);
  if (n("savings_change_monthly")) parts.push(`+${usd(n("savings_change_monthly")!)}/mo saving`);
  if (n("one_time_cost")) parts.push(`${usd(n("one_time_cost")!)} one-time`);
  if (n("job_loss_months")) parts.push(`${n("job_loss_months")} months without pay`);
  return parts.join(", ") || "a what-if";
}

function freq(f: unknown) {
  return f === "payday" ? "every payday" : f === "monthly" ? "every month" : "once";
}

function metricLabel(id: string): string {
  if (typeof document === "undefined") return id;
  const el = document.querySelector(`[data-metric-id="${CSS.escape(id)}"]`);
  const aria = el?.getAttribute("aria-label");
  return aria ? aria.replace(/\. Show the math$/, "") : id;
}

/** One plain-words line for an entry, plus an optional detail line. */
function words({ first, last }: Entry): { title: string; detail?: string; tone: "run" | "ok" | "warn" } {
  const p = first.params;
  if (first.name === "update_plan") {
    const what = describeWhatIf(p);
    if (last.phase === "called") return { title: `Checking: ${what}`, tone: "run" };
    if (last.phase === "refused") return { title: `Skipped: what-ifs only change the plan path`, detail: what, tone: "warn" };
    if (last.phase === "error") return { title: `Couldn't check: ${what}`, detail: last.error, tone: "warn" };
    const res = last.result as UpdatePlanResponse | undefined;
    const lead = res?.deltas.find((d) => d.id === "whatif.monthly_change") ?? res?.deltas.find((d) => d.id === "whatif.net_worth_2031");
    return { title: `Checked: ${what}${lead ? ` → ${lead.display}` : ""}`, detail: res?.sentence, tone: "ok" };
  }
  if (first.name === "start_transfer" || first.name === "stop_transfer") {
    const what = `${typeof p.amount === "number" ? usd(p.amount) : "?"} ${p.from_account_id ?? "?"} → ${p.to_account_id ?? "?"} ${freq(p.frequency)}`;
    const res = last.result as TransferResponse | undefined;
    if (first.name === "stop_transfer") {
      if (last.phase === "called") return { title: `Stopping: ${what}`, tone: "run" };
      if (last.phase === "error") return { title: `Couldn't stop: ${what}`, detail: last.error, tone: "warn" };
      return { title: `You stopped it: ${what}`, detail: "Simulated: no real money moved.", tone: "ok" };
    }
    if (first.source === "tap") {
      // The user's own tap on the confirm sheet.
      if (last.phase === "declined") return { title: `You said no: ${what}`, detail: "Nothing was scheduled.", tone: "warn" };
      if (last.phase === "called") return { title: `You confirmed: ${what}`, detail: "Scheduling…", tone: "run" };
      if (last.phase === "error") return { title: `Couldn't schedule: ${what}`, detail: last.error, tone: "warn" };
      return {
        title: `You confirmed: ${what}`,
        detail: `Scheduled${res ? `, first transfer ${res.first_date}` : ""}. Simulated: no real money moves.`,
        tone: "ok",
      };
    }
    // An agent (voice, text or saved answers): it can only propose.
    if (last.phase === "called") return { title: `Proposing: ${what}`, tone: "run" };
    if (last.phase === "proposed") return { title: `Proposed: ${what}`, detail: "Waiting for your tap on screen. Nothing moves without it.", tone: "ok" };
    if (last.phase === "refused") {
      const why = (last.result as { status?: string } | undefined)?.status;
      const title =
        why === "already_scheduled" ? "Not proposed: already scheduled (simulated)" : why ? "Not proposed: only the plan's transfer" : "Not proposed: waiting for a clear yes";
      return { title, detail: what, tone: "warn" };
    }
    if (last.phase === "error") return { title: `Couldn't propose: ${what}`, detail: last.error, tone: "warn" };
    return { title: `Proposed: ${what}`, tone: "ok" };
  }
  const id = typeof p.metric_id === "string" ? p.metric_id : "";
  return { title: `Pointed at: ${metricLabel(id)}`, tone: last.phase === "ok" ? "ok" : "warn" };
}

export function ActivityPanel() {
  const events = useApp((s) => s.toolEvents);
  const status = useApp((s) => s.voiceStatus);
  const path = useApp((s) => s.activePath);
  const [raw, setRaw] = useState(false);

  const entries = useMemo(() => {
    const byId = new Map<string, Entry>();
    for (const e of events) {
      const cur = byId.get(e.id);
      byId.set(e.id, cur ? { first: cur.first, last: e } : { first: e, last: e });
    }
    return [...byId.values()];
  }, [events]);

  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const live = status === "connected" ? `Live: talking to 2031 · ${path ? PATH_LABEL[path] : ""}` : status === "connecting" ? "Connecting…" : "Voice idle";

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0e0e10] p-5 text-snow antialiased shadow-[0_40px_100px_-40px_rgba(0,0,0,0.9)]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(90%_70%_at_0%_0%,rgba(255,255,255,0.06),transparent_70%)]" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">What she checked</h2>
          <p className="text-[13px] leading-[1.45] text-fog">Every number she says comes from our forecast engine. Each step, in plain words.</p>
        </div>
        <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 text-[12.5px] text-fog">
          Raw data
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} className="peer sr-only" />
          <span
            aria-hidden
            className="relative h-[22px] w-9 rounded-full bg-white/[0.14] transition after:absolute after:left-[3px] after:top-[3px] after:h-4 after:w-4 after:rounded-full after:bg-snow after:transition peer-checked:bg-ember peer-checked:after:translate-x-[14px] peer-focus-visible:ring-2 peer-focus-visible:ring-ember/60"
          />
        </label>
      </div>
      <p className={`relative mt-4 flex items-center gap-2 text-[12.5px] font-semibold ${status === "connected" ? "text-good" : "text-fog"}`}>
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            status === "connected" ? "animate-live bg-good shadow-[0_0_10px_rgba(74,222,128,0.7)]" : status === "connecting" ? "animate-live bg-fair" : "bg-white/20"
          }`}
        />
        {live}
      </p>

      {entries.length === 0 ? (
        <p className="relative mt-6 text-sm leading-relaxed text-fog">
          Tap a future self and ask a question, or try a what-if. Each tool call shows up here with its inputs and result.
        </p>
      ) : (
        <ol ref={listRef} className="phone-scroll relative mt-4 flex flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
          {entries.map((en) => {
            const w = words(en);
            const tap = en.first.source === "tap";
            const time = new Date(en.first.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
            return (
              <li key={en.first.id} className="fade-in rounded-[18px] border border-white/[0.07] bg-white/[0.045] px-3.5 py-3">
                <details open={raw || undefined}>
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ${
                            tap ? "bg-white/10 text-[#e4e4e7]" : "bg-ember/15 text-ember-text"
                          }`}
                        >
                          {tap ? "Tap" : "Voice"}
                        </span>
                        <span className="truncate font-mono text-[11px] text-smoke">
                          {en.first.name} · {PATH_LABEL[en.first.path]}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-mono text-[11px] text-smoke">
                        {time}
                        {en.last.ms !== undefined && ` · ${en.last.ms} ms`}
                      </span>
                    </div>
                    <p className={`mt-2 flex gap-2 text-sm font-medium leading-[1.4] ${w.tone === "warn" ? "text-fair" : "text-snow"}`}>
                      <ToneMark tone={w.tone} />
                      <span>{w.title}</span>
                    </p>
                    {w.detail && <p className="mt-1.5 pl-6 text-[12.5px] leading-[1.45] text-fog">{w.detail}</p>}
                  </summary>
                  <pre className="mt-2.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/40 p-2.5 font-mono text-[10.5px] leading-[1.55] text-[#d4d4d8]">
                    {JSON.stringify(raw ? { params: en.first.params, reply: en.last.reply, result: en.last.result } : { params: en.first.params, reply: en.last.reply }, null, 2)}
                  </pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <p className="relative mt-auto border-t border-white/[0.06] pt-4 text-xs leading-normal text-smoke">
        She can only read the engine&apos;s numbers or ask it for new ones. Money moves only on your tap.
      </p>
    </div>
  );
}

/** Running: a pulsing ember dot. Done: a check. Skipped or failed: a warning. */
function ToneMark({ tone }: { tone: "run" | "ok" | "warn" }) {
  if (tone === "run") return <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 animate-live rounded-full bg-ember" />;
  return <StatusIcon status={tone === "ok" ? "green" : "amber"} tone="dark" className="mt-0.5 h-4 w-4" />;
}
