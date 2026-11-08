"use client";

/**
 * The two setup questions (F14): insurance and planning ahead. They feed
 * indicators 7 and 8. Pre-filled for the demo; changing an answer re-scores
 * today and both futures. Reset restores the pre-filled answers.
 */
import { useState } from "react";
import type { SetupAnswers } from "@/lib/api";
import { answerSetup } from "@/lib/actions";
import { useApp } from "@/lib/store";

const INSURANCE: { key: keyof SetupAnswers["insurance"]; label: string }[] = [
  { key: "health", label: "Health" },
  { key: "auto", label: "Auto" },
  { key: "renters_or_home", label: "Renters or home" },
  { key: "disability", label: "Disability" },
];
const PLANNING: { id: SetupAnswers["planning_ahead"]; label: string }[] = [
  { id: "yes", label: "Yes" },
  { id: "sometimes", label: "Sometimes" },
  { id: "no", label: "Not really" },
];

export function SetupQuestions() {
  const setup = useApp((s) => s.profile?.customer.setup);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!setup) return null;

  const count = INSURANCE.filter((i) => setup.insurance[i.key]).length;
  const save = async (next: SetupAnswers) => {
    setSaving(true);
    try {
      await answerSetup(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-4" aria-label="Two quick questions">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-navy">Two quick questions</p>
          <p className="text-xs text-muted">
            {count} of 4 insurance types · plans ahead: {setup.planning_ahead}
            {saving ? " · updating your score…" : ""}
          </p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="rounded-full border border-line px-3 py-1 text-xs font-medium text-navy">
          {open ? "Done" : "Edit"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="text-xs font-semibold text-muted">1. Which insurance do you have?</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {INSURANCE.map((i) => {
                const on = setup.insurance[i.key];
                return (
                  <button
                    key={i.key}
                    aria-pressed={on}
                    disabled={saving}
                    onClick={() => void save({ ...setup, insurance: { ...setup.insurance, [i.key]: !on } })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-accent bg-accent-soft text-accent-dark" : "border-line text-muted"}`}
                  >
                    {on ? "✓ " : ""}
                    {i.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-semibold text-muted">2. Do you plan ahead for big expenses?</legend>
            <div className="mt-1.5 flex gap-1.5">
              {PLANNING.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={setup.planning_ahead === p.id}
                  disabled={saving}
                  onClick={() => void save({ ...setup, planning_ahead: p.id })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${setup.planning_ahead === p.id ? "border-accent bg-accent-soft text-accent-dark" : "border-line text-muted"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-[11px] text-muted">Pre-filled for the demo. These feed the Insurance and Planning ahead indicators.</p>
        </div>
      )}
    </section>
  );
}
