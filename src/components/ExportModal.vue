<script setup lang="ts">
/**
 * 匯出彈窗：先選「格式」（JSON／Excel），再選「錢包」（本錢包／全部錢包），
 * 最後是「範圍」（全部／日期區間），按下匯出。
 *
 * 格式與錢包的組合（0.1.24 起兩者都可以選）：
 *   JSON × 本錢包     —— 一個 .json，只有這本帳（含它的設定）＋圖片，可匯入還原
 *   JSON × 全部錢包   —— 一個 .json，全部錢包＋各自設定＋圖片，完整備份
 *   Excel × 本錢包    —— 一個 .zip，內含一份 .xlsx 與 images/
 *   Excel × 全部錢包  —— 同一個 .zip，內含**每個錢包各一份 .xlsx** 與共用的 images/
 *
 * ⚠ Excel 一律不含任何設定（分類樹、匯率、常用備註…），只能看／拿去算，不能匯回 App。
 *   要備份還原請用 JSON。
 */
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { useScrollLock } from '@/composables/useScrollLock'
import DateField from '@/components/DateField.vue'
import { notify } from '@/lib/alerts'
import { buildExport, downloadJson } from '@/lib/exportImport'
import {
  buildExcelExport,
  downloadBlob,
  type ExcelWalletGroup,
  type ExportProgress,
} from '@/lib/exportExcel'
import { dayKey, monthRange, todayKey } from '@/lib/date'
import { formatBytes } from '@/lib/imaging'
import type { Category } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const records = useRecordsStore()
const settings = useSettingsStore()

/**
 * 內容可能會超高（窄機身 + 展開「自訂區間」）→ 要列進可捲清單，
 * 否則 useScrollLock 的 document touchmove preventDefault 會讓 iOS 上根本滑不動。
 */
const boxEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => boxEl.value })

type Fmt = 'json' | 'excel'
/** 匯出範圍的**錢包**維度：只有這本帳，或全部錢包 */
type Scope = 'wallet' | 'all'
type RangeMode = 'all' | 'custom'

const format = ref<Fmt>('json')
const scope = ref<Scope>('all')
const rangeMode = ref<RangeMode>('all')
const from = ref('')
const to = ref('')
const busy = ref(false)
const progress = ref<ExportProgress | null>(null)

/** 預設的「自訂區間」＝本月，省得每次都要從空白開始挑 */
function resetCustomRange() {
  const { start, end } = monthRange(todayKey().slice(0, 7))
  from.value = start
  to.value = end
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    format.value = 'json'
    scope.value = 'all'
    rangeMode.value = 'all'
    busy.value = false
    progress.value = null
    resetCustomRange()
  },
  { immediate: true },
)

