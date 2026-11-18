const common = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const EyeIcon = () => (
  <svg {...common}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = () => (
  <svg {...common}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

/** Point with dashed drop lines to the floor and an axis. */
export const GuidesIcon = () => (
  <svg {...common}>
    <circle cx="16" cy="5" r="2" fill="currentColor" stroke="none" />
    <path d="M16 8v8M16 16l-5 4M16 16h5" strokeDasharray="2 2.5" />
    <path d="M3 21h18" strokeOpacity="0.45" />
  </svg>
);

export const CloseIcon = ({ size = 22 }: { size?: number }) => (
  <svg {...common} width={size} height={size} strokeWidth={2.25}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const ChevronIcon = ({ up }: { up: boolean }) => (
  <svg {...common} style={{ transform: up ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const UndoIcon = () => (
  <svg {...common}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

export const RedoIcon = () => (
  <svg {...common}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </svg>
);

export const CubeIcon = () => (
  <svg {...common}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </svg>
);

/** Same cube as CubeIcon with the top face filled, so it reads as "look down from above". */
export const TopViewIcon = () => (
  <svg {...common}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" strokeOpacity="0.5" />
    <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" fill="currentColor" />
  </svg>
);

export const WrenchIcon = () => (
  <svg {...common}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...common} strokeWidth={2.5}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const MinusIcon = () => (
  <svg {...common} strokeWidth={2.5}>
    <path d="M5 12h14" />
  </svg>
);

/** Four corner brackets: fit everything into the view. */
export const FitIcon = () => (
  <svg {...common}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </svg>
);

export const DoubleChevronIcon = ({ left }: { left: boolean }) => (
  <svg {...common} style={{ transform: left ? undefined : 'rotate(180deg)' }}>
    <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...common}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
