/** 有給休暇 取得単位の型・マッピング定数（フロントエンド・バックエンド共通） */

export type LeaveUnit = 'full_day' | 'am_half' | 'pm_half'

/** freee HR API (POST /approval_requests/paid_holidays) の values[].type 値 */
export const LEAVE_UNIT_TO_API: Record<LeaveUnit, string> = {
  full_day: 'full',
  am_half: 'morning',
  pm_half: 'afternoon'
}

/** Web画面 select#approval-request-fields-usage_day の value */
export const LEAVE_UNIT_TO_WEB: Record<LeaveUnit, string> = {
  full_day: 'full',
  am_half: 'morning',
  pm_half: 'afternoon'
}

/** 現行Web画面 select#approval-request-fields-holiday-category の value */
export const LEAVE_UNIT_TO_HOLIDAY_CATEGORY_WEB: Record<LeaveUnit, string> = {
  full_day: 'annual_paid_holiday:full',
  am_half: 'annual_paid_holiday:morning_off',
  pm_half: 'annual_paid_holiday:afternoon_off'
}

/** UI表示用ラベル */
export const LEAVE_UNIT_LABELS: Record<LeaveUnit, string> = {
  full_day: '全休',
  am_half: '午前休',
  pm_half: '午後休'
}

/** 現行Web画面の休暇種別ラベル */
export const LEAVE_UNIT_HOLIDAY_CATEGORY_LABELS: Record<LeaveUnit, string> = {
  full_day: '有休',
  am_half: '有休（午前休）',
  pm_half: '有休（午後休）'
}
