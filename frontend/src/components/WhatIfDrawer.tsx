"use client";

import { useState } from "react";
import type { WhatIfRequest } from "@/lib/api";
import { openWhatIf, updatePlan, type UpdatePlanInput } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { MetricValue, usd } from "./ui";

type Values = { income: number; spending: number; savings: number };
type Preset = {
  id: WhatIfRequest["preset"];
  label: string;
  description: string;
  values: Values;
  extra?: Partial<UpdatePlanInput>;
  note?: string;
};

const ZERO: Values = { income: 0, spending: 0, savings: 0 };

const PRESETS: Preset[] = [
  {
    id: "new_job",
    label: "New job",
    description: "What if I take the Austin job? $8,000 more a year, but rent is $300 higher.",
    values: { income: 8000, spending: 300, savings: 0 },
    extra: { start_month: "2027-01" },
    note: "Austin: +$8,000 a year, rent +$300",
  },
  {
    id: "move",
    label: "Move",
    description: "What if I move to a place with $300 higher rent?",
    values: { income: 0, spending: 300, savings: 0 },
  },
  {
    id: "big_purchase",
    label: "Big purchase",
    description: "What if I make a $3,000 purchase?",
    values: ZERO,
    extra: { one_time_cost: 3000 },
    note: "One-time cost: $3,000 (savings first, then the card)",
  },
  {
    id: "save_more",
    label: "Save more",
    description: "What if I save $100 more a month?",
    values: { income: 0, spending: 0, savings: 100 },
  },
  {
    id: "buy_home",
    label: "Buy a home",
    description: "What if I buy a $250,000 home in June 2029 with 5% down at 6.5%?",
    values: ZERO,
    extra: { start_month: "2029-06", home: { price: 250000, down_payment: 12500, rate: 6.5, term_years: 30 } },
    note: "$250,000 home, $12,500 down, 6.5% for 30 years, June 2029. The payment replaces rent.",
  },
  {
    id: "job_loss",
    label: "Job loss",
    description: "What if I lose my job for 3 months?",
    values: ZERO,
    extra: { job_loss_months: 3 },
    note: "No income for 3 months",
  },
];

function signed(n: number, unit: string) {
  if (n === 0) return `no change`;
  return `${n > 0 ? "+" : "−"}${usd(Math.abs(n))}${unit}`;
}

function describe(v: Values) {
  const parts: string[] = [];
  if (v.income) parts.push(`income ${signed(v.income, " a year")}`);
  if (v.spending) parts.push(`spending ${signed(v.spending, " a month")}`);
  if (v.savings) parts.push(`saving ${signed(v.savings, " a month")}`);
  return parts.length ? `What if ${parts.join(", ")}?` : "";
}

export function WhatIfDrawer() {
  const open = useApp((s) => s.whatIfDrawerOpen);
  if (!open) return null;
  return <Drawer />;
}

function Drawer() {
  const pending = useApp((s) => s.whatIfPending);
  const whatIf = useApp((s) => s.whatIf);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [values, setValues] = useState<Values>(ZERO);

  const touched = preset ? values.income !== preset.values.income || values.spending !== preset.values.spending || values.savings !== preset.values.savings : true;
  const description = preset && !touched ? preset.description : describe(values);
  const hasChange = Boolean(preset?.extra && !touched) || values.income !== 0 || values.spending !== 0 || values.savings !== 0;

  const pick = (p: Preset) => {
    setPreset(p);
    setValues(p.values);
  };

  const apply = () => {
    const extra = preset && !touched ? preset.extra : undefined;
    void updatePlan({
      description: description || "What-if",
      preset: preset && !touched ? preset.id : "custom",
      income_change_yearly: values.income || null,
      spending_change_monthly: values.spending || null,
      savings_change_monthly: values.savings || null,
      ...extra,
    }).catch(() => {});
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button aria-label="Close what-if" className="fade-in absolute inset-0 bg-navy/30" onClick={() => openWhatIf(false)} />
      <div role="dialog" aria-label="What-if" className="sheet-up relative max-h-[85%] overflow-y-auto rounded-t-3xl bg-white px-4 pb-5 pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-navy">What if...?</h2>
          <span className="text-xs text-muted">Changes the plan path only</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p)}
              aria-pressed={preset?.id === p.id}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                preset?.id === p.id ? "border-plan bg-plan text-white" : "border-line bg-white text-navy hover:border-plan/50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset?.note && !touched && <p className="mt-2 text-xs text-muted">{preset.note}</p>}

        <div className="mt-4 space-y-4">
          <Slider label="Income" unit=" a year" min={-20000} max={30000} step={1000} value={values.income} onChange={(income) => setValues((v) => ({ ...v, income }))} />
          <Slider label="Spending" unit=" a month" min={-500} max={1000} step={50} value={values.spending} onChange={(spending) => setValues((v) => ({ ...v, spending }))} />
          <Slider label="Savings" unit=" a month" min={-200} max={500} step={25} value={values.savings} onChange={(savings) => setValues((v) => ({ ...v, savings }))} />
        </div>

        <div className="mt-4 min-h-[64px] rounded-2xl bg-plan-soft p-3" aria-live="polite">
          {pending ? (
            <p className="text-sm text-muted">Running the numbers...</p>
          ) : whatIf ? (
            <>
              <div className="flex flex-wrap gap-x-3">
                {whatIf.deltas.map((d) => (
                  <MetricValue key={d.id} metric={d} animate className="text-xl font-semibold text-navy" />
                ))}
              </div>
              <p className="mt-0.5 text-sm leading-snug text-navy/85">{whatIf.sentence}</p>
            </>
          ) : (
            <p className="text-sm text-muted">{description || "Pick a chip or move a slider."}</p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => openWhatIf(false)} className="rounded-2xl border border-line py-3 text-sm font-semibold text-navy">
            {whatIf ? "Done" : "Cancel"}
          </button>
          <button
            onClick={apply}
            disabled={!hasChange || pending}
            className="rounded-2xl bg-plan py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Apply to my plan
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = `whatif-${label.toLowerCase()}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-navy">
          {label}
        </label>
        <span className="tabular text-sm font-semibold text-navy">{signed(value, unit)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--color-plan)]"
      />
    </div>
  );
}
