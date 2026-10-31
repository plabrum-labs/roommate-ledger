const PATHS = {
  home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z',
  split: 'M12 3v6M12 9l-6 6v6M12 9l6 6v6',
  statement: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8',
  invoice: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  posting: 'M4 6h16M4 18h16M9 3v18M15 3v18',
  payment: 'M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',
  parties:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M17 6a3 3 0 0 1 0 5M18 14a5 5 0 0 1 3 5v1',
  close: 'M6 6l12 12M18 6L6 18',
  voidmark: 'M6 18L18 6'
} as const

export type IconName = keyof typeof PATHS

const CIRCLED: ReadonlySet<IconName> = new Set<IconName>(['payment', 'voidmark'])

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {CIRCLED.has(name) && <circle cx="12" cy="12" r="9" />}
      <path d={PATHS[name]} />
    </svg>
  )
}
