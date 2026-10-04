import type { CSSProperties } from 'react'

interface Option<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Control segmentado al estilo de macOS, con la selección deslizándose. */
export function Segmented<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T
  options: Option<T>[]
  label: string
  onChange: (value: T) => void
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      className="segmented"
      role="tablist"
      aria-label={label}
      style={{ '--count': options.length, '--index': index } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
