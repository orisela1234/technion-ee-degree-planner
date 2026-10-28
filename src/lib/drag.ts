import type { SlotType } from '../data/track'
import { useSyncExternalStore } from 'react'

/**
 * גרירה מבוססת Pointer Events (במקום HTML5 drag&drop):
 * כרטיס צף שעוקב אחרי העכבר, זיהוי שורה/עמודה מתחת לסמן, גלילה אוטומטית ליד הקצוות, Esc לביטול.
 */

export interface DragPayload { itemKey?: string; courseId?: string; /** משבצת כללית חדשה (למשל "מקצועות מעבדה") */ slot?: { type: SlotType; points: number } }
export interface DragOver { sem: string | null; col: number | null; pool: boolean; slotKey: string | null }
export interface DragSnapshot { payload: DragPayload | null; over: DragOver }

const NO_OVER: DragOver = { sem: null, col: null, pool: false, slotKey: null }
let snap: DragSnapshot = { payload: null, over: NO_OVER }
const subs = new Set<() => void>()

function setSnap(next: DragSnapshot) {
  snap = next
  subs.forEach((f) => f())
}

export function useDrag(): DragSnapshot {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f) },
    () => snap,
  )
}

let ghostEl: HTMLElement | null = null
export const setGhostEl = (el: HTMLElement | null) => { ghostEl = el }

type DropHandler = (p: DragPayload, over: DragOver) => void
let dropHandler: DropHandler | null = null
export const setDropHandler = (fn: DropHandler | null) => { dropHandler = fn }

type ColResolver = (rowEl: HTMLElement, x: number) => number | null
let colResolver: ColResolver | null = null
export const setColResolver = (fn: ColResolver | null) => { colResolver = fn }

// לחיצה שמגיעה מיד אחרי גרירה לא נחשבת לחיצה
let suppressClickUntil = 0
if (typeof window !== 'undefined') {
  window.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation()
      e.preventDefault()
    }
  }, true)
}

function resolveOver(x: number, y: number): DragOver {
  const els = document.elementsFromPoint(x, y) as HTMLElement[]
  let sem: string | null = null, col: number | null = null, pool = false, slotKey: string | null = null
  for (const el of els) {
    if (!pool && el.closest('[data-drop-pool]')) pool = true
    if (!slotKey) {
      const s = el.closest<HTMLElement>('[data-slot-key]')
      if (s) slotKey = s.dataset.slotKey ?? null
    }
    if (!sem) {
      const row = el.closest<HTMLElement>('[data-sem]')
      if (row) {
        sem = row.dataset.sem ?? null
        col = colResolver ? colResolver(row, x) : null
      }
    }
  }
  return { sem, col, pool, slotKey }
}

const sameOver = (a: DragOver, b: DragOver) =>
  a.sem === b.sem && a.col === b.col && a.pool === b.pool && a.slotKey === b.slotKey

export function beginDrag(e: React.PointerEvent, payload: DragPayload) {
  if (e.button !== 0 || e.pointerType === 'touch') return
  const target = e.target as HTMLElement
  if (target.closest('button, input, select, textarea, a')) return
  const sx = e.clientX, sy = e.clientY
  let active = false
  let lastY = sy
  let raf = 0

  const scrollLoop = () => {
    const edge = 90
    const h = window.innerHeight
    let dy = 0
    if (lastY < edge) dy = -Math.ceil((edge - lastY) / 6)
    else if (lastY > h - edge) dy = Math.ceil((lastY - (h - edge)) / 6)
    if (dy) window.scrollBy(0, dy)
    raf = requestAnimationFrame(scrollLoop)
  }

  const move = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      active = true
      document.body.classList.add('is-dragging')
      setSnap({ payload, over: NO_OVER })
      raf = requestAnimationFrame(scrollLoop)
    }
    lastY = ev.clientY
    if (ghostEl) ghostEl.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`
    const over = resolveOver(ev.clientX, ev.clientY)
    if (!sameOver(over, snap.over)) setSnap({ payload, over })
  }

  const finish = (drop: boolean) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', key)
    cancelAnimationFrame(raf)
    document.body.classList.remove('is-dragging')
    if (active) {
      suppressClickUntil = Date.now() + 80
      const over = snap.over
      setSnap({ payload: null, over: NO_OVER })
      if (drop) dropHandler?.(payload, over)
    }
  }
  const up = () => finish(true)
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false) }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', key)
}
