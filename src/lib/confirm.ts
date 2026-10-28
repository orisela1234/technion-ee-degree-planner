import { useSyncExternalStore } from 'react'

/** דיאלוג אישור קטן שמחזיר Promise – למשל לשיבוץ בלי קדם באישור חריג */
export interface ConfirmRequest {
  title: string
  lines?: string[]
  note?: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'normal'
  /** פעולה בטוחה שקודמת לאישור (למשל הורדת גיבוי) – כפתור ראשי שמריץ אותה ואז מאשר */
  alt?: { label: string; run: () => void }
  resolve: (ok: boolean) => void
}

let current: ConfirmRequest | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function askConfirm(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  current?.resolve(false)
  return new Promise((resolve) => {
    current = { ...req, resolve }
    emit()
  })
}

export function answerConfirm(ok: boolean) {
  const c = current
  current = null
  emit()
  c?.resolve(ok)
}

export const useConfirm = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => current)
