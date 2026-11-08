"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import type { CustomerId } from "@/lib/api";
import {
  goTo,
  highlightMetric,
  loadCustomer,
  openConnect,
  proposeTransfer,
  refreshPlaid,
  resetDemo,
  switchCustomer,
  updatePlan,
} from "@/lib/actions";
import { useApp, type Screen } from "@/lib/store";
import { TodayScreen } from "./screens/Today";
import { ForecastScreen } from "./screens/Forecast";
import { FuturesScreen } from "./screens/Futures";
import { NextStepScreen } from "./screens/NextStep";
import { WhatIfDrawer } from "./WhatIfDrawer";
import { Logo, OrbScene } from "./Logo";
import { MathSheet } from "./MathSheet";
import { ActivityPanel } from "./ActivityPanel";
import { TransferSheet } from "./TransferSheet";
import { ConnectSheet, SandboxBanner } from "./ConnectBank";
import { IconChevronDown, IconForecast, IconHome, IconNext, IconOrb, IconRefresh } from "./icons";
import { Hero } from "./ui";

const TABS: { id: Screen; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "today", label: "Today", Icon: IconHome },
  { id: "forecast", label: "Forecast", Icon: IconForecast },
  { id: "futures", label: "2031", Icon: IconOrb },
  { id: "next", label: "Next step", Icon: IconNext },
];