/* ── 範圍 ───────────────────────────────────────────────── */
const presets: { label: string; run: () => void }[] = [
  {
    label: '本月',
    run: () => {
      const { start, end } = monthRange(todayKey().slice(0, 7))
      from.value = start
      to.value = end
    },
  },
  {
    label: '上月',
    run: () => {
      const [y, m] = todayKey().split('-').map(Number)
      const d = new Date(y, m - 2, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const { start, end } = monthRange(key)
      from.value = start
      to.value = end
    },
  },
  {
    label: '今年',
    run: () => {
      const y = todayKey().slice(0, 4)
      from.value = `${y}-01-01`
      to.value = `${y}-12-31`
    },
  },
]

const rangeInvalid = computed(
  () =>
    rangeMode.value === 'custom' &&
    (!from.value || !to.value || (!!from.value && !!to.value && from.value > to.value)),
)

/** 這次要考慮的記錄來源：本錢包 → 只有當前錢包；全部錢包 → 全部 */
const pool = computed(() => (scope.value === 'all' ? records.all : records.records))

/** 這次要匯出的記錄：全部，或落在 [from, to] 內（含首尾，用本地日曆日判斷） */
const selected = computed(() => {
  if (rangeMode.value === 'all') return pool.value
  if (rangeInvalid.value) return []
  return pool.value.filter((r) => {
    const k = dayKey(r.occurredAt)
    return !!k && k >= from.value && k <= to.value
  })
})

/** 選到的記錄裡一共有幾張「不重複」的圖片 */
const imageCount = computed(() => {
  const s = new Set<string>()
  for (const r of selected.value) for (const im of r.images ?? []) s.add(im.id)
  return s.size
})

/** 選到的記錄橫跨幾個錢包 */
const walletCount = computed(() => {
  const s = new Set<string>()
  for (const r of selected.value) s.add(r.walletId)
  return s.size
})

const canExport = computed(() => !busy.value && !rangeInvalid.value && selected.value.length > 0)

/** 「全部錢包」時，範圍裡實際有記錄的錢包（依錢包順序） */
const groups = computed<ExcelWalletGroup[]>(() => {
  const wallets = scope.value === 'all' ? settings.wallets : [settings.activeWallet]
  const out: ExcelWalletGroup[] = []
  for (const w of wallets) {
    const mine = selected.value.filter((r) => r.walletId === w.id)
    if (!mine.length) continue
    // 每個錢包用自己的分類樹取名（各錢包的分類是分開的）
    const s = settings.settingsOf(w.id)
    out.push({
      walletId: w.id,
      name: w.name,
      records: mine,
      pathNamesOf: (id) => pathNamesOfIn(s.categories, id),
      baseCurrency: s.baseCurrency,
    })
  }
  return out
})

/** 依分類樹取「根 → 葉」的名稱（找不到就回空陣列） */
function pathNamesOfIn(cats: Category[], id: string): string[] {
  const byId = new Map(cats.map((c) => [c.id, c]))
  const out: string[] = []
  const seen = new Set<string>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

/* ── 匯出 ───────────────────────────────────────────────── */
const barPct = computed(() => {
  const p = progress.value
  if (!p || !p.total) return 0
  return Math.min(100, Math.round((p.done / p.total) * 100))
})
const progressLabel = computed(() => {
  const p = progress.value
  if (!p) return '準備中…'
  if (p.phase === 'read') return `讀取圖片 ${p.done} / ${p.total}`
  return `打包中 ${p.done} / ${p.total}`
})

async function run() {
  if (!canExport.value) return
  const list = selected.value
  busy.value = true
  progress.value = { phase: 'read', done: 0, total: 0 }
  try {
    if (format.value === 'json') {
      // 本錢包 → 只帶這本帳的記錄與設定；全部錢包 → 整份備份
      const onlyWallet = scope.value === 'wallet'
      const walletId = settings.activeWalletId
      const payload = await buildExport({
        wallets: onlyWallet ? [settings.activeWallet] : settings.wallets,
        activeWalletId: walletId,
        settingsByWallet: onlyWallet
          ? { [walletId]: settings.state }
          : settings.allWalletSettings(),
        records: list,
        onProgress: (p) => (progress.value = p),
      })
      const name = downloadJson(payload)
      const scopeWord = onlyWallet ? `本錢包「${settings.activeWallet.name}」` : '全部錢包'
      notify(`已匯出 ${list.length} 筆（${scopeWord}）→ ${name}`, 'ok')
    } else {
      const res = await buildExcelExport({
        groups: groups.value,
        // 全部錢包時 ZIP 檔名用 ledger；單一錢包時帶上錢包名，一眼看得出是哪本帳
        zipName: scope.value === 'wallet' ? settings.activeWallet.name : 'ledger',
        onProgress: (p) => (progress.value = p),
      })
      downloadBlob(res.blob, res.fileName)
      const extra = res.missingImages ? `，另有 ${res.missingImages} 張圖片已不存在` : ''
      const files = res.fileCount > 1 ? `（${res.fileCount} 份 Excel）` : ''
      notify(
        `已匯出 ${res.recordCount} 筆、${res.imageCount} 張圖片${files}（${formatBytes(res.blob.size)}）${extra} → ${res.fileName}`,
        res.missingImages ? 'warn' : 'ok',
      )
    }
    emit('close')
  } catch (e) {
    notify(e instanceof Error ? e.message : '匯出失敗', 'warn')
  } finally {
    busy.value = false
    progress.value = null
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !busy.value) emit('close')
}

// Escape 關閉。掛在 document 上（彈窗本身不一定有焦點），開著的時候才聽
watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="open" class="mask" @click.self="!busy && emit('close')">
    <div ref="boxEl" class="card box" role="dialog" aria-modal="true" aria-label="匯出資料">
      <h3>匯出資料</h3>

      <!-- 格式 -->
      <div class="lb">
        <span class="lb__t">格式</span>
        <div class="picks">
          <button
            class="pick"
            type="button"
            :class="{ 'is-on': format === 'json' }"
            :aria-pressed="format === 'json'"
            @click="format = 'json'"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 3v5h5" />
              <path d="M6.5 3H14l5 5v11a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              <path d="M9.4 12.5c-.9 0-1.4.5-1.4 1.3v.5c0 .6-.2.9-.9 1 .7.1.9.4.9 1v.5c0 .8.5 1.3 1.4 1.3" />
              <path d="M14.6 12.5c.9 0 1.4.5 1.4 1.3v.5c0 .6.2.9.9 1-.7.1-.9.4-.9 1v.5c0 .8-.5 1.3-1.4 1.3" />
            </svg>
            <span class="pick__t">JSON</span>
            <span class="pick__d tiny">
              單一 .json 檔，含記錄、設定與圖片。可以再匯入還原（完整備份）
            </span>
          </button>

          <button
            class="pick"
            type="button"
            :class="{ 'is-on': format === 'excel' }"
            :aria-pressed="format === 'excel'"
            @click="format = 'excel'"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16v14H4z" />
              <path d="M4 10h16M10 5v14" />
              <path d="M14.5 12.5l4 5M18.5 12.5l-4 5" />
            </svg>
            <span class="pick__t">Excel</span>
            <span class="pick__d tiny">
              一個 .zip，內含 .xlsx 與 images/ 圖檔。只含記錄、不含設定，不能匯回 App
            </span>
          </button>
        </div>
      </div>

      <!-- 錢包 -->
      <div class="lb">
        <span class="lb__t">錢包</span>
        <div class="seg">
          <button
            class="seg__btn"
            :class="{ 'is-on': scope === 'wallet' }"
            @click="scope = 'wallet'"
          >
            本錢包
          </button>
          <button class="seg__btn" :class="{ 'is-on': scope === 'all' }" @click="scope = 'all'">
            全部錢包
          </button>
        </div>
        <p class="lb__d tiny muted">
          <template v-if="scope === 'all' && format === 'excel'">
            每個錢包會各自產生一份 .xlsx，圖片共用同一個 images/ 資料夾，全部打包在同一個 ZIP
          </template>
          <template v-else-if="scope === 'all'">
            所有錢包與設定都會完整備份
          </template>
          <template v-else>
            只匯出「{{ settings.activeWallet.name }}」這本帳（含它的設定）
          </template>
        </p>
      </div>

      <!-- 範圍 -->
      <div class="lb">
        <span class="lb__t">範圍</span>
        <div class="seg">
          <button class="seg__btn" :class="{ 'is-on': rangeMode === 'all' }" @click="rangeMode = 'all'">
            全部記錄
          </button>
          <button class="seg__btn" :class="{ 'is-on': rangeMode === 'custom' }" @click="rangeMode = 'custom'">
            自訂區間
          </button>
        </div>

        <div v-if="rangeMode === 'custom'" class="range">
          <div class="range__dates">
            <label class="range__f">
              <span class="tiny muted">從</span>
              <DateField v-model="from" />
            </label>
            <label class="range__f">
              <span class="tiny muted">到</span>
              <DateField v-model="to" />
            </label>
          </div>
          <div class="range__chips">
            <button v-for="p in presets" :key="p.label" class="chip" type="button" @click="p.run()">
              {{ p.label }}
            </button>
          </div>
          <p v-if="rangeInvalid" class="tiny warn">請確認「從」不晚於「到」，而且兩個日期都填了</p>
        </div>
      </div>

      <!-- 摘要 -->
      <div class="sum">
        <div class="sum__line">
          <span class="tiny muted">將匯出</span>
          <strong class="num">{{ selected.length }}</strong>
          <span class="tiny muted">筆記錄</span>
          <template v-if="imageCount">
            <span class="sum__dot">·</span>
            <strong class="num">{{ imageCount }}</strong>
            <span class="tiny muted">張圖片</span>
          </template>
          <template v-if="scope === 'all'">
            <span class="sum__dot">·</span>
            <strong class="num">{{ walletCount }}</strong>
            <span class="tiny muted">個錢包</span>
          </template>
          <template v-if="format === 'excel' && groups.length > 1">
            <span class="sum__dot">·</span>
            <strong class="num">{{ groups.length }}</strong>
            <span class="tiny muted">份 Excel</span>
          </template>
        </div>
        <p v-if="!selected.length && !rangeInvalid" class="tiny muted sum__hint">
          這個範圍裡沒有記錄，換個區間或選「全部記錄」
        </p>
        <p v-else-if="format === 'excel'" class="tiny muted sum__hint">
          只含記錄，不含分類樹、匯率、常用備註等設定
        </p>
        <p v-else class="tiny muted sum__hint">
          設定會跟著記錄一起帶走，之後可以匯入還原
        </p>
      </div>

      <!-- 進度 -->
      <div v-if="busy" class="prog" role="status" aria-live="polite">
        <div class="prog__track"><i class="prog__bar" :style="{ width: barPct + '%' }"></i></div>
        <span class="tiny muted">{{ progressLabel }}</span>
      </div>

      <div class="foot">
        <button class="btn" :disabled="busy" @click="emit('close')">取消</button>
        <button class="btn btn--primary" :disabled="!canExport" @click="run">匯出</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(27, 26, 24, 0.34);
  display: grid;
  place-items: center;
  padding: 20px;
}
.box {
  width: 100%;
  max-width: 380px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.box h3 {
  font-size: 16px;
}
.lb {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.lb__t {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}
/* 分段選項下方那一行說明 */
.lb__d {
  margin: 0;
  line-height: 1.45;
}

/* ── 格式卡 ─────────────────────────────────────────────── */
.picks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pick {
  display: grid;
  grid-template-columns: 22px 1fr;
  grid-template-rows: auto auto;
  column-gap: 9px;
  row-gap: 2px;
  align-items: center;
  padding: 10px 12px;
  text-align: left;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  transition:
    border-color 0.15s,
    background 0.15s;
}
.pick svg {
  grid-row: 1 / 3;
  width: 21px;
  height: 21px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.pick__t {
  font-size: 14px;
  font-weight: 650;
}
.pick__d {
  grid-column: 2;
  line-height: 1.45;
  color: var(--text-3);
}
.pick:hover {
  border-color: var(--accent);
}
.pick.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.pick.is-on svg {
  stroke: var(--accent);
}
.pick.is-on .pick__t {
  color: var(--accent);
}

/* ── 範圍 ───────────────────────────────────────────────── */
.seg {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 12px;
}
.seg__btn {
  flex: 1;
  height: 32px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-2);
}
.seg__btn.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.range {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* ⚠ 用 grid 1fr 1fr，不要用 max-content：原生日期框的內建寬度是瀏覽器相依的
   （Chrome 10/07/2026、iOS 2026/10/07），那會讓兩欄寬度在 iPhone 上跑掉。
   詳見 CONVENTIONS.md「統計頁／設定頁」那節。 */
.range__dates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.range__f {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
/* ⚠ 用 :deep()：DateField 是子元件，裡面的 input 不會帶到這個元件的 scope id */
.range__f :deep(.df) {
  width: 100%;
  min-width: 0;
}
.range__f :deep(.field) {
  width: 100%;
  min-width: 0;
}
.range__chips {
  display: flex;
  gap: 6px;
}
.chip {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 12.5px;
  font-weight: 550;
  color: var(--text-2);
}
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.warn {
  margin: 0;
  color: var(--expense);
}

/* ── 摘要 ───────────────────────────────────────────────── */
.sum {
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sum__line {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex-wrap: wrap;
}
.sum__line strong {
  font-size: 16px;
  color: var(--text);
}
.sum__dot {
  color: var(--text-3);
}
.sum__hint {
  margin: 0;
  line-height: 1.45;
}

/* ── 進度 ───────────────────────────────────────────────── */
.prog {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prog__track {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
.prog__bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.15s ease;
}

.foot {
  display: flex;
  gap: 8px;
}
.foot .btn {
  flex: 1;
}
</style>
