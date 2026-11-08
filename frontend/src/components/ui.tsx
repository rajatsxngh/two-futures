"use client";

/**
 * Small shared pieces: the Metric renderer (with its DOM hook), the count-up number, status icons, the
 * Obsidian-and-Paper layout bits (hero, paper sheet, disclaimer) and formatting helpers.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { Metric } from "@/lib/api";
import { openMath } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { IconChevronLeft } from "./icons";

/** Props that make a number open its "show the math" sheet on tap or Enter. */
function mathTrigger(metric: Metric | undefined) {
  if (!metric) return { className: "" };
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    openMath(metric);
  };
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${metric.label}: ${metric.display}. Show the math`,
    onClick: open,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(e);
      }
    },
    className: "metric-link",
  };
}

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
  const trigger = mathTrigger(metric);
  return (
    <span
      {...trigger}
      data-metric-id={metric.id}
      title={metric.math.formula}
      className={`inline-block transition-colors ${highlighted ? "metric-highlight" : ""} ${trigger.className} ${className}`}
    >
      {children ?? (animate ? <CountUp text={metric.display} /> : <span className="tabular">{metric.display}</span>)}
    </span>
  );
}

/** Wrapper for numbers that aren't Metrics in the contract yet (e.g. account balances). */
export function NumberHook({
  id,
  metric,
  className = "",
  children,
}: {
  id: string;
  /** When the contract has a Metric for this number, tapping it shows the math. */
  metric?: Metric | null;
  className?: string;
  children: ReactNode;
}) {
  const highlighted = useApp((s) => s.highlighted === id);
  const trigger = mathTrigger(metric ?? undefined);
  return (
    <span
      {...trigger}
      data-metric-id={id}
      className={`inline-block tabular ${highlighted ? "metric-highlight" : ""} ${trigger.className} ${className}`}
    >
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

const ICON_TONE: Record<"paper" | "dark", Record<StatusKind, string>> = {
  paper: { red: "text-poor-icon", amber: "text-fair-icon", green: "text-good-icon" },
  dark: { red: "text-poor", amber: "text-fair", green: "text-good" },
};

export function StatusIcon({
  status,
  className = "h-4 w-4",
  tone = "paper",
}: {
  status: StatusKind;
  className?: string;
  tone?: "paper" | "dark";
}) {
  const common = { className: `${className} ${ICON_TONE[tone][status]} shrink-0`, viewBox: "0 0 20 20", fill: "currentColor", "aria-hidden": true };
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

const CHIP_TONE: Record<StatusKind, string> = {
  red: "bg-poor-soft text-poor-ink",
  amber: "bg-fair-soft text-fair-ink",
  green: "bg-good-soft text-good-ink",
};

/** Status on paper: a soft tinted chip with its icon. */
export function StatusChip({ status }: { status: StatusKind }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full pl-[7px] pr-2.5 text-xs font-semibold ${CHIP_TONE[status]}`}>
      <StatusIcon status={status} className="h-[13px] w-[13px]" />
      {statusText[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout bits
// ---------------------------------------------------------------------------

/** The dark top of a screen. Leaves room for the floating header. */
export function Hero({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`relative flex-none px-5 pt-[calc(var(--header-h)+14px)] ${className}`}>
      <div aria-hidden className="hero-sheen pointer-events-none absolute inset-x-0 top-0 h-[640px]" />
      <div className="relative">{children}</div>
    </section>
  );
}

/** The white sheet that rises over the hero; holds the detail and ends with the disclaimer. */
export function PaperSheet({ children, label, className = "" }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <section aria-label={label} className={`paper-sheet mt-7 flex-1 px-5 pb-36 pt-2.5 ${className}`}>
      <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-hair" />
      {children}
      <Disclaimer />
    </section>
  );
}

export function Disclaimer() {
  const sandbox = useApp((s) => s.customer === "sandbox");
  return (
    <p className="mt-8 text-center text-[11.5px] leading-normal text-ink-3">
      {sandbox
        ? "Educational demo · Plaid sandbox test data · not financial advice · not a credit score"
        : "Educational demo · made-up data · not financial advice · not a credit score"}
    </p>
  );
}

/** A grouped block on paper. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[24px] bg-tile p-4 ${className}`}>{children}</section>;
}

/** A section heading on paper. */
export function SectionTitle({ children, right, className = "" }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{children}</h2>
      {right}
    </div>
  );
}

/** Back, on obsidian. */
export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="glass inline-flex h-11 items-center gap-1.5 rounded-full pl-2.5 pr-4 text-sm font-medium text-snow transition hover:bg-white/10">
      <IconChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.9} />
      {label}
    </button>
  );
}
