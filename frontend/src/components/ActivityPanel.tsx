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
import { usd } from "./ui";

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
    <div className="flex h-full flex-col rounded-3xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-navy">What she checked</h2>
          <p className="text-xs leading-snug text-muted">Every number she says comes from our forecast engine. Each step, in plain words.</p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          Raw data
        </label>
      </div>
      <p className={`mt-3 flex items-center gap-2 text-xs font-medium ${status === "connected" ? "text-ok" : "text-muted"}`}>
        <span className={`h-2 w-2 rounded-full ${status === "connected" ? "animate-pulse bg-ok" : "bg-line"}`} />
        {live}
      </p>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm leading-snug text-muted">
          Tap a future self and ask a question, or try a what-if. Each tool call shows up here with its inputs and result.
        </p>
      ) : (
        <ol ref={listRef} className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {entries.map((en) => {
            const w = words(en);
            const time = new Date(en.first.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
            return (
              <li key={en.first.id} className="fade-in rounded-xl border border-line bg-surface px-3 py-2">
                <details open={raw || undefined}>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      <span>
                        <span className={`mr-1.5 rounded px-1 py-px font-semibold uppercase ${en.first.source === "tap" ? "bg-line text-navy" : "bg-accent-soft text-accent-dark"}`}>
                          {en.first.source === "tap" ? "Tap" : "Voice"}
                        </span>
                        {en.first.name} · {PATH_LABEL[en.first.path]}
                      </span>
                      <span className="tabular">
                        {time}
                        {en.last.ms !== undefined && ` · ${en.last.ms} ms`}
                      </span>
                    </div>
                    <p className={`mt-0.5 text-sm font-medium leading-snug ${w.tone === "warn" ? "text-warn" : "text-navy"}`}>
                      {w.tone === "run" && <span className="mr-1 animate-pulse">●</span>}
                      {w.title}
                    </p>
                    {w.detail && <p className="mt-0.5 text-xs leading-snug text-muted">{w.detail}</p>}
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-white p-2 text-[10px] leading-snug text-navy">
                    {JSON.stringify(raw ? { params: en.first.params, reply: en.last.reply, result: en.last.result } : { params: en.first.params, reply: en.last.reply }, null, 2)}
                  </pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
