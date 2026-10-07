<script setup lang="ts">
/**
 * 設定頁最上方的「錢包」區塊。
 *
 * 每個錢包有**自己的一整套記錄與設定**（分類、匯率、幣別、常用備註），
 * 切換錢包等於換一本帳。這裡負責：切換、新增、改名、換色換圖示、刪除、排序。
 *
 * ⚠ 「裡面還有記錄就不給刪」這條擋在這裡（不是擋在 store）：
 *   settings store 拿不到記錄筆數（records store 反過來 import settings，會循環），
 *   所以 store 只負責「至少保留一個錢包」，筆數由這裡查 records.countByWallet。
 */
import { computed, ref } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { confirmDialog, notify } from '@/lib/alerts'
import CategoryIcon from '@/components/CategoryIcon.vue'
import {
  WALLET_COLORS,
  WALLET_ICONS,
  WALLET_NAME_MAX,
  cleanWalletName,
  uniqueWalletName,
  walletNameOk,
} from '@/lib/wallets'
import type { Wallet } from '@/types'

const records = useRecordsStore()
const settings = useSettingsStore()

const countOf = (id: string) => records.countByWallet[id] ?? 0
const isOnly = computed(() => settings.wallets.length <= 1)

/* ── 編輯面板（新增與改名共用） ─────────────────────────── */
type Editor = {
  mode: 'new' | 'edit'
  id: string
  name: string
  color: string
  icon: string
}
const editor = ref<Editor | null>(null)

function startAdd() {
  editor.value = {
    mode: 'new',
    id: '',
    name: uniqueWalletName('新錢包', settings.wallets.map((w) => w.name)),
    // 顏色照順序輪，連續新增時才不會一直拿到同一個
    color: WALLET_COLORS[settings.wallets.length % WALLET_COLORS.length],
    icon: WALLET_ICONS[0],
  }
}

function startEdit(w: Wallet) {
  editor.value = { mode: 'edit', id: w.id, name: w.name, color: w.color, icon: w.icon }
}

function cancel() {
  editor.value = null
}

const nameError = computed(() => {
  const e = editor.value
  if (!e) return ''
  const n = cleanWalletName(e.name)
  if (!n) return '名稱不能空白'
  const others = settings.wallets.filter((w) => w.id !== e.id)
  if (e.mode === 'edit') {
    const self = settings.wallets.find((w) => w.id === e.id)
    if (self && n === self.name) return ''
  }
  return walletNameOk(n, others) ? '' : '已經有同名錢包了'
})

const canSave = computed(() => !!editor.value && !nameError.value)

function save() {
  const e = editor.value
  if (!e || !canSave.value) return
  if (e.mode === 'new') {
    const w = settings.addWallet(e.name, e.color, e.icon)
    if (!w) {
      notify('新增失敗，請檢查名稱', 'warn')
      return
    }
    settings.setActiveWallet(w.id)
    notify(`已新增錢包「${w.name}」，並切換過去`, 'ok')
  } else {
    settings.renameWallet(e.id, e.name)
    settings.updateWallet(e.id, { color: e.color, icon: e.icon })
    notify('已儲存', 'ok')
  }
  editor.value = null
}

/* ── 切換 ───────────────────────────────────────────────── */
function switchTo(w: Wallet) {
  if (w.id === settings.activeWalletId) return
  settings.setActiveWallet(w.id)
  notify(`已切換到「${w.name}」`, 'ok')
}

/* ── 刪除 ───────────────────────────────────────────────── */
async function askRemove(w: Wallet) {
  const n = countOf(w.id)
  if (n > 0) {
    notify(`「${w.name}」還有 ${n} 筆記錄，先刪除或匯出後才能刪除錢包`, 'warn')
    return
  }
  const answer = await confirmDialog({
    title: '刪除錢包',
    message: `確定要刪除「${w.name}」嗎？它的分類、匯率、幣別等設定會一起清除，無法復原。`,
    confirmText: '刪除',
    cancelText: '取消',
    danger: true,
  })
  if (answer !== 'confirm') return
  const res = settings.removeWallet(w.id)
  if (!res.ok) {
    notify(res.reason, 'warn')
    return
  }
  editor.value = null
  notify('已刪除錢包', 'info')
}

