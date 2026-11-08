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
import { IconCheck } from "./icons";

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

const CHIP_ON = "border-ink bg-ink text-snow";
const CHIP_OFF = "border-hair bg-white text-ink-2 hover:border-ink-3/40 hover:text-ink";

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
    <section className="mt-7 rounded-[24px] bg-tile p-4 pl-[18px]" aria-label="Two quick questions">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Two quick questions</h2>
          <p className="mt-1 text-[13px] leading-[1.4] text-ink-3">
            {count} of 4 insurance types · plans ahead: {setup.planning_ahead}
            {saving ? " · updating your score…" : ""}
          </p>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="h-11 shrink-0 rounded-full border border-hair bg-white px-[18px] text-sm font-semibold text-ink transition hover:border-ink-3/40"
        >
          {open ? "Done" : "Edit"}
        </button>
      </div>
      {open && (
        <div className="fade-in mt-4 space-y-4">
          <fieldset>
            <legend className="text-[13px] font-semibold text-ink-2">1. Which insurance do you have?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {INSURANCE.map((i) => {
                const on = setup.insurance[i.key];
                return (
                  <button
                    key={i.key}
                    aria-pressed={on}
                    disabled={saving}
                    onClick={() => void save({ ...setup, insurance: { ...setup.insurance, [i.key]: !on } })}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold transition disabled:opacity-60 ${on ? CHIP_ON : CHIP_OFF}`}
                  >
                    {on && <IconCheck className="h-4 w-4" strokeWidth={2.2} />}
                    {i.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-[13px] font-semibold text-ink-2">2. Do you plan ahead for big expenses?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLANNING.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={setup.planning_ahead === p.id}
                  disabled={saving}
                  onClick={() => void save({ ...setup, planning_ahead: p.id })}
                  className={`h-11 rounded-full border px-4 text-[13px] font-semibold transition disabled:opacity-60 ${setup.planning_ahead === p.id ? CHIP_ON : CHIP_OFF}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-xs leading-snug text-ink-3">Pre-filled for the demo. These feed the Insurance and Planning ahead indicators.</p>
        </div>
      )}
    </section>
  );
}
