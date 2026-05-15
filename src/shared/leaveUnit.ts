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

/** UI表示用ラベル */
export const LEAVE_UNIT_LABELS: Record<LeaveUnit, string> = {
  full_day: '全休',
  am_half: '午前休',
  pm_half: '午後休'
}