/** 刪除「編輯面板正在編輯的那個錢包」（模板裡直接讀 editor.id 會被 TS 判成可能為 null） */
function askRemoveEditing() {
  const e = editor.value
  if (!e) return
  const w = settings.wallets.find((x) => x.id === e.id)
  if (w) void askRemove(w)
}

/* ── 排序 ───────────────────────────────────────────────── */
/** 編輯面板裡的上移／下移：拖曳之外一定可用的第二條路 */
function move(id: string, delta: number) {
  const i = settings.wallets.findIndex((w) => w.id === id)
  if (i < 0) return
  settings.moveWallet(i, i + delta)
}

const listEl = ref<HTMLElement | null>(null)
const dragging = ref<string | null>(null)

function onGripDown(e: PointerEvent, id: string) {
  if (settings.wallets.length < 2) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  dragging.value = id
  el.addEventListener('pointermove', onDragMove)
  el.addEventListener('pointerup', onDragEnd)
  el.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e: PointerEvent) {
  const id = dragging.value
  if (!id || !listEl.value) return
  e.preventDefault()
  const items = Array.from(listEl.value.querySelectorAll('li.wcard')) as HTMLElement[]
  // 指標落在「第 insertAt 個之前」→ 換算成目標索引（扣掉自己那格）
  let insertAt = items.length
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect()
    if (e.clientY < r.top + r.height / 2) {
      insertAt = i
      break
    }
  }
  const cur = settings.wallets.findIndex((w) => w.id === id)
  if (cur < 0) return
  const target = Math.max(
    0,
    Math.min(settings.wallets.length - 1, insertAt > cur ? insertAt - 1 : insertAt),
  )
  if (target !== cur) settings.moveWallet(cur, target)
}

function onDragEnd(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.removeEventListener('pointermove', onDragMove)
  el.removeEventListener('pointerup', onDragEnd)
  el.removeEventListener('pointercancel', onDragEnd)
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  dragging.value = null
}

/** 卡片左邊的圓底：用很淡的同色底 + 同色字，跟分類圖示的調性一致 */
function avatarStyle(color: string) {
  return { background: `${color}1f`, color }
}
</script>

