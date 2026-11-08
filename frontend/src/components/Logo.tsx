"use client";

/**
 * Our mark, the split orb: one sphere (you) split into a satin-silver half (the same path) and a glowing
 * ember-glass half (the plan), drifting a little apart with light leaking through the gap.
 *
 * - `Logo` variant "symbol": the bare orb (headers, beside the wordmark).
 * - `Logo` variant "icon": the orb on an obsidian tile (the app icon; app/icon.svg is the same drawing).
 * - `OrbScene`: the larger floating orb with a floor shadow and slow drift (the Meet 2031 card, loading).
 *
 * Every instance gets its own gradient ids (useId), so several can share a page.
 */
import { useId } from "react";

function useIds() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (k: string) => `tf-${uid}-${k}`;
}

/** The sphere's gradients, in the shared 100-unit drawing space. */
function OrbDefs({ id }: { id: (k: string) => string }) {
  return (
    <>
      <radialGradient id={id("glow")} cx="57" cy="47" r="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FF6B1A" stopOpacity="0.5" />
        <stop offset="0.55" stopColor="#FF6B1A" stopOpacity="0.12" />
        <stop offset="1" stopColor="#FF6B1A" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={id("silver")} cx="37" cy="33" r="40" fx="34" fy="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFFFFF" />
        <stop offset="0.14" stopColor="#E4E7EC" />
        <stop offset="0.42" stopColor="#9FA5AE" />
        <stop offset="0.74" stopColor="#474B53" />
        <stop offset="1" stopColor="#18191D" />
      </radialGradient>
      <radialGradient id={id("ember")} cx="58" cy="30" r="42" fx="56" fy="27" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFF6E9" />
        <stop offset="0.12" stopColor="#FFCD9C" />
        <stop offset="0.34" stopColor="#FF9047" />
        <stop offset="0.6" stopColor="#FF6B1A" />
        <stop offset="0.85" stopColor="#C43E08" />
        <stop offset="1" stopColor="#6A1B03" />
      </radialGradient>
      <radialGradient id={id("core")} cx="61" cy="50" r="18" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFB27E" stopOpacity="0.45" />
        <stop offset="1" stopColor="#FFB27E" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={id("edge")} x1="0" y1="21" x2="0" y2="70" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFE7CC" stopOpacity="0.95" />
        <stop offset="1" stopColor="#FF6B1A" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={id("cast")} x1="0" y1="24" x2="0" y2="72" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FF6B1A" stopOpacity="0" />
        <stop offset="0.5" stopColor="#FF8A4C" stopOpacity="0.9" />
        <stop offset="1" stopColor="#FF6B1A" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={id("rim")} x1="0" y1="23" x2="0" y2="73" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.65" />
        <stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.06" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.28" />
      </linearGradient>
      <radialGradient id={id("spec")}>
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={id("floor")}>
        <stop offset="0" stopColor="#000000" stopOpacity="0.85" />
        <stop offset="1" stopColor="#000000" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={id("pool")}>
        <stop offset="0" stopColor="#FF6B1A" stopOpacity="0.55" />
        <stop offset="1" stopColor="#FF6B1A" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

function SilverHalf({ id, rim = false }: { id: (k: string) => string; rim?: boolean }) {
  return (
    <>
      <path d="M48.5 23A25 25 0 0 0 48.5 73Z" fill={`url(#${id("silver")})`} />
      {rim && <path d="M48.5 23.6A24.4 24.4 0 0 0 48.5 72.4" fill="none" stroke={`url(#${id("rim")})`} strokeWidth="0.5" />}
      <path d="M48.9 24V72" stroke={`url(#${id("cast")})`} strokeWidth="0.85" />
      <ellipse cx="38" cy="32.5" rx="7.5" ry="4.2" transform="rotate(-38 38 32.5)" fill={`url(#${id("spec")})`} />
    </>
  );
}

function EmberHalf({ id }: { id: (k: string) => string }) {
  return (
    <>
      <path d="M52 20.5A25 25 0 0 1 52 70.5Z" fill={`url(#${id("ember")})`} />
      <path d="M52 20.5A25 25 0 0 1 52 70.5Z" fill={`url(#${id("core")})`} />
      <path d="M52.4 21.5V69.5" stroke={`url(#${id("edge")})`} strokeWidth="1.1" strokeLinecap="round" />
      <ellipse cx="59.5" cy="28.5" rx="6" ry="3.2" transform="rotate(-24 59.5 28.5)" fill={`url(#${id("spec")})`} opacity="0.7" />
    </>
  );
}

export function Logo({
  size = 32,
  variant = "symbol",
  className = "",
  title,
}: {
  size?: number;
  variant?: "symbol" | "icon";
  className?: string;
  /** Give a title when the mark stands alone (no visible "Two Futures" next to it). */
  title?: string;
}) {
  const id = useIds();
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };

  if (variant === "icon") {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className={className} style={{ borderRadius: size * 0.24 }} {...a11y}>
        <defs>
          <OrbDefs id={id} />
          <linearGradient id={id("tile")} x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2C2C32" />
            <stop offset="0.5" stopColor="#131316" />
            <stop offset="1" stopColor="#08080A" />
          </linearGradient>
          <radialGradient id={id("amb")} cx="62" cy="62" r="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FF6B1A" stopOpacity="0.42" />
            <stop offset="0.5" stopColor="#FF6B1A" stopOpacity="0.1" />
            <stop offset="1" stopColor="#FF6B1A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id("bevel")} x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
            <stop offset="0.3" stopColor="#FFFFFF" stopOpacity="0.05" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="24" fill={`url(#${id("tile")})`} />
        <rect width="100" height="100" rx="24" fill={`url(#${id("amb")})`} />
        <ellipse cx="51" cy="87" rx="25" ry="4.2" fill={`url(#${id("floor")})`} />
        <ellipse cx="60" cy="87" rx="20" ry="3.2" fill={`url(#${id("pool")})`} />
        <g transform="translate(50 47) scale(1.16) translate(-50 -47)">
          <circle cx="57" cy="47" r="30" fill={`url(#${id("glow")})`} />
          <SilverHalf id={id} />
          <EmberHalf id={id} />
        </g>
        <rect x="0.75" y="0.75" width="98.5" height="98.5" rx="23.25" fill="none" stroke={`url(#${id("bevel")})`} strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="20 16 62 62" className={className} style={{ overflow: "visible" }} {...a11y}>
      <defs>
        <OrbDefs id={id} />
      </defs>
      <circle cx="57" cy="47" r="30" fill={`url(#${id("glow")})`} />
      <SilverHalf id={id} />
      <EmberHalf id={id} />
    </svg>
  );
}

/** The floating orb: drifting halves, a breathing glow and a floor shadow. Decorative. */
export function OrbScene({ width = 200, height = 176, className = "" }: { width?: number; height?: number; className?: string }) {
  const id = useIds();
  return (
    <svg width={width} height={height} viewBox="0 3 100 88" className={className} style={{ overflow: "visible" }} aria-hidden>
      <defs>
        <OrbDefs id={id} />
      </defs>
      <ellipse cx="51" cy="82" rx="23" ry="3" fill={`url(#${id("floor")})`} className="origin-own-center animate-orb-shadow" />
      <ellipse cx="60" cy="82" rx="19" ry="2.6" fill={`url(#${id("pool")})`} className="origin-own-center animate-orb-shadow" />
      <g className="animate-orb-float">
        <circle cx="57" cy="47" r="32" fill={`url(#${id("glow")})`} className="animate-orb-glow" />
        <g className="animate-orb-left">
          <SilverHalf id={id} rim />
        </g>
        <g className="animate-orb-right">
          <EmberHalf id={id} />
        </g>
      </g>
    </svg>
  );
}
