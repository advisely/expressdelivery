import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Sun, CalendarDays } from 'lucide-react'
import styles from './DateTimePicker.module.css'

interface DateTimePickerProps {
  onSelect: (isoString: string) => void
  onCancel: () => void
  label?: string
}

function getPresets(t: (key: string) => string): Array<{ label: string; icon: typeof Clock; iso: string }> {
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
    { label: t('datetime.laterToday'), icon: Clock, iso: laterToday.toISOString() },
    { label: t('datetime.tomorrow9am'), icon: Sun, iso: tomorrow.toISOString() },
    { label: t('datetime.nextMonday'), icon: CalendarDays, iso: nextMonday.toISOString() },
  ]
}

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function DateTimePicker({ onSelect, onCancel, label }: DateTimePickerProps) {
  const { t } = useTranslation()
  const presets = useMemo(() => getPresets(t), [t])
  const minValue = toLocalDatetimeValue(new Date())

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value) {
      onSelect(new Date(value).toISOString())
    }
  }

  return (
    <div className={styles['container']}>
      {label && <div className={styles['label']}>{label}</div>}

      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={styles['preset-btn']}
          onClick={() => onSelect(preset.iso)}
        >
          <preset.icon />
          {preset.label}
        </button>
      ))}

      <div className={styles['divider']} />

      <div className={styles['custom-label']}>{t('datetime.customDateTime')}</div>
      <input
        type="datetime-local"
        className={styles['input']}
        min={minValue}
        onChange={handleCustomChange}
        aria-label={t('datetime.pickCustom')}
      />

      <button type="button" className={styles['cancel-btn']} onClick={onCancel}>
        {t('datetime.cancel')}
      </button>
    </div>
  )
}
