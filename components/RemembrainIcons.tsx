/** Thin-stroke UI icons for Remembrain (geometric, professional). */

import type { SVGProps } from "react";

export function IconGear(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconNotebookEmpty(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden {...props}>
      <rect x="14" y="8" width="36" height="48" rx="4" fill="#f5f5f5" stroke="#e5e5e5" strokeWidth="2" />
      <path d="M22 18h20M22 26h16M22 34h20" stroke="#d4d4d4" strokeWidth="2" strokeLinecap="round" />
      <circle cx="46" cy="14" r="2" fill="#d4d4d4" />
    </svg>
  );
}

export function IconChatBubbleEmpty(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden {...props}>
      <path
        d="M12 18c0-3.3 2.7-6 6-6h28c3.3 0 6 2.7 6 6v18c0 3.3-2.7 6-6 6H26l-10 8v-8h-4c-3.3 0-6-2.7-6-6V18z"
        fill="#f5f5f5"
        stroke="#e5e5e5"
        strokeWidth="2"
      />
      <path d="M22 24h20M22 32h12" stroke="#d4d4d4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconSearchEmpty(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden {...props}>
      <circle cx="28" cy="28" r="14" fill="none" stroke="#e5e5e5" strokeWidth="2.5" />
      <path d="M38 38l12 12" stroke="#e5e5e5" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M22 28h12" stroke="#d4d4d4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconPencil(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" aria-hidden {...props}>
      <path
        d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" aria-hidden {...props}>
      <path
        d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
