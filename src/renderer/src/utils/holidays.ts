/**
 * 日本の祝日判定ユーティリティ
 * 外部ライブラリ不要。アルゴリズムで任意の年の祝日を計算します。
 *
 * 対応: 元日、成人の日、建国記念の日、天皇誕生日、春分の日、昭和の日、
 *       憲法記念日、みどりの日、こどもの日、海の日、山の日、敬老の日、
 *       秋分の日、スポーツの日、文化の日、勤労感謝の日、振替休日
 */

// ─── 春分の日の計算（1900–2099年対応）───
function getVernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4)
}

// ─── 秋分の日の計算（1900–2099年対応）───
function getAutumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4)
}

// ─── 第N月曜日を取得 ───
function getNthMonday(year: number, month: number, n: number): number {
  const firstDay = new Date(year, month - 1, 1).getDay()
  // 月の最初の月曜日の日付
  const firstMonday = firstDay <= 1 ? (1 - firstDay + 1) : (8 - firstDay + 1)
  return firstMonday + (n - 1) * 7
}

// ─── 指定年の全祝日を「YYYY-MM-DD」のSetとして返す ───
export function getJapaneseHolidays(year: number): Set<string> {
  const holidays = new Map<string, string>()

  const addHoliday = (month: number, day: number, name: string) => {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    holidays.set(key, name)
  }

  // ── 固定祝日 ──
  addHoliday(1, 1, '元日')
  addHoliday(2, 11, '建国記念の日')
  addHoliday(2, 23, '天皇誕生日')
  addHoliday(4, 29, '昭和の日')
  addHoliday(5, 3, '憲法記念日')
  addHoliday(5, 4, 'みどりの日')
  addHoliday(5, 5, 'こどもの日')
  addHoliday(8, 11, '山の日')
  addHoliday(11, 3, '文化の日')
  addHoliday(11, 23, '勤労感謝の日')

  // ── 春分の日・秋分の日 ──
  addHoliday(3, getVernalEquinoxDay(year), '春分の日')
  addHoliday(9, getAutumnalEquinoxDay(year), '秋分の日')

  // ── ハッピーマンデー（第N月曜日）──
  addHoliday(1, getNthMonday(year, 1, 2), '成人の日')        // 1月第2月曜
  addHoliday(7, getNthMonday(year, 7, 3), '海の日')          // 7月第3月曜
  addHoliday(9, getNthMonday(year, 9, 3), '敬老の日')        // 9月第3月曜
  addHoliday(10, getNthMonday(year, 10, 2), 'スポーツの日')  // 10月第2月曜

  // ── 振替休日（祝日が日曜 → 翌月曜が休日）──
  const baseHolidayKeys = [...holidays.keys()]
  for (const key of baseHolidayKeys) {
    const d = new Date(key)
    if (d.getDay() === 0) { // 日曜日
      // 翌日から最初の平日（既に祝日でない日）を探す
      let substitute = new Date(d)
      substitute.setDate(substitute.getDate() + 1)
      while (holidays.has(formatDate(substitute)) || substitute.getDay() === 0) {
        substitute.setDate(substitute.getDate() + 1)
      }
      const subKey = formatDate(substitute)
      holidays.set(subKey, '振替休日')
    }
  }

  // ── 国民の休日（祝日と祝日に挟まれた平日）──
  const allKeys = [...holidays.keys()].sort()
  for (let i = 0; i < allKeys.length - 1; i++) {
    const d1 = new Date(allKeys[i])
    const d2 = new Date(allKeys[i + 1])
    const diff = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)
    if (diff === 2) {
      const between = new Date(d1)
      between.setDate(between.getDate() + 1)
      const betweenKey = formatDate(between)
      if (!holidays.has(betweenKey) && between.getDay() !== 0) {
        holidays.set(betweenKey, '国民の休日')
      }
    }
  }

  return new Set(holidays.keys())
}

// ─── 日付を YYYY-MM-DD 形式にフォーマット ───
function formatDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ─── 指定日が日本の祝日かどうか判定 ───
// 複数年にまたがる場合にも対応するため、キャッシュを使用
const holidayCache = new Map<number, Set<string>>()

export function isJapaneseHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4), 10)
  if (!holidayCache.has(year)) {
    holidayCache.set(year, getJapaneseHolidays(year))
  }
  return holidayCache.get(year)!.has(dateStr)
}

// ─── 指定日が「営業日でない」（土日 or 祝日）か判定 ───
export function isNonBusinessDay(dateStr: string): boolean {
  const d = new Date(dateStr)
  const day = d.getDay()
  if (day === 0 || day === 6) return true // 土日
  return isJapaneseHoliday(dateStr)
}
