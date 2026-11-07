"use client";

/**
 * Small shared pieces: the Metric renderer (with its DOM hook), the count-up
 * number, status icons and formatting helpers.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Metric } from "@/lib/api";
import { useApp } from "@/lib/store";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function usd(n: number, opts: { cents?: boolean } = {}) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.cents ? 2 : 0,
    minimumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function shortDate(iso: string, withYear = false) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

export function longDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Count-up display: animates the first number inside a pre-formatted string,
// e.g. "$22,400" -> "$23,900" or "6.0 months" -> "7.8 months".
// ---------------------------------------------------------------------------

const NUM = /-?\d[\d,]*(\.\d+)?/;

function parseDisplay(s: string) {
  const m = s.match(NUM);
  if (!m || m.index === undefined) return null;
  const raw = m[0];
  return {
    before: s.slice(0, m.index),
    after: s.slice(m.index + raw.length),
    value: Number(raw.replace(/,/g, "")),
    decimals: m[1] ? m[1].length - 1 : 0,
    commas: raw.includes(","),
  };
}

function formatLike(value: number, decimals: number, commas: boolean) {
  return commas
    ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : value.toFixed(decimals);
}

export function CountUp({ text, durationMs = 900 }: { text: string; durationMs?: number }) {
  // The true value always renders; an in-between frame only shows while an animation for *this* text runs.
  // So a paused animation (background tab) or an unparseable value can never leave a stale number on screen.
  const [frame, setFrame] = useState<{ for: string; value: string } | null>(null);
  const prev = useRef(text);

  useEffect(() => {
    const from = parseDisplay(prev.current);
    const to = parseDisplay(text);
    prev.current = text;
    if (!from || !to || from.value === to.value || from.before !== to.before || from.after !== to.after) return;
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from.value + (to.value - from.value) * eased;
      setFrame(t < 1 ? { for: text, value: `${to.before}${formatLike(v, to.decimals, to.commas)}${to.after}` } : null);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [text, durationMs]);

  return <span className="tabular">{frame && frame.for === text ? frame.value : text}</span>;
}

// ---------------------------------------------------------------------------
// MetricValue: every rendered Metric goes through this, so highlight_metric
// and "show the math" (M9) can find it by `data-metric-id`.
// ---------------------------------------------------------------------------

export function MetricValue({
  metric,
  className = "",
  animate = false,
  children,
}: {
  metric: Metric;
  className?: string;
  animate?: boolean;
  children?: ReactNode;
}) {
  const highlighted = useApp((s) => s.highlighted === metric.id);
  return (
    <span
      data-metric-id={metric.id}
      title={metric.math.formula}
      className={`inline-block transition-colors ${highlighted ? "metric-highlight" : ""} ${className}`}
    >
      {children ?? (animate ? <CountUp text={metric.display} /> : <span className="tabular">{metric.display}</span>)}
    </span>
  );
}

/** Wrapper for numbers that aren't Metrics in the contract yet (e.g. account balances). */
export function NumberHook({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  const highlighted = useApp((s) => s.highlighted === id);
  return (
    <span data-metric-id={id} className={`inline-block tabular ${highlighted ? "metric-highlight" : ""} ${className}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status (red/amber/green), always with an icon
// ---------------------------------------------------------------------------

export type StatusKind = "red" | "amber" | "green";

export const statusText: Record<StatusKind, string> = {
  red: "Needs work",
  amber: "Getting there",
  green: "Healthy",
};

export const statusColor: Record<StatusKind, string> = {
  red: "text-bad",
  amber: "text-warn",
  green: "text-ok",
};

export function StatusIcon({ status, className = "h-4 w-4" }: { status: StatusKind; className?: string }) {
  const common = { className: `${className} ${statusColor[status]} shrink-0`, viewBox: "0 0 20 20", fill: "currentColor", "aria-hidden": true };
  if (status === "green")
    return (
      <svg {...common}>
        <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm4.03 6.28-4.6 5.5a.75.75 0 0 1-1.11.05l-2.4-2.4a.75.75 0 1 1 1.06-1.06l1.82 1.82 4.08-4.87a.75.75 0 0 1 1.15.96Z" />
      </svg>
    );
  if (status === "amber")
    return (
      <svg {...common}>
        <path d="M8.48 2.6a1.75 1.75 0 0 1 3.04 0l6.6 11.55A1.75 1.75 0 0 1 16.6 16.8H3.4a1.75 1.75 0 0 1-1.52-2.65L8.48 2.6ZM10 6.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 10 6.5Zm0 8a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm2.97 10.41a.75.75 0 1 1-1.06 1.06L10 11.06l-1.91 1.91a.75.75 0 1 1-1.06-1.06L8.94 10 7.03 8.09a.75.75 0 0 1 1.06-1.06L10 8.94l1.91-1.91a.75.75 0 1 1 1.06 1.06L11.06 10l1.91 1.91Z" />
    </svg>
  );
}

export function StatusPill({ status }: { status: StatusKind }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${statusColor[status]}`}>
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {statusText[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout bits
// ---------------------------------------------------------------------------

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-white p-4 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-navy">
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M12.7 4.3a1 1 0 0 1 0 1.4L8.42 10l4.3 4.3a1 1 0 0 1-1.42 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z" />
      </svg>
      {label}
    </button>
  );
}