export function App() {
  const screen = useApp((s) => s.screen);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const hasData = useApp((s) => s.profile !== null && s.health !== null);
  const hasForecast = useApp((s) => s.forecast !== null);
  const hasFutures = useApp((s) => s.futures !== null);

  const frameRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    void loadCustomer();
    void refreshPlaid();
    // Dev handle for trying the agent tools from the console, e.g. futureYou.highlightMetric("health.credit_health").
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { futureYou: unknown }).futureYou = { updatePlan, proposeTransfer, highlightMetric };
    }
  }, []);

  // The header floats over the screen; its height (taller with the sandbox banner or an error) becomes
  // --header-h, which every hero uses as its top padding.
  useEffect(() => {
    const header = headerRef.current;
    const frame = frameRef.current;
    if (!header || !frame) return;
    const sync = () => frame.style.setProperty("--header-h", `${header.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Each screen starts at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center gap-8 bg-[#050506] sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(255,255,255,0.045),transparent_70%),radial-gradient(40%_40%_at_100%_100%,rgba(255,255,255,0.025),transparent_70%)]"
      />

      {/* Phone frame. On a real phone it goes full-bleed. */}
      <div
        ref={frameRef}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-obsidian text-snow antialiased sm:h-[844px] sm:max-h-[calc(100dvh-3rem)] sm:w-[400px] sm:rounded-[48px] sm:shadow-[0_0_0_10px_#000,0_0_0_11px_rgba(255,255,255,0.1),0_50px_120px_-30px_rgba(0,0,0,0.95)]"
      >
        <div
          ref={headerRef}
          className={`absolute inset-x-0 top-0 z-20 border-b transition-colors duration-200 ${
            scrolled ? "border-white/[0.06] bg-obsidian/80 backdrop-blur-xl" : "border-transparent"
          }`}
        >
          <Header />
          <SandboxBanner />
          {error && (
            <div role="alert" className="mx-4 mb-3 rounded-2xl border border-poor/30 bg-poor/10 px-3.5 py-2.5 text-sm leading-snug text-[#fecaca]">
              {error}
            </div>
          )}
        </div>

        <main
          ref={mainRef}
          id="phone-screen"
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
          className="phone-scroll flex flex-1 flex-col overflow-y-auto overflow-x-hidden"
        >
          {!hasData ? (
            <Loading busy={loading} />
          ) : (
            <>
              {screen === "today" && <TodayScreen />}
              {screen === "forecast" && (hasForecast ? <ForecastScreen /> : <Unavailable />)}
              {screen === "futures" && (hasFutures ? <FuturesScreen /> : <Unavailable />)}
              {screen === "next" && (hasFutures ? <NextStepScreen /> : <Unavailable />)}
            </>
          )}
        </main>

        <nav
          aria-label="Screens"
          className="absolute bottom-[max(22px,env(safe-area-inset-bottom))] left-1/2 z-20 flex w-max -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.08] bg-raised p-1.5 shadow-[0_18px_40px_-12px_rgba(10,10,11,0.6),0_2px_8px_rgba(10,10,11,0.25)]"
        >
          {TABS.map(({ id, label, Icon }) =>
            screen === id ? (
              <button
                key={id}
                onClick={() => goTo(id)}
                aria-current="page"
                className="flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-snow pl-[15px] pr-[18px] text-sm font-semibold text-ink"
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ) : (
              <button
                key={id}
                onClick={() => goTo(id)}
                aria-label={label}
                className="flex h-12 w-12 items-center justify-center rounded-full text-fog transition hover:bg-white/[0.06] hover:text-snow"
              >
                <Icon className="h-5 w-5" />
              </button>
            ),
          )}
        </nav>

        <WhatIfDrawer />
        <MathSheet />
        <TransferSheet />
        <ConnectSheet />
      </div>

      {/* Agent activity panel (M9): beside the phone on laptop screens, where judges can see it. */}
      <aside id="activity-panel" aria-label="Agent activity" className="hidden h-[844px] max-h-[calc(100dvh-3rem)] w-[340px] shrink-0 lg:block">
        <ActivityPanel />
      </aside>
    </div>
  );
}

function Loading({ busy }: { busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      {busy && (
        <>
          <OrbScene width={150} height={132} />
          <p className="text-sm text-fog">Loading your accounts…</p>
        </>
      )}
    </div>
  );
}

/** A screen that can't be shown for this customer (a sandbox bank with too little history). */
function Unavailable() {
  const reason = useApp((s) => s.unavailable);
  return (
    <div className="flex flex-1 flex-col">
      <Hero className="pb-10">
        <div className="glass rounded-[26px] px-5 py-4 text-[15px] leading-relaxed text-snow">
          {reason ?? "This screen isn't available for this customer."}
        </div>
        <button
          onClick={() => goTo("today")}
          className="glass mt-4 inline-flex h-11 items-center rounded-full px-5 text-sm font-medium text-snow transition hover:bg-white/10"
        >
          Back to Today
        </button>
      </Hero>
    </div>
  );
}

const CONNECT = "__connect__";

function Header() {
  const customer = useApp((s) => s.customer);
  const plaid = useApp((s) => s.plaid);
  const label = customer === "sandbox" ? (plaid.connection?.label ?? "Sandbox bank") : customer === "household" ? "Jordan & Priya" : "Maya";
  return (
    <header className="flex h-[72px] items-center justify-between gap-2 px-5">
      <div className="flex min-w-0 items-center gap-2">
        <Logo size={32} />
        <span className="hidden truncate text-[15px] font-semibold tracking-[-0.015em] text-snow min-[380px]:inline">Two Futures</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative">
          <label className="sr-only" htmlFor="customer">
            Customer
          </label>
          <span
            aria-hidden
            className="pointer-events-none absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-snow text-[13px] font-semibold text-ink"
          >
            {label.charAt(0)}
          </span>
          <select
            id="customer"
            value={customer}
            onChange={(e) => {
              if (e.target.value === CONNECT) openConnect(true);
              else switchCustomer(e.target.value as CustomerId);
            }}
            className="glass h-11 w-[164px] cursor-pointer appearance-none truncate rounded-full pl-[44px] pr-7 text-[12.5px] font-medium text-snow [color-scheme:dark] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <option value="maya">Maya</option>
            <option value="household">Jordan & Priya</option>
            {plaid.connection && <option value="sandbox">{plaid.connection.label}</option>}
            {plaid.configured && <option value={CONNECT}>{plaid.connection ? "Reconnect a bank (sandbox)…" : "Connect a bank (sandbox)…"}</option>}
          </select>
          <IconChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fog" strokeWidth={2} />
        </div>
        <button
          onClick={() => void resetDemo()}
          title="Reset demo"
          aria-label="Reset demo"
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-[#d4d4d8] transition hover:bg-white/10 hover:text-snow"
        >
          <IconRefresh className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
