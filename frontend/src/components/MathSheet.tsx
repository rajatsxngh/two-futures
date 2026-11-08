"use client";

/**
 * "Show the math" (F9): tap any number to see its inputs, the formula in plain
 * words, its thresholds and its assumptions. Everything shown comes from the
 * Metric the engine sent; nothing is computed here.
 */
import { useEffect } from "react";
import type { MathInfo, Metric } from "@/lib/api";
import { closeMath } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { usd } from "./ui";

type Unit = Metric["unit"];

function fmt(value: number | string, unit: Unit): string {
  if (typeof value === "string") {
    if (unit === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    return value;
  }
  switch (unit) {
    case "usd":
      return usd(value);
    case "usd_per_month":
      return `${usd(value)}/month`;
    case "pct":
      return `${Number(value.toFixed(2))}%`;
    case "months":
      return `${value.toFixed(1)} months`;
    case "years":
      return `${value} years`;
    default:
      return value.toLocaleString("en-US");
  }
}

const FORECAST_PREFIXES = ["forecast.", "same_path.", "plan.", "whatif.", "next_step."];

export function MathSheet() {
  const metric = useApp((s) => s.mathMetric);

  useEffect(() => {
    if (!metric) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMath();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [metric]);

  if (!metric) return null;
  const m: MathInfo = metric.math;
  const isForecast = FORECAST_PREFIXES.some((p) => metric.id.startsWith(p));

  return (
    <div className="fade-in absolute inset-0 z-40 flex items-end bg-black/60 backdrop-blur-[2px]" onClick={closeMath}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`The math behind ${metric.label}`}
        onClick={(e) => e.stopPropagation()}
        className="sheet-up phone-scroll max-h-[85%] w-full overflow-y-auto rounded-t-[32px] bg-white px-[22px] pb-[max(28px,env(safe-area-inset-bottom))] pt-2.5 text-ink shadow-[0_-24px_60px_rgba(0,0,0,0.45)]"
      >
        <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-hair" />
        <div className="mt-3.5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs font-semibold text-ink-3">Show the math</p>
            <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.02em]">{metric.label}</h2>
          </div>
          <button onClick={closeMath} className="h-11 shrink-0 rounded-full bg-tile px-4 text-sm font-semibold text-ink transition hover:bg-hair">
            Close
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <p className="tabular text-[44px] font-medium leading-none tracking-[-0.05em]">{metric.display}</p>
          {isForecast && (
            <span className="inline-flex h-6 items-center rounded-full bg-ember-soft px-2.5 text-xs font-semibold text-ember-ink">Forecast, not a promise</span>
          )}
        </div>

        <h3 className="mt-[22px] text-xs font-semibold text-ink-3">How it&apos;s worked out</h3>
        <p className="mt-1.5 text-base leading-[1.45] tracking-[-0.01em] [text-wrap:pretty]">{m.formula}</p>

        {m.inputs.length > 0 && (
          <>
            <h3 className="mt-[22px] text-xs font-semibold text-ink-3">Inputs</h3>
            <ul className="mt-2 rounded-[20px] bg-tile-2 px-4">
              {m.inputs.map((i, k) => (
                <li key={k} className={`flex min-h-12 items-center justify-between gap-3 py-2.5 text-sm ${k ? "border-t border-[#eaeaed]" : ""}`}>
                  <span className="min-w-0">
                    {i.label}
                    {i.source && <span className="mt-0.5 block text-xs text-ink-3">{i.source}</span>}
                  </span>
                  <span className="tabular shrink-0 text-[15px] font-semibold">{fmt(i.value, i.unit)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {m.thresholds && (
          <>
            <h3 className="mt-[22px] text-xs font-semibold text-ink-3">Thresholds</h3>
            <p className="mt-1.5 text-sm leading-relaxed">
              Scores 100 at {fmt(m.thresholds.best, m.thresholds.unit)} and 0 at {fmt(m.thresholds.worst, m.thresholds.unit)}.
            </p>
          </>
        )}

        {m.assumptions.length > 0 && (
          <>
            <h3 className="mt-[22px] text-xs font-semibold text-ink-3">Assumptions</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {m.assumptions.map((a, k) => (
                <li key={k} className="flex gap-2.5 text-[13px] leading-[1.45] text-ink-2">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#a1a1aa]" />
                  {a}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-[18px] border-t border-[#f0f0f2] pt-3.5 text-[11.5px] leading-normal text-ink-3">
          Every number comes from the forecast engine. The voice agent can only read these numbers or ask the engine for new ones.
        </p>
      </section>
    </div>
  );
}
