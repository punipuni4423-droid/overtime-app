import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Calendar, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import DatePicker, { registerLocale } from 'react-datepicker'
import { ja } from 'date-fns/locale/ja'

registerLocale('ja', ja)

export function dateToStr(d: Date | null): string {
  if (!d) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function strToDate(s: string): Date | null {
  if (!s) return null
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function formatDateDisplay(dateStr: string): string {
  const d = strToDate(dateStr)
  if (!d) return dateStr
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(value: string, days: number, filterDate?: (date: Date) => boolean): string {
  const d = strToDate(value)
  if (!d) return value

  if (!filterDate) {
    d.setDate(d.getDate() + days)
    return dateToStr(d)
  }

  for (let i = 0; i < 370; i++) {
    d.setDate(d.getDate() + days)
    if (filterDate(d)) return dateToStr(d)
  }
  return value
}

export function choiceButtonClass(selected: boolean): string {
  return [
    'rounded-lg border px-3 py-2 text-sm font-semibold transition-all',
    'focus:outline-none focus:ring-2 focus:ring-[#007B7E]/30',
    selected
      ? 'border-[#007B7E] bg-[#007B7E] text-white shadow-sm'
      : 'border-gray-200 bg-white text-gray-600 hover:border-[#007B7E] hover:bg-[#f0fafa] hover:text-[#007B7E]',
  ].join(' ')
}

export function DateModeToggle({
  rangeMode,
  multiMode,
  onRangeModeChange,
  onMultiModeChange,
}: {
  rangeMode: boolean
  multiMode: boolean
  onRangeModeChange: (checked: boolean) => void
  onMultiModeChange: (checked: boolean) => void
}) {
  const mode = rangeMode ? 'range' : multiMode ? 'multi' : 'single'

  const setMode = (next: 'single' | 'range' | 'multi'): void => {
    onRangeModeChange(next === 'range')
    onMultiModeChange(next === 'multi')
  }

  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
      <button type="button" onClick={() => setMode('single')} className={choiceButtonClass(mode === 'single')}>
        単日
      </button>
      <button type="button" onClick={() => setMode('range')} className={choiceButtonClass(mode === 'range')}>
        <span className="inline-flex items-center justify-center gap-1">
          <CalendarRange size={13} />
          期間
        </span>
      </button>
      <button type="button" onClick={() => setMode('multi')} className={choiceButtonClass(mode === 'multi')}>
        <span className="inline-flex items-center justify-center gap-1">
          <Calendar size={13} />
          複数日
        </span>
      </button>
    </div>
  )
}

export function DateStepper({
  value,
  onChange,
  startDate,
  endDate,
  filterDate,
}: {
  value: string
  onChange: (v: string) => void
  startDate?: Date | null
  endDate?: Date | null
  filterDate?: (date: Date) => boolean
}) {
  const [inputText, setInputText] = useState(formatDateDisplay(value))
  const [calendarOpen, setCalendarOpen] = useState(false)

  useEffect(() => {
    setInputText(formatDateDisplay(value))
  }, [value])

  const handleInputBlur = (): void => {
    const parsed = strToDate(inputText.replace(/\//g, '-'))
    if (parsed && (!filterDate || filterDate(parsed))) onChange(dateToStr(parsed))
    else setInputText(formatDateDisplay(value))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') handleInputBlur()
  }

  const buttonClass = [
    'flex h-[42px] w-9 items-center justify-center border-y border-r border-gray-300',
    'bg-white text-gray-400 transition-colors hover:bg-[#f0fafa] hover:text-[#007B7E] active:bg-[#e0f5f5]',
  ].join(' ')

  return (
    <div className="relative flex items-stretch">
      <input
        type="text"
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        placeholder="yyyy/mm/dd"
        className="h-[42px] min-w-0 flex-1 rounded-l-xl border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-[#007B7E] focus:ring-1 focus:ring-[#007B7E]"
      />
      <button type="button" onClick={() => onChange(shiftDate(value, -1, filterDate))} className={buttonClass} title="前日">
        <ChevronLeft size={14} strokeWidth={2.5} />
      </button>
      <button type="button" onClick={() => onChange(shiftDate(value, 1, filterDate))} className={buttonClass} title="翌日">
        <ChevronRight size={14} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={() => setCalendarOpen((open) => !open)}
        className={`${buttonClass} rounded-r-xl ${calendarOpen ? 'bg-[#f0fafa] text-[#007B7E]' : ''}`}
        title="カレンダー"
      >
        <Calendar size={14} strokeWidth={2} />
      </button>
      {calendarOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCalendarOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 rounded-xl shadow-xl">
            <DatePicker
              selected={strToDate(value)}
              onChange={(d: Date | null) => {
                if (d) onChange(dateToStr(d))
                setCalendarOpen(false)
              }}
              startDate={startDate}
              endDate={endDate}
              filterDate={filterDate}
              locale="ja"
              inline
            />
          </div>
        </>
      )}
    </div>
  )
}

export function MultiDateCalendar({
  selectedDates,
  onChange,
  filterDate,
}: {
  selectedDates: string[]
  onChange: (dates: string[]) => void
  filterDate?: (date: Date) => boolean
}) {
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates])
  const highlightedDates = useMemo(
    () => selectedDates.map(strToDate).filter((d): d is Date => Boolean(d)),
    [selectedDates],
  )

  const toggleDate = (date: Date | null): void => {
    if (!date) return
    if (filterDate && !filterDate(date)) return
    const dateStr = dateToStr(date)
    if (selectedSet.has(dateStr)) onChange(selectedDates.filter((d) => d !== dateStr))
    else onChange([...selectedDates, dateStr].sort())
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
      <DatePicker
        selected={null}
        onChange={toggleDate}
        inline
        locale="ja"
        highlightDates={highlightedDates}
        filterDate={filterDate}
        dayClassName={(date) => (selectedSet.has(dateToStr(date)) ? 'react-datepicker__day--multi-selected' : '')}
      />
    </div>
  )
}
