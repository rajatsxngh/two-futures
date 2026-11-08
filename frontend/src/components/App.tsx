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
  // The judges' activity log appears once there is something to show: a call starting or a tool event.
  const showActivity = useApp((s) => s.toolEvents.length > 0 || s.voiceStatus === "connected" || s.voiceStatus === "connecting");

  const frameRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const phoneScale = usePhoneScale();

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
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#040405] sm:p-6">
      <Backdrop />

      {/* Phone. On a real phone the app goes full-bleed. On a laptop it sits in an iPhone-style device
          with a real phone's 390 x 844 screen, and the whole device scales down evenly when the window is short. */}
      <div
        className="relative h-[100dvh] w-full shrink-0 sm:h-auto sm:w-auto"
        style={phoneScale ? { width: DEVICE_W * phoneScale, height: DEVICE_H * phoneScale } : undefined}
      >
      <div
        style={phoneScale ? { transform: `scale(${phoneScale})`, transformOrigin: "top left" } : undefined}
        className="relative h-full w-full sm:h-[874px] sm:w-[420px] sm:rounded-[64px] sm:border-[3px] sm:border-transparent sm:p-[12px] sm:[background:linear-gradient(#050505,#050505)_padding-box,linear-gradient(150deg,#8d8d93_0%,#3a3a3e_18%,#1d1d20_40%,#6e6e74_58%,#232326_78%,#9a9aa0_100%)_border-box] sm:shadow-[0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.08),0_60px_140px_-30px_rgba(0,0,0,0.95),0_30px_60px_-20px_rgba(255,106,26,0.18)]"
      >
        <DeviceButtons />
      <div
        ref={frameRef}
        className="relative flex h-full w-full flex-col overflow-hidden bg-obsidian text-snow antialiased sm:h-[844px] sm:w-[390px] sm:rounded-[52px]"
      >
        {/* Dynamic Island and home indicator: device chrome, laptop view only. */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[11px] z-40 hidden h-[35px] w-[122px] -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] sm:block">
          <span className="absolute right-[14px] top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_35%,#2b3a55,#0a0d14_60%)] shadow-[inset_0_0_0_1.5px_#141820]" />
        </div>
        <div aria-hidden className="pointer-events-none absolute bottom-[8px] left-1/2 z-40 hidden h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white mix-blend-difference sm:block" />

        <div
          ref={headerRef}
          className={`absolute inset-x-0 top-0 z-20 border-b transition-colors duration-200 ${
            scrolled ? "border-white/[0.06] bg-obsidian/80 backdrop-blur-xl" : "border-transparent"
          }`}
        >
          <StatusBar />
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
      </div>
      </div>

      {/* Agent activity panel (M9): beside the phone on laptop screens, where judges can see it.
          It stays tucked away until the agent starts working, then slides in. */}
      <aside
        id="activity-panel"
        aria-label="Agent activity"
        aria-hidden={!showActivity}
        style={{ height: DEVICE_H * (phoneScale ?? 1) }}
        className={`hidden shrink-0 overflow-hidden transition-[width,margin,opacity,transform] duration-500 ease-out lg:block ${
          showActivity ? "ml-8 w-[340px] translate-x-0 opacity-100" : "pointer-events-none ml-0 w-0 translate-x-6 opacity-0"
        }`}
      >
        <div className="h-full w-[340px]">
          <ActivityPanel />
        </div>
      </aside>
    </div>
  );
}

// A real phone's screen is 390 x 844 CSS pixels (iPhone 14/15); the device adds a 12px bezel and a 3px titanium band.
const DEVICE_W = 390 + 2 * 15;
const DEVICE_H = 844 + 2 * 15;
const FRAME_MARGIN = 56; // room around the device for its shadow

/** On laptop-sized windows, how much to shrink the phone so all of it fits; null on real phones (full-bleed). */
function usePhoneScale(): number | null {
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => {
      if (window.innerWidth < 640) return setScale(null);
      setScale(Math.min(1, (window.innerHeight - FRAME_MARGIN) / DEVICE_H));
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return scale;
}

/** The page behind the phone: a warm glow behind the device, a soft top light, a faint grid and a vignette. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_-5%,rgba(255,255,255,0.07),transparent_70%)]" />
      <div className="absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,106,26,0.22),rgba(255,106,26,0.07)_45%,transparent_75%)] blur-2xl" />
      <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_55%,rgba(0,0,0,0.75))]" />
    </div>
  );
}

/** Titanium side buttons: action button and volume on the left, side button on the right. Laptop view only. */
function DeviceButtons() {
  const metal = "absolute hidden w-[4px] bg-[linear-gradient(90deg,#2a2a2d,#8d8d93_45%,#3a3a3e)] sm:block";
  return (
    <div aria-hidden>
      <span className={`${metal} -left-[6px] top-[150px] h-[32px] rounded-l-[3px]`} />
      <span className={`${metal} -left-[6px] top-[210px] h-[62px] rounded-l-[3px]`} />
      <span className={`${metal} -left-[6px] top-[286px] h-[62px] rounded-l-[3px]`} />
      <span className={`${metal} -right-[6px] top-[230px] h-[96px] rounded-r-[3px]`} />
    </div>
  );
}

/** iPhone-style status bar above the app header (laptop view only; a real phone shows its own). */
function StatusBar() {
  return (
    <div aria-hidden className="hidden h-[50px] items-center justify-between px-[34px] pt-[6px] text-[15px] font-semibold tracking-tight text-snow sm:flex">
      <span>9:41</span>
      <span className="flex items-center gap-[6px]">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4 10.6 10.6 0 0 0 .5 3.4l1.2 1.3A8.9 8.9 0 0 1 8 2.2Z" />
          <path d="M8 5.6c1.5 0 2.9.6 4 1.6l1.2-1.3A7.4 7.4 0 0 0 8 3.8c-2 0-3.8.8-5.2 2.1L4 7.2a5.6 5.6 0 0 1 4-1.6Z" />
          <path d="M8 9a2.3 2.3 0 0 1 1.7.7L8 11.6 6.3 9.7A2.3 2.3 0 0 1 8 9Z" />
        </svg>
        <span className="relative ml-[2px] flex h-[13px] w-[27px] items-center rounded-[4px] border border-snow/40 p-[1.5px]">
          <span className="h-full w-[78%] rounded-[2px] bg-snow" />
          <span className="absolute -right-[3px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r bg-snow/40" />
        </span>
      </span>
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
