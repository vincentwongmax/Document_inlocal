<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { QUICK_NOTE_MAX, useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { notify, confirmDialog } from '@/lib/alerts'
import CategoryManageModal from '@/components/CategoryManageModal.vue'
import CategoryIcon from '@/components/CategoryIcon.vue'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { parseImport, restoreImages } from '@/lib/exportImport'
import ExportModal from '@/components/ExportModal.vue'
import { usageBytes } from '@/lib/storage'
import { clearImages, listImageIds } from '@/lib/imageDb'
import { offlineReady, updateSW } from '@/lib/pwa'
import { APP_VERSION } from '@/lib/version'
import type { Category, TxType } from '@/types'

const settings = useSettingsStore()
const records = useRecordsStore()
const route = useRoute()

/* ── 快速備註 ───────────────────────────────────────────── */
const newQuick = ref('')

function addQuick() {
  const t = newQuick.value.trim()
  if (!t) return
  if (!settings.addQuickNote(t)) {
    notify('已經有同樣的快速備註', 'info')
    return
  }
  newQuick.value = ''
}

/** 改完（失焦或按 Enter）才寫回去；被拒（空白／重複）就把輸入框還原成原值 */
function renameQuick(i: number, e: Event) {
  const el = e.target as HTMLInputElement
  const before = settings.quickNotes[i] ?? ''
  if (!el.value.trim()) {
    el.value = before // 不給改成空白，要刪請按旁邊的 ✕
    return
  }
  if (!settings.updateQuickNote(i, el.value)) {
    notify('已經有同樣的快速備註', 'info')
    el.value = before
  }
}

/**
 * 從備註欄的「管理快速備註」跳過來時（?sec=quicknotes）直接捲到那一段。
 * ⚠ 要延後一點再捲：refreshUsage() 是非同步的，資料區的數字補上之前高度還會變。
 */
onMounted(() => {
  if (route.query.sec !== 'quicknotes') return
  void nextTick(() => {
    window.setTimeout(() => {
      document.getElementById('sec-quicknotes')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 140)
  })
})

/* ── 幣別與匯率 ─────────────────────────────────────────── */
const refreshing = ref(false)
const rateDraft = ref<Record<string, string>>({})

const rateRows = computed(() => {
  const list = settings.state.rateCurrencies.length
    ? CURRENCIES.filter(
        (c) => settings.state.rateCurrencies.includes(c.code) && c.code !== settings.baseCurrency,
      )
    : CURRENCIES.filter((c) => c.code !== settings.baseCurrency)
  return list.map((c) => ({
    code: c.code,
    name: c.name,
    value: settings.state.rates[c.code] ?? 1,
  }))
})

/** 匯率表還能新增的幣別 */
const addableRates = computed(() =>
  CURRENCIES.filter(
    (c) => c.code !== settings.baseCurrency && !settings.state.rateCurrencies.includes(c.code),
  ),
)

function commitRate(code: string) {
  const raw = rateDraft.value[code]
  if (raw === undefined) return
  const n = Number(raw)
  if (isFinite(n) && n > 0) settings.setRate(code, n)
  delete rateDraft.value[code]
}

function addRate(e: Event) {
  const code = (e.target as HTMLSelectElement).value
  if (code) settings.toggleRateCurrency(code)
  ;(e.target as HTMLSelectElement).value = ''
}

/** 主頁幣別選單：已勾選的幣別（依總表順序） */
const visibleCurs = computed(() =>
  CURRENCIES.filter((c) => settings.state.visibleCurrencies.includes(c.code)),
)

/** 主頁幣別選單：還能加入下拉的幣別 */
const addableVisible = computed(() =>
  CURRENCIES.filter((c) => !settings.state.visibleCurrencies.includes(c.code)),
)

function addVisible(e: Event) {
  const el = e.target as HTMLSelectElement
  if (el.value) settings.toggleVisibleCurrency(el.value)
  el.value = ''
}

async function refresh() {
  refreshing.value = true
  const ok = await settings.refreshRates()
  refreshing.value = false
  notify(ok ? '匯率已更新' : '無法連上匯率服務，沿用既有匯率', ok ? 'ok' : 'warn')
}

async function changeBase(code: string) {
  await settings.setBaseCurrency(code)
  notify(`主幣別已改為 ${code}`, 'ok')
}

/* ── 分類管理 ───────────────────────────────────────────── */
// 只列出未封存的：刪除後的分類不該還留在清單上
// 子分類展開成同一層、用 depth 做縮排，才能整棵樹一起勾常用
function flatTree(type: TxType) {
  const out: { cat: Category; depth: number }[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const c of settings.childrenOf(parentId)) {
      if (c.type !== type) continue
      out.push({ cat: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
const grouped = computed(() => [
  { type: 'expense' as TxType, label: '支出分類', list: flatTree('expense') },
  { type: 'income' as TxType, label: '收入分類', list: flatTree('income') },
])

/** 管理分類彈窗的下拉清單：支出＋收入全部列出 */
const manageCats = computed(() => [
  ...settings.categories.filter((c) => c.type === 'expense'),
  ...settings.categories.filter((c) => c.type === 'income'),
])

/** 每個分類被幾筆記錄使用（刪除前提醒用） */
const catUsage = computed(() => {
  const m: Record<string, number> = {}
  for (const r of records.records) m[r.categoryId] = (m[r.categoryId] ?? 0) + 1
  return m
})

/** 主頁常用分類：右側「管理分類」可新增、修改、刪除分類 */
const showCatMgr = ref(false)
type CatForm = {
  name: string
  color: string
  type: TxType
  icon: string
  parentId: string | null
}
function onCreateCat(p: CatForm) {
  const c = settings.addCategory(p.name, p.type, p.color, p.icon, p.parentId)
  showCatMgr.value = false
  const under = p.parentId ? settings.category(p.parentId)?.name : ''
  notify(under ? `已在「${under}」底下新增子分類` : '已新增分類', 'ok')
  return c
}
function onSaveCat(p: CatForm & { id: string }) {
  settings.updateCategory(p.id, {
    name: p.name,
    color: p.color,
    type: p.type,
    icon: p.icon,
    parentId: p.parentId,
  })
  showCatMgr.value = false
  notify('已儲存分類', 'ok')
}
function onRemoveCat(id: string) {
  const check = settings.canRemove(id)
  if (!check.ok) {
    notify(check.reason, 'warn')
    return
  }
  const ok = settings.removeCategory(id)
  notify(ok ? '已刪除分類' : '刪除失敗', ok ? 'ok' : 'warn')
}

/* ── 資料管理 ───────────────────────────────────────────── */
const imageCount = ref(0)
const usage = ref(0)
async function refreshUsage() {
  imageCount.value = (await listImageIds()).length
  usage.value = usageBytes()
}
onMounted(refreshUsage)

const exportOpen = ref(false)

const importInput = ref<HTMLInputElement | null>(null)
type ParsedImport = ReturnType<typeof parseImport>

function pickImport() {
  importInput.value?.click()
}

async function onImportFile(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file) return

  let parsed: ParsedImport
  try {
    parsed = parseImport(await file.text())
  } catch (err) {
    notify(err instanceof Error ? err.message : '匯入失敗', 'warn')
    return
  }

  // 「連設定一起還原」＝confirm、「只匯入記錄」＝deny
  const answer = await confirmDialog({
    title: '匯入資料',
    message: `檔案含 ${parsed.records.length} 筆記錄。是否同時還原匯出時的設定（分類、匯率、幣別）？`,
    confirmText: '連設定一起還原',
    denyText: '只匯入記錄',
    cancelText: '取消',
  })
  if (answer === 'cancel') return
  await runImport(parsed, answer === 'confirm')
}

async function runImport(p: ParsedImport, withSettings: boolean) {
  if (withSettings && p.settings) {
    settings.state.categories = p.settings.categories
    settings.state.preferredCurrency = p.settings.preferredCurrency
    settings.state.ocrLangs = p.settings.ocrLangs
    settings.state.baseCurrency = p.settings.baseCurrency
    settings.state.inputCurrency = p.settings.inputCurrency
    settings.state.rates = { ...settings.state.rates, ...p.settings.rates }
    settings.state.ratesUpdatedAt = p.settings.ratesUpdatedAt
  }
  await restoreImages(p.records, p.images)
  const { added, skipped } = records.mergeImport(p.records)
  await refreshUsage()
  notify(`匯入完成：新增 ${added} 筆${skipped ? `、略過 ${skipped} 筆重複` : ''}`, 'ok')
}

/* ── 重置 ───────────────────────────────────────────────── */
async function doReset() {
  const answer = await confirmDialog({
    title: '確定要重置嗎？',
    message: '所有記錄與圖片都會被清除，且無法復原（幣別、匯率、分類等設定會保留）。',
    confirmText: '重置',
    danger: true,
  })
  if (answer !== 'confirm') return
  await records.reset()
  await clearImages()
  localStorage.removeItem('mop-ledger.draft.v1')
  await refreshUsage()
  notify('已重置，所有記錄與圖片都已清除', 'info')
}

const ocrLangOptions = [
  { code: 'eng', label: '英文／數字' },
  { code: 'chi_sim', label: '簡體中文' },
  { code: 'chi_tra', label: '繁體中文' },
]

function toggleLang(code: string) {
  const cur = new Set(settings.state.ocrLangs)
  if (cur.has(code)) {
    if (cur.size === 1) return
    cur.delete(code)
  } else cur.add(code)
  settings.state.ocrLangs = [...cur]
}

const usedBytes = computed(() => `${(usage.value / 1024).toFixed(0)} KB`)
</script>

<template>
  <div class="page settings">
    <div class="page-head">
      <div>
        <h1 class="page-title">設定</h1>
        <p class="page-sub">幣別、分類、收據辨識與資料管理</p>
      </div>
    </div>

    <!-- 幣別與匯率 -->
    <section class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">幣別與匯率</h2>
          <p class="sec__desc">每筆記錄會把「當下的匯率」快照下來，之後改匯率不會影響既有記錄</p>
        </div>
      </header>

      <div class="panel">
        <div class="rows">
          <label class="row">
            <span>主幣別<small class="tiny muted">統計與圖表的換算基準</small></span>
            <select
              class="field row__ctl"
              :value="settings.baseCurrency"
              @change="changeBase(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
          </label>

          <label class="row">
            <span>目前記帳幣別<small class="tiny muted">出國時改成當地幣別</small></span>
            <select
              class="field row__ctl"
              :value="settings.inputCurrency"
              @change="settings.setInputCurrency(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <div class="panel">
        <div class="panel__hd panel__hd--rate">
          <span class="panel__label">匯率</span>
          <select
            v-if="addableRates.length"
            class="field rates__addsel"
            :value="''"
            @change="addRate($event)"
          >
            <option value="" disabled>新增</option>
            <option v-for="c in addableRates" :key="c.code" :value="c.code">
              {{ c.code }} · {{ c.name }}
            </option>
          </select>
          <button class="btn btn--sm" :disabled="refreshing" @click="refresh">
            {{ refreshing ? '更新中…' : '更新匯率' }}
          </button>
        </div>
        <div class="rates__grid">
          <div v-for="r in rateRows" :key="r.code" class="rate">
            <div class="rate__top">
              <span class="rate__code">{{ r.code }}</span>
              <button
                class="rate__x"
                title="從匯率表移除"
                @click="settings.toggleRateCurrency(r.code)"
              >
                ✕
              </button>
            </div>
            <input
              class="field rate__input num"
              :value="rateDraft[r.code] ?? r.value"
              inputmode="decimal"
              @input="rateDraft[r.code] = ($event.target as HTMLInputElement).value"
              @blur="commitRate(r.code)"
              @keyup.enter="commitRate(r.code)"
            />
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">記帳幣別選單</span>
          <span class="tiny muted panel__meta">主頁切換幣別時顯示哪幾個；沒選 = 全部</span>
        </div>
        <div class="currow">
          <div class="chips" v-if="visibleCurs.length">
            <span v-for="c in visibleCurs" :key="c.code" class="chip chip--sel">
              {{ c.code }}
              <button
                class="chip__x"
                title="從主頁幣別選單移除"
                @click="settings.toggleVisibleCurrency(c.code)"
              >
                ✕
              </button>
            </span>
          </div>
          <p v-else class="tiny muted">尚未選擇——主頁目前顯示全部幣別</p>
          <select
            v-if="addableVisible.length"
            class="field currow__add"
            :value="''"
            @change="addVisible($event)"
          >
            <option value="" disabled>新增</option>
            <option v-for="c in addableVisible" :key="c.code" :value="c.code">
              {{ c.code }} · {{ c.name }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <!-- 收據辨識 -->
    <section class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21V3Z" />
            <path d="M9.5 8h5M9.5 12h5" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">收據辨識</h2>
          <p class="sec__desc">全部在瀏覽器離線執行，圖片不會上傳</p>
        </div>
      </header>

      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">辨識語言</span>
          <span class="tiny muted panel__meta">語言包越多，離線安裝檔越大</span>
        </div>
        <div class="chips">
          <button
            v-for="o in ocrLangOptions"
            :key="o.code"
            class="chip"
            :class="{ 'is-on': settings.state.ocrLangs.includes(o.code) }"
            @click="toggleLang(o.code)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <div class="panel">
        <div class="rows">
          <label class="row">
            <span>多幣別時預設採用<small class="tiny muted">同一張收據出現多種幣別時的預設值</small></span>
            <select
              class="field row__ctl"
              :value="settings.preferredCurrency"
              @change="settings.setPreferredCurrency(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </section>

    <!-- 分類 -->
    <section class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 4h6l10 10-6 6L4 10V4Z" />
            <circle cx="8" cy="8" r="1.2" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">分類</h2>
          <p class="sec__desc">勾選要固定在主頁記帳區的分類；沒勾選任何一個時，主頁顯示全部分類</p>
        </div>
      </header>

      <!-- 主頁常用分類 -->
      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">主頁常用分類</span>
          <span class="tiny muted panel__meta">已選 {{ settings.favoriteCategories.length }} 個</span>
          <button class="btn btn--sm" type="button" @click="showCatMgr = true">管理分類</button>
        </div>
        <p class="tiny muted favs__hint">
          勾選幾個，主頁就只顯示那幾個，其餘收進「更多」；沒有勾選任何一個時，主頁顯示全部分類。
        </p>
        <div v-for="g in grouped" :key="'fav-' + g.type" class="catgroup">
          <span class="tiny muted catgroup__label">{{ g.label }}</span>
          <div class="chips">
            <button
              v-for="row in g.list"
              :key="row.cat.id"
              class="catchip catchip--pick"
              :class="{ 'is-on': settings.isFavorite(row.cat.id), 'is-sub': row.depth > 0 }"
              @click="settings.toggleFavorite(row.cat.id)"
            >
              <span v-if="row.depth > 0" class="catchip__branch" aria-hidden="true">└</span>
              <span
                class="catchip__ic"
                :style="{ '--c': row.cat.color, '--bg': withAlpha(row.cat.color, 0.14) }"
              >
                <CategoryIcon :name="iconForCategory(row.cat)" :size="15" :stroke="1.9" />
              </span>
              <span class="catchip__name">{{ row.cat.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 快速備註 -->
    <section id="sec-quicknotes" class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M13 2.8 5.6 12.4h5.2l-.6 8.8 8.2-9.6h-5.2z" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">快速備註</h2>
          <p class="sec__desc">記帳頁與記錄明細的備註欄右邊有一顆閃電鈕，點一下就填入這裡的文字</p>
        </div>
      </header>

      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">常用文字</span>
          <span class="tiny muted panel__meta">已設定 {{ settings.quickNotes.length }} 個</span>
        </div>
        <p class="tiny muted favs__hint">
          點備註欄右邊的閃電鈕就會列出下面這些字，點一下就填進去（會蓋掉原本打的字）。
          每則最多 {{ QUICK_NOTE_MAX }} 個字。
        </p>

        <p v-if="!settings.quickNotes.length" class="tiny muted qn__none">
          還沒有任何快速備註，用下面那一行新增第一則。
        </p>
        <div v-else class="qn__list">
          <div v-for="(t, i) in settings.quickNotes" :key="i" class="qn__row">
            <input
              class="field qn__in"
              type="text"
              :value="t"
              :maxlength="QUICK_NOTE_MAX"
              :aria-label="`快速備註 ${i + 1}`"
              @change="renameQuick(i, $event)"
            />
            <button
              class="qn__del"
              type="button"
              title="刪除"
              :aria-label="`刪除快速備註 ${t}`"
              @click="settings.removeQuickNote(i)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.8 7.8 16.2 16.2M16.2 7.8 7.8 16.2" />
              </svg>
            </button>
          </div>
        </div>

        <div class="qn__add">
          <input
            v-model="newQuick"
            class="field qn__addin"
            type="text"
            :maxlength="QUICK_NOTE_MAX"
            placeholder="新增一則（例如：M記）"
            aria-label="新增快速備註"
            @keydown.enter.prevent="addQuick"
          />
          <button class="btn btn--primary btn--sm" type="button" :disabled="!newQuick.trim()" @click="addQuick">
            新增
          </button>
        </div>
      </div>
    </section>

    <!-- 資料 -->
    <section class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
            <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
            <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">資料</h2>
          <p class="sec__desc">備份與還原；資料只存在這台裝置</p>
        </div>
      </header>

      <div class="usage">
        <div class="usage__stat">
          <strong class="num">{{ records.records.length }}</strong>
          <span class="tiny muted">筆記錄</span>
        </div>
        <div class="usage__stat">
          <strong class="num">{{ imageCount }}</strong>
          <span class="tiny muted">張圖片</span>
        </div>
        <div class="usage__stat">
          <strong class="num">{{ usedBytes }}</strong>
          <span class="tiny muted">localStorage</span>
        </div>
      </div>

      <div class="acts">
        <button class="act" :disabled="!records.records.length" @click="exportOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span class="act__t">匯出</span>
          <span class="act__d tiny muted">JSON（含設定）或 Excel（ZIP）</span>
        </button>
        <button class="act" @click="pickImport">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14V4m0 0 4 4m-4-4L8 8" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span class="act__t">匯入</span>
          <span class="act__d tiny muted">合併去重（id／圖片 MD5）</span>
        </button>
        <button class="act act--danger" @click="doReset">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
          </svg>
          <span class="act__t">重置</span>
          <span class="act__d tiny muted">清除所有記錄與圖片</span>
        </button>
      </div>
      <input ref="importInput" class="hidden" type="file" accept="application/json,.json" @change="onImportFile" />
    </section>

    <!-- 離線與版本 -->
    <section class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 18a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18 10.4 3.8 3.8 0 0 1 17.4 18H7Z" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">離線與版本</h2>
          <p class="sec__desc">沒有網路也能完整開啟與記帳</p>
        </div>
      </header>

      <div class="panel">
        <div class="rows">
          <div class="row">
            <span>
              離線狀態
              <small class="tiny muted">
                {{
                  offlineReady
                    ? '已快取完成，沒有網路也能記帳與辨識收據'
                    : '首次開啟後會自動快取，稍後即可離線使用'
                }}
              </small>
            </span>
            <span class="tag" :class="offlineReady ? 'tag--ok' : ''">
              {{ offlineReady ? '已就緒' : '快取中' }}
            </span>
          </div>
          <div class="row">
            <span>
              版本
              <small class="tiny muted">收到更新提示時可立即套用</small>
            </span>
            <div class="ver">
              <span class="ver__no num">v{{ APP_VERSION }}</span>
              <button class="btn btn--sm" @click="updateSW(true)">檢查更新</button>
            </div>
          </div>
        </div>
        <p class="tiny muted pwa__hint">
          iPhone：Safari 分享 → 「加入主畫面」；Android：瀏覽器選單 → 「安裝應用程式」。
        </p>
      </div>
    </section>

    <p class="foot tiny muted">
      資料全部存放在這台裝置上，不會上傳任何伺服器。主幣別 {{ currency(settings.baseCurrency).name }}
      · 1 {{ settings.inputCurrency }} ≈
      {{ fmtMoney(settings.rate(settings.inputCurrency), settings.baseCurrency) }}
    </p>

    <CategoryManageModal
      :open="showCatMgr"
      :categories="manageCats"
      :usage="catUsage"
      @close="showCatMgr = false"
      @create="onCreateCat"
      @save="onSaveCat"
      @remove="onRemoveCat"
    />

    <!-- 匯出：先選格式（JSON／Excel）與範圍，再下載 -->
    <ExportModal :open="exportOpen" @close="exportOpen = false" />
  </div>
</template>

<style scoped>
.settings {
  max-width: 780px;
  margin: 0 auto;
}

/* ── 區塊 ─────────────────────────────────────────────── */
.sec {
  padding: 16px;
  margin-bottom: 16px;
}
.sec__hd {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}
.sec__icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid;
  place-items: center;
}
.sec__icon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sec__meta {
  min-width: 0;
}
.sec__title {
  font-size: 16px;
  line-height: 1.3;
}
.sec__desc {
  margin: 1px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
}
.sec__hint {
  margin: 0 0 12px;
}

/* ── 面板 ─────────────────────────────────────────────── */
.panel {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 13px 14px;
}
.panel + .panel {
  margin-top: 10px;
}
.panel__hd {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.panel__hd--rate {
  align-items: center;
  gap: 8px;
}
.panel__label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.panel__meta {
  flex: 1;
  min-width: 0;
  text-align: right;
}

/* ── 列 ───────────────────────────────────────────────── */
.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.row--col {
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
}
.row > span {
  font-size: 13.5px;
  font-weight: 550;
  display: flex;
  flex-direction: column;
}
.row small {
  font-weight: 500;
}
.row__ctl {
  width: 100%;
  max-width: 190px;
  background: var(--surface);
}
@media (min-width: 480px) {
  .row__ctl {
    width: auto;
    min-width: 170px;
  }
}

/* ── 匯率 ─────────────────────────────────────────────── */
.rates__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
}
.rate {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s;
}
.rate:focus-within {
  border-color: var(--accent);
}
.rate__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.rate__code {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-2);
  letter-spacing: 0.02em;
}
.rate__input {
  height: 32px;
  font-size: 14px;
  padding: 0 8px;
  min-width: 0;
}
.rate__x {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 10px;
  color: var(--text-3);
}
.rate__x:hover {
  background: var(--expense-soft);
  color: var(--expense);
}
.rates__addsel {
  margin-left: auto;
  width: auto;
  max-width: 220px;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 550;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  color: var(--text);
  cursor: pointer;
}
.currow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.currow__add {
  margin-left: auto;
  max-width: 200px;
  height: 36px;
  font-size: 13px;
  background: var(--surface);
}

/* ── 膠囊 ─────────────────────────────────────────────── */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.chip.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.chip.is-on::before {
  content: '✓';
  font-size: 11px;
  font-weight: 700;
}
.chip--add {
  color: var(--accent);
  border-style: dashed;
}
.chip--sel {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
  padding-right: 6px;
}
.chip__x {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 9px;
  color: var(--accent);
  flex: none;
}
.chip__x:hover {
  background: var(--expense);
  color: #fff;
}

/* ── 分類 ─────────────────────────────────────────────── */
.catgroup {
  margin-bottom: 12px;
}
.catgroup:last-child {
  margin-bottom: 0;
}
.catgroup__label {
  display: block;
  margin-bottom: 6px;
}
.catchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
}
.catchip.is-off {
  opacity: 0.45;
}
.catchip--pick {
  padding: 0 12px;
  color: var(--text-2);
}
.catchip--pick:hover {
  border-color: var(--accent);
}
/* 子分類：**不做逐層縮排** —— 縮排會在列內留下大小不一的空洞，看起來很亂。
   改成跟大類同高、同一個左緣，只靠「└」記號辨識（順序本身就是樹狀順序）。
   記號佔固定寬度，同一列的標籤文字才會落在同一個起點。 */
.catchip__branch {
  flex: none;
  width: 10px;
  margin-left: -3px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1;
  text-align: center;
}
.catchip--pick.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.catchip--pick.is-on::before {
  content: '✓';
  font-size: 11px;
  font-weight: 700;
}
.catchip__ic {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 7px;
  color: var(--c);
  background: var(--bg);
  flex: none;
}
.catchip__name {
  font-size: 13px;
  font-weight: 550;
}
.favs__hint {
  margin: 0 0 11px;
}

/* ── 快速備註 ─────────────────────────────────────────── */
.qn__none {
  margin: 0 0 10px;
}
.qn__list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 10px;
}
.qn__row {
  display: flex;
  align-items: center;
  gap: 7px;
}
/* 這裡的輸入框刻意比 .field 矮（34px），跟旁邊的「新增」鈕同高，列才不會鬆掉 */
.qn__in,
.qn__addin {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  font-size: 14px;
  background: var(--surface);
}
.qn__del {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--text-3);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.qn__del:hover {
  border-color: var(--expense);
  background: var(--expense-soft);
  color: var(--expense);
}
.qn__del svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.qn__add {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── 資料 ─────────────────────────────────────────────── */
.usage {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.usage__stat {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.usage__stat strong {
  font-size: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.act {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 13px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.act svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  margin-bottom: 3px;
}
.act:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.act:disabled {
  opacity: 0.5;
  cursor: default;
}
.act__t {
  font-size: 14px;
  font-weight: 650;
}
.act__d {
  line-height: 1.4;
}
.act--danger svg {
  stroke: var(--expense);
}
.act--danger:hover:not(:disabled) {
  border-color: var(--expense);
  background: var(--expense-soft);
}

/* ── 版本 ─────────────────────────────────────────────── */
/* 容器用 div 而非 span：`.row > span` 會把內容排成直欄，膠囊會被擠到按鈕上面 */
.ver {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.ver__no {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* ── 其他 ─────────────────────────────────────────────── */
.tag--ok {
  background: var(--accent-soft);
  color: var(--accent);
}
.pwa__hint {
  margin: 11px 0 0;
  padding-top: 10px;
  border-top: 1px dashed var(--line-strong);
}
.hidden {
  display: none;
}
.foot {
  margin-top: 18px;
  text-align: center;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 519px) {
  .acts {
    grid-template-columns: 1fr;
  }
  .panel__meta {
    text-align: left;
  }
}
@media (min-width: 768px) {
  .sec {
    padding: 20px;
  }
}
</style>
