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
    <div className="absolute inset-0 z-40 flex items-end bg-navy/30 fade-in" onClick={closeMath}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`The math behind ${metric.label}`}
        onClick={(e) => e.stopPropagation()}
        className="sheet-up max-h-[85%] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-6 pt-3 shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Show the math</p>
            <h2 className="text-lg font-semibold text-navy">{metric.label}</h2>
          </div>
          <button onClick={closeMath} className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-navy">
            Close
          </button>
        </div>
        <p className="tabular mt-1 text-[36px] font-semibold leading-tight text-navy">{metric.display}</p>
        {isForecast && <p className="text-xs font-medium text-plan">Forecast, not a promise</p>}

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">How it&apos;s worked out</h3>
        <p className="mt-1 text-[15px] leading-snug text-navy">{m.formula}</p>

        {m.inputs.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Inputs</h3>
            <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
              {m.inputs.map((i, k) => (
                <li key={k} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-navy">
                    {i.label}
                    {i.source && <span className="block text-[11px] text-muted">{i.source}</span>}
                  </span>
                  <span className="tabular shrink-0 font-medium text-navy">{fmt(i.value, i.unit)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {m.thresholds && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Thresholds</h3>
            <p className="mt-1 text-sm text-navy">
              Scores 100 at {fmt(m.thresholds.best, m.thresholds.unit)} and 0 at {fmt(m.thresholds.worst, m.thresholds.unit)}.
            </p>
          </>
        )}

        {m.assumptions.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Assumptions</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-snug text-muted">
              {m.assumptions.map((a, k) => (
                <li key={k}>{a}</li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-[11px] text-muted">
          Every number comes from the forecast engine. The voice agent can only read these numbers or ask the engine for new ones.
        </p>
      </section>
    </div>
  );
}
