import '../styles/vistas.css'

/** Interruptor al estilo de macOS. */
export function Switch({
  checked,
  label,
  title,
  disabled = false,
  onChange,
}: {
  checked: boolean
  label: string
  title?: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  )
}
