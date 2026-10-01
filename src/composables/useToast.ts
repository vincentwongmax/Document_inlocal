import { ref } from 'vue'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastItem {
  id: number
  text: string
  kind: 'ok' | 'warn' | 'info'
  action?: ToastAction
}

const items = ref<ToastItem[]>([])
let seq = 0

export function useToast() {
  function push(text: string, kind: ToastItem['kind'] = 'ok', action?: ToastAction, ms = 3200) {
    const id = ++seq
    items.value.push({ id, text, kind, action })
    window.setTimeout(() => dismiss(id), ms)
    return id
  }
  function dismiss(id: number) {
    const i = items.value.findIndex((t) => t.id === id)
    if (i >= 0) items.value.splice(i, 1)
  }
  return { items, push, dismiss }
}
