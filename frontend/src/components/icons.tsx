/**
 * One stroke icon set (20 x 20 grid, round caps, currentColor) so every screen speaks the same visual language.
 * Decorative by default: pair each with visible text or an aria-label on its button.
 */
import type { ComponentType, ReactNode } from "react";

export type IconProps = { className?: string; strokeWidth?: number };

function Svg({ className = "h-5 w-5", strokeWidth = 1.8, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.6 10 4l6.5 5.6V16a1 1 0 0 1-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 0 1-1-1V9.6Z" />
  </Svg>
);

export const IconForecast = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 14.5l4-4.5 3 3 4.5-6 2.5 3" />
    <path d="M3 17.5h14" />
  </Svg>
);

/** The 2031 tab: the split orb as a one-color glyph (outline = same path, solid = the plan). */
export const IconOrb = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
    <path d="M8.6 4A6.4 6.4 0 0 0 8.6 16.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M10.7 2.3A7.3 7.3 0 0 1 10.7 16.9Z" fill="currentColor" />
  </svg>
);

export const IconNext = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10h11.5" />
    <path d="M11 5.5 15.5 10 11 14.5" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10h12" />
    <path d="M11.5 5.5 16 10l-4.5 4.5" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 16V4.5" />
    <path d="M5 9l5-5 5 5" />
  </Svg>
);

export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="5" height="5" rx="1.5" />
    <rect x="11.5" y="3.5" width="5" height="5" rx="1.5" />
    <rect x="3.5" y="11.5" width="5" height="5" rx="1.5" />
    <rect x="11.5" y="11.5" width="5" height="5" rx="1.5" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1" />
    <path d="M4.5 3.5v3h3" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 8 10 12.5 14.5 8" />
  </Svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.5 5 7.5 10l5 5" />
  </Svg>
);

export const IconMic = ({ muted = false, ...p }: IconProps & { muted?: boolean }) => (
  <Svg {...p}>
    <rect x="7.5" y="2.5" width="5" height="10" rx="2.5" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0" />
    <path d="M10 15v2.5" />
    {muted && <path d="M3 3l14 14" />}
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 10.5 3.2 3.2L15 6.8" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 9v4.5M10 6.3v.2" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.5 4 5v4.6c0 3.7 2.5 6.6 6 7.9 3.5-1.3 6-4.2 6-7.9V5l-6-2.5Z" />
    <path d="m7.5 10 1.8 1.8 3.4-3.6" />
  </Svg>
);

export const IconBank = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.2 10 4l7 4.2" />
    <path d="M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6" />
    <path d="M3 16.5h14" />
  </Svg>
);

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" />
    <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 7V5.8A1.8 1.8 0 0 0 13.7 4H5.3A2.3 2.3 0 0 0 3 6.3v7.4A2.3 2.3 0 0 0 5.3 16h10.2a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 15.5 7H5" />
    <circle cx="13.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconVault = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="13" height="11.5" rx="3" />
    <circle cx="10" cy="9.75" r="2.6" />
    <path d="M6.5 15.5v1.5M13.5 15.5v1.5" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="9" width="11" height="8" rx="2" />
    <path d="M7 9V7a3 3 0 0 1 6 0v2" />
  </Svg>
);

export const IconSprout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 17v-6" />
    <path d="M10 11c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5Z" />
    <path d="M10 12.5C10 9.8 8 8 5 8c0 2.7 2 4.5 5 4.5Z" />
  </Svg>
);

export const IconCar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12.5 6 8.2A1.8 1.8 0 0 1 7.7 7h4.6a1.8 1.8 0 0 1 1.7 1.2l1.5 4.3" />
    <rect x="3" y="12" width="14" height="3.8" rx="1.5" />
    <path d="M5.5 15.8v1.4M14.5 15.8v1.4" />
  </Svg>
);

export const IconCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="15" height="10.5" rx="2.2" />
    <path d="M2.5 8.5h15" />
    <path d="M5.5 12.5h3" />
  </Svg>
);

export const IconHouse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9 10 3.8 16.5 9" />
    <path d="M5 8v8.2h10V8" />
    <path d="M8.5 16.2v-4h3v4" />
  </Svg>
);

export const IconReceipt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 2.8h10v14.4l-2.5-1.5-2.5 1.5-2.5-1.5L5 17.2V2.8Z" />
    <path d="M7.5 7h5M7.5 10h5" />
  </Svg>
);

/** The glyph for each account type (the API's AccountType values). */
export const ACCOUNT_ICON: Record<string, ComponentType<IconProps>> = {
  checking: IconWallet,
  savings: IconVault,
  cd: IconLock,
  ira: IconSprout,
  auto_loan: IconCar,
  personal_loan: IconReceipt,
  credit_card: IconCard,
  mortgage: IconHouse,
};
