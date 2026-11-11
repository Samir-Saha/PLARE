import type { SVGProps } from "react";

/** Inline stroke icons (24px grid, 1.75 stroke). Decorative by default; label the control, not the icon. */
function Svg({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...rest}>
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const IconTasks = (p: P) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
export const IconCalendar = (p: P) => <Svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></Svg>;
export const IconInbox = (p: P) => <Svg {...p}><path d="M4 13.5 6.2 5.8A2.5 2.5 0 0 1 8.6 4h6.8a2.5 2.5 0 0 1 2.4 1.8L20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" /></Svg>;
export const IconUsers = (p: P) => <Svg {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M3 19.5a6 6 0 0 1 12 0" /><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.2a6 6 0 0 1 3.5 5.3" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>;
export const IconLogout = (p: P) => <Svg {...p}><path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" /><path d="M10 8l-4 4 4 4M6 12h9" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5.5 12.5 4 4 9-9" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconGrid = (p: P) => <Svg {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></Svg>;
export const IconHome = (p: P) => <Svg {...p}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Svg>;
export const IconLog = (p: P) => <Svg {...p}><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4" /></Svg>;
export const IconCoffee = (p: P) => <Svg {...p}><path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" /><path d="M16.5 10.5h1.25a2.75 2.75 0 0 1 0 5.5H16M8.5 3.5v2.5M12.5 3.5v2.5" /></Svg>;
export const IconNote = (p: P) => <Svg {...p}><path d="M6.5 3.5h8l4 4v11A2.5 2.5 0 0 1 16 21H6.5A2.5 2.5 0 0 1 4 18.5V6a2.5 2.5 0 0 1 2.5-2.5z" /><path d="M14 3.5V8h4.5M8 13l2.5 2.5L15 11" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>;
export const IconTarget = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></Svg>;
export const IconLayers = (p: P) => <Svg {...p}><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></Svg>;
export const IconChevronLeft = (p: P) => <Svg {...p}><path d="m14.5 6-6 6 6 6" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>;
export const IconBolt = (p: P) => <Svg {...p}><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" /></Svg>;
export const IconBars = (p: P) => <Svg {...p}><path d="M6 20v-6M12 20V9M18 20V4" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 4 3 19.5h18z" /><path d="M12 10v4M12 17v.01" /></Svg>;
