"use client";

import { useEffect, useRef } from "react";
import type { CustomerId } from "@/lib/api";
import { goTo, highlightMetric, loadCustomer, proposeTransfer, resetDemo, switchCustomer, updatePlan } from "@/lib/actions";
import { useApp, type Screen } from "@/lib/store";
import { TodayScreen } from "./screens/Today";
import { ForecastScreen } from "./screens/Forecast";
import { FuturesScreen } from "./screens/Futures";
import { NextStepScreen } from "./screens/NextStep";
import { WhatIfDrawer } from "./WhatIfDrawer";
import { Logo } from "./Logo";
import { MathSheet } from "./MathSheet";
import { ActivityPanel } from "./ActivityPanel";
import { TransferSheet } from "./TransferSheet";

const TABS: { id: Screen; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1v-6.5Z" },
  { id: "forecast", label: "Forecast", icon: "M3 15l4-5 3 3 4-6 3 4M3 18h14" },
  { id: "futures", label: "2031", icon: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3v4l3 2" },
  { id: "next", label: "Next step", icon: "M4 10h10m-4-5 5 5-5 5" },
];

export function App() {
  const screen = useApp((s) => s.screen);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const hasData = useApp((s) => s.profile !== null && s.health !== null);

  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void loadCustomer();
    // Dev handle for trying the agent tools from the console, e.g. futureYou.highlightMetric("health.credit_health").
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { futureYou: unknown }).futureYou = { updatePlan, proposeTransfer, highlightMetric };
    }
  }, []);

  // Each screen starts at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center gap-8 bg-[#eef1f6] sm:p-6">
      {/* Phone frame. On a real phone it goes full-bleed. */}
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white sm:h-[844px] sm:max-h-[calc(100dvh-3rem)] sm:w-[400px] sm:rounded-[44px] sm:border-[10px] sm:border-navy sm:shadow-2xl">
        <Header />
        <main ref={mainRef} id="phone-screen" className="phone-scroll flex-1 overflow-y-auto">
          {error && (
            <div role="alert" className="mx-4 mt-3 rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
              {error}
            </div>
          )}
          {!hasData ? (
            <div className="flex h-full items-center justify-center text-muted">{loading ? "Loading your accounts..." : ""}</div>
          ) : (
            <>
              {screen === "today" && <TodayScreen />}
              {screen === "forecast" && <ForecastScreen />}
              {screen === "futures" && <FuturesScreen />}
              {screen === "next" && <NextStepScreen />}
            </>
          )}
        </main>
        <p className="border-t border-line bg-surface px-3 py-1 text-center text-[10.5px] leading-snug text-muted">
          Educational demo · made-up data · not financial advice · not a credit score
        </p>
        <WhatIfDrawer />
        <MathSheet />
        <TransferSheet />
        <nav className="grid grid-cols-4 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]" aria-label="Screens">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => goTo(t.id)}
              aria-current={screen === t.id ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${screen === t.id ? "text-accent" : "text-muted"}`}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={t.icon} />
              </svg>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Agent activity panel (M9): beside the phone on laptop screens, where judges can see it. */}
      <aside id="activity-panel" aria-label="Agent activity" className="hidden h-[844px] max-h-[calc(100dvh-3rem)] w-[340px] shrink-0 lg:block">
        <ActivityPanel />
      </aside>
    </div>
  );
}

function Header() {
  const customer = useApp((s) => s.customer);
  return (
    <header className="flex items-center justify-between border-b border-line px-4 pb-2 pt-3">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-base font-semibold text-navy">Two Futures</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="customer">
          Customer
        </label>
        <select
          id="customer"
          value={customer}
          onChange={(e) => switchCustomer(e.target.value as CustomerId)}
          className="rounded-full border border-line bg-surface px-2 py-1 text-xs font-medium text-navy"
        >
          <option value="maya">Maya</option>
          <option value="household">Jordan & Priya</option>
        </select>
        <button
          onClick={() => void resetDemo()}
          title="Reset demo"
          aria-label="Reset demo"
          className="rounded-full border border-line p-1.5 text-muted hover:text-navy"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 10a6 6 0 1 0 2-4.5M4 3v3h3" />
          </svg>
        </button>
      </div>
    </header>
  );
}