<template>
  <section class="card sec">
    <header class="sec__hd">
      <span class="sec__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
          <path d="M20 10.5h-3.2a1.8 1.8 0 0 0 0 3.6H20" />
        </svg>
      </span>
      <div class="sec__meta">
        <h2 class="sec__title">錢包</h2>
        <p class="sec__desc">
          每個錢包有自己的記錄與設定（分類、匯率、幣別、常用備註）。切換錢包就是換一本帳
        </p>
      </div>
    </header>

    <div class="panel">
      <ul ref="listEl" class="wlist">
        <li
          v-for="w in settings.wallets"
          :key="w.id"
          class="wcard"
          :class="{ 'is-on': w.id === settings.activeWalletId, 'is-drag': dragging === w.id }"
          :data-wallet="w.id"
        >
          <button
            class="wcard__main"
            type="button"
            :aria-pressed="w.id === settings.activeWalletId"
            @click="switchTo(w)"
          >
            <span class="wcard__av" :style="avatarStyle(w.color)">
              <CategoryIcon :name="w.icon" :size="18" />
            </span>
            <span class="wcard__meta">
              <span class="wcard__name">{{ w.name }}</span>
              <span class="wcard__sub">{{ countOf(w.id) }} 筆記錄</span>
            </span>
            <span v-if="w.id === settings.activeWalletId" class="wcard__on">使用中</span>
          </button>

          <button class="wcard__btn" type="button" aria-label="編輯錢包" @click="startEdit(w)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
            </svg>
          </button>

          <button
            class="wcard__btn wcard__grip"
            type="button"
            aria-label="拖曳調整順序"
            @pointerdown="onGripDown($event, w.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="7" r="1.4" />
              <circle cx="15" cy="7" r="1.4" />
              <circle cx="9" cy="12" r="1.4" />
              <circle cx="15" cy="12" r="1.4" />
              <circle cx="9" cy="17" r="1.4" />
              <circle cx="15" cy="17" r="1.4" />
            </svg>
          </button>
        </li>
      </ul>

      <button class="addbtn" type="button" @click="startAdd">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>新增錢包</span>
      </button>

      <!-- 編輯面板：新增與改名共用 -->
      <div v-if="editor" class="ed">
        <label class="ed__f">
          <span class="tiny muted">名稱</span>
          <input
            v-model="editor.name"
            class="field ed__in"
            type="text"
            :maxlength="WALLET_NAME_MAX"
            placeholder="例如：家用、出差"
            @keydown.enter.prevent="save"
          />
        </label>
        <p v-if="nameError" class="tiny warn">{{ nameError }}</p>

        <div class="ed__g">
          <span class="tiny muted">顏色</span>
          <div class="sws">
            <button
              v-for="c in WALLET_COLORS"
              :key="c"
              class="sw"
              type="button"
              :class="{ 'is-on': editor.color === c }"
              :style="{ background: c }"
              :aria-label="c"
              :aria-pressed="editor.color === c"
              @click="editor.color = c"
            />
          </div>
        </div>

        <div class="ed__g">
          <span class="tiny muted">圖示</span>
          <div class="ics">
            <button
              v-for="k in WALLET_ICONS"
              :key="k"
              class="ic"
              type="button"
              :class="{ 'is-on': editor.icon === k }"
              :aria-pressed="editor.icon === k"
              @click="editor.icon = k"
            >
              <CategoryIcon :name="k" :size="18" />
            </button>
          </div>
        </div>

        <!-- 排序的上移／下移：拖曳之外的第二條路（鍵盤與桌機也好用） -->
        <div v-if="editor.mode === 'edit' && settings.wallets.length > 1" class="ed__mv">
          <button
            class="btn btn--sm"
            type="button"
            :disabled="settings.wallets[0]?.id === editor.id"
            @click="move(editor.id, -1)"
          >
            ↑ 上移
          </button>
          <button
            class="btn btn--sm"
            type="button"
            :disabled="settings.wallets[settings.wallets.length - 1]?.id === editor.id"
            @click="move(editor.id, 1)"
          >
            ↓ 下移
          </button>
        </div>

        <div class="ed__acts">
          <button
            v-if="editor.mode === 'edit'"
            class="btn btn--danger"
            type="button"
            :disabled="isOnly"
            @click="askRemoveEditing()"
          >
            刪除
          </button>
          <span class="ed__spacer" />
          <button class="btn" type="button" @click="cancel">取消</button>
          <button class="btn btn--primary" type="button" :disabled="!canSave" @click="save">
            {{ editor.mode === 'new' ? '新增' : '儲存' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sec__hd {
  display: flex;
  gap: 11px;
  align-items: flex-start;
}
.sec__icon {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid;
  place-items: center;
}
.sec__icon svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sec__meta {
  min-width: 0;
}
.sec__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.sec__desc {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
}

/* ── 錢包卡片 ───────────────────────────────────────────── */
.wlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.wcard {
  display: flex;
  align-items: stretch;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.wcard.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.wcard.is-drag {
  box-shadow: var(--shadow-2);
  opacity: 0.9;
}

.wcard__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px 9px 10px;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}
.wcard__av {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
}
.wcard__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.wcard__name {
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wcard__sub {
  font-size: 11.5px;
  color: var(--text-3);
  font-family: var(--font-num);
}
.wcard__on {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: #fff;
  border: 1px solid var(--accent-light);
  border-radius: 999px;
  padding: 1px 8px;
}

.wcard__btn {
  flex: none;
  width: 32px;
  border: 0;
  background: none;
  color: var(--text-3);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.wcard__btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.wcard__btn:hover {
  color: var(--text-2);
}
.wcard__grip svg {
  fill: currentColor;
  stroke: none;
}
/* ⚠ 拖曳把手要關掉瀏覽器的平移手勢，不然 iOS 會先捲頁面 */
.wcard__grip {
  touch-action: none;
  cursor: grab;
}
.wcard.is-drag .wcard__grip {
  cursor: grabbing;
}

/* ── 新增 ───────────────────────────────────────────────── */
.addbtn {
  margin-top: 9px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: none;
  color: var(--accent);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.addbtn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.addbtn:hover {
  background: var(--accent-soft);
}

/* ── 編輯面板 ───────────────────────────────────────────── */
.ed {
  margin-top: 11px;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ed__f {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ed__in {
  width: 100%;
}
.ed__g {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sws {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sw {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  padding: 0;
}
.sw.is-on {
  border-color: var(--text);
}
.ics {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ic {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}
.ic.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.ed__mv {
  display: flex;
  gap: 6px;
}
.ed__acts {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ed__spacer {
  flex: 1;
}
.warn {
  color: var(--warn);
  margin: 0;
}
</style>
