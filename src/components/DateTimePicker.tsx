import { useMemo } from 'react'
import { Clock, Sun, CalendarDays } from 'lucide-react'

interface DateTimePickerProps {
  onSelect: (isoString: string) => void
  onCancel: () => void
  label?: string
}

function getPresets(): Array<{ label: string; icon: typeof Clock; iso: string }> {
  const now = new Date()

  // Later Today: 5 PM today, or +3 hours if already past 5 PM
  const laterToday = new Date(now)
  if (now.getHours() < 17) {
    laterToday.setHours(17, 0, 0, 0)
  } else {
    laterToday.setTime(now.getTime() + 3 * 60 * 60 * 1000)
    laterToday.setMinutes(0, 0, 0)
  }

  // Tomorrow 9 AM
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)

  // Next Monday 9 AM
  const nextMonday = new Date(now)
  const dayOfWeek = nextMonday.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek)
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday)
  nextMonday.setHours(9, 0, 0, 0)

  return [
    { label: 'Later Today', icon: Clock, iso: laterToday.toISOString() },
    { label: 'Tomorrow 9 AM', icon: Sun, iso: tomorrow.toISOString() },
    { label: 'Next Monday', icon: CalendarDays, iso: nextMonday.toISOString() },
  ]
}

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function DateTimePicker({ onSelect, onCancel, label }: DateTimePickerProps) {
  const presets = useMemo(() => getPresets(), [])
  const minValue = toLocalDatetimeValue(new Date())

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value) {
      onSelect(new Date(value).toISOString())
    }
  }

  return (
    <div className="dtp-container">
      <style>{`
        .dtp-container {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px;
          min-width: 220px;
        }
        .dtp-label {
          font-size: 11px;
          font-weight: 600;
          color: rgb(var(--color-text-secondary));
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .dtp-preset-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: rgb(var(--color-text-primary));
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease;
          text-align: left;
        }
        .dtp-preset-btn:hover {
          background: rgba(var(--color-text-primary), 0.06);
        }
        .dtp-preset-btn svg {
          width: 15px;
          height: 15px;
          color: rgb(var(--color-accent));
          flex-shrink: 0;
        }
        .dtp-divider {
          height: 1px;
          background: rgba(var(--color-border), 0.5);
          margin: 4px 0;
        }
        .dtp-custom-label {
          font-size: 11px;
          font-weight: 500;
          color: rgb(var(--color-text-secondary));
          margin-bottom: 2px;
        }
        .dtp-input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid rgba(var(--color-border), 0.7);
          border-radius: 6px;
          background: rgb(var(--color-bg-tertiary));
          color: rgb(var(--color-text-primary));
          font-size: 13px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          color-scheme: inherit;
        }
        .dtp-input:focus {
          border-color: rgba(var(--color-accent), 0.8);
          box-shadow: 0 0 0 3px rgba(var(--color-accent), 0.14);
        }
        .dtp-cancel-btn {
          padding: 6px 10px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: rgb(var(--color-text-secondary));
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          text-align: center;
          transition: background 0.15s ease;
        }
        .dtp-cancel-btn:hover {
          background: rgba(var(--color-text-primary), 0.06);
        }
      `}</style>

      {label && <div className="dtp-label">{label}</div>}

      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className="dtp-preset-btn"
          onClick={() => onSelect(preset.iso)}
        >
          <preset.icon />
          {preset.label}
        </button>
      ))}

      <div className="dtp-divider" />

      <div className="dtp-custom-label">Custom date & time</div>
      <input
        type="datetime-local"
        className="dtp-input"
        min={minValue}
        onChange={handleCustomChange}
        aria-label="Pick a custom date and time"
      />

      <button type="button" className="dtp-cancel-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
