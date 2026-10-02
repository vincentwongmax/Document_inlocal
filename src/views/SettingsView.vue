<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { useToast } from '@/composables/useToast'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { buildExport, downloadJson, parseImport, restoreImages } from '@/lib/exportImport'
import { usageBytes } from '@/lib/storage'
import { clearImages, listImageIds } from '@/lib/imageDb'
import { offlineReady, updateSW } from '@/lib/pwa'
import type { Category, Settings, TxType } from '@/types'

const settings = useSettingsStore()
const records = useRecordsStore()
const toast = useToast()

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
  toast.push(ok ? '匯率已更新' : '無法連上匯率服務，沿用既有匯率', ok ? 'ok' : 'warn')
}

const updatedText = computed(() => {
  const t = settings.state.ratesUpdatedAt
  if (!t) return '尚未更新（使用預設值）'
  const d = new Date(t)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

async function changeBase(code: string) {
  await settings.setBaseCurrency(code)
  toast.push(`主幣別已改為 ${code}`, 'ok')
}

/* ── 分類管理 ───────────────────────────────────────────── */
const newName = ref('')
const newType = ref<TxType>('expense')
const newColor = ref('#8a857c')
const editingCat = ref<Category | null>(null)

const grouped = computed(() => [
  { type: 'expense' as TxType, label: '支出分類', list: settings.state.categories.filter((c) => c.type === 'expense') },
  { type: 'income' as TxType, label: '收入分類', list: settings.state.categories.filter((c) => c.type === 'income') },
])

function addCat() {
  const name = newName.value.trim()
  if (!name) return
  settings.addCategory(name, newType.value, newColor.value)
  newName.value = ''
  toast.push('已新增分類', 'ok')
}

function removeCat(c: Category) {
  if (c.builtin) {
    toast.push('內建分類無法刪除，可改名或改顏色', 'warn')
    return
  }
  settings.removeCategory(c.id)
  toast.push('已移除分類', 'info')
}

/* ── 資料管理 ───────────────────────────────────────────── */
const imageCount = ref(0)
const usage = ref(0)
async function refreshUsage() {
  imageCount.value = (await listImageIds()).length
  usage.value = usageBytes()
}
onMounted(refreshUsage)

const exporting = ref(false)
async function doExport() {
  exporting.value = true
  try {
    const payload = await buildExport(records.records, settings.state)
    const name = downloadJson(payload)
    toast.push(`已匯出 ${payload.records.length} 筆 → ${name}`, 'ok')
  } catch (e) {
    toast.push(e instanceof Error ? e.message : '匯出失敗', 'warn')
  }
  exporting.value = false
}

const importInput = ref<HTMLInputElement | null>(null)
const pendingImport = ref<{ records: ReturnType<typeof parseImport>['records']; settings?: Settings; images: Record<string, string> } | null>(null)

function pickImport() {
  importInput.value?.click()
}

async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const parsed = parseImport(await file.text())
    pendingImport.value = parsed
  } catch (err) {
    toast.push(err instanceof Error ? err.message : '匯入失敗', 'warn')
  }
  ;(e.target as HTMLInputElement).value = ''
}

async function runImport(withSettings: boolean) {
  const p = pendingImport.value
  if (!p) return
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
  pendingImport.value = null
  await refreshUsage()
  toast.push(`匯入完成：新增 ${added} 筆${skipped ? `、略過 ${skipped} 筆重複` : ''}`, 'ok')
}

/* ── 重置 ───────────────────────────────────────────────── */
const askReset = ref(false)
async function doReset() {
  await records.reset()
  await clearImages()
  localStorage.removeItem('mop-ledger.draft.v1')
  askReset.value = false
  await refreshUsage()
  toast.push('已重置，所有記錄與圖片都已清除', 'info')
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
        <div class="panel__hd">
          <span class="panel__label">匯率</span>
          <span class="tiny muted panel__meta">
            1 外幣 = ? {{ settings.baseCurrency }} · {{ updatedText }}
          </span>
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
        <div v-if="addableRates.length" class="rates__add">
          <select class="field rates__addsel" :value="''" @change="addRate($event)">
            <option value="" disabled>＋ 新增幣別到匯率表…</option>
            <option v-for="c in addableRates" :key="c.code" :value="c.code">
              {{ c.code }} · {{ c.name }}
            </option>
          </select>
        </div>
      </div>

      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">記帳幣別選單</span>
          <span class="tiny muted panel__meta">主頁切換幣別時顯示哪幾個；沒選 = 全部</span>
        </div>
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
        <div class="rates__add" v-if="addableVisible.length">
          <select class="field rates__addsel" :value="''" @change="addVisible($event)">
            <option value="" disabled>＋ 新增幣別到主頁選單…</option>
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
          <p class="sec__desc">點分類名稱可改名與換色；勾選的分類會固定顯示在主頁</p>
        </div>
      </header>

      <div class="panel">
        <div v-for="g in grouped" :key="g.type" class="catgroup">
          <span class="tiny muted catgroup__label">{{ g.label }}</span>
          <div class="chips">
            <span v-for="c in g.list" :key="c.id" class="catchip" :class="{ 'is-off': c.archived }">
              <span class="catchip__dot" :style="{ background: c.color }" />
              <button class="catchip__name" @click="editingCat = c">{{ c.name }}</button>
              <button class="catchip__x" @click="removeCat(c)">×</button>
            </span>
            <button class="chip chip--add" @click="newType = g.type; addCat()">＋</button>
          </div>
        </div>

        <div class="addcat">
          <input v-model="newName" class="field" placeholder="新分類名稱" maxlength="12" @keyup.enter="addCat" />
          <select v-model="newType" class="field addcat__type">
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
          <input v-model="newColor" class="addcat__color" type="color" />
          <button class="btn btn--primary" :disabled="!newName.trim()" @click="addCat">新增</button>
        </div>
      </div>

      <!-- 主頁常用分類 -->
      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">主頁常用分類</span>
          <span class="tiny muted panel__meta">已選 {{ settings.favoriteCategories.length }} 個</span>
        </div>
        <p class="tiny muted favs__hint">
          勾選幾個，主頁就只顯示那幾個，其餘收進「更多」；沒有勾選任何一個時，主頁顯示全部分類。
        </p>
        <div v-for="g in grouped" :key="'fav-' + g.type" class="catgroup">
          <span class="tiny muted catgroup__label">{{ g.label }}</span>
          <div class="chips">
            <button
              v-for="c in g.list"
              :key="c.id"
              class="catchip catchip--pick"
              :class="{ 'is-on': settings.isFavorite(c.id), 'is-off': c.archived }"
              @click="settings.toggleFavorite(c.id)"
            >
              <span class="catchip__dot" :style="{ background: c.color }" />
              <span class="catchip__name">{{ c.name }}</span>
            </button>
          </div>
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
        <button class="act" :disabled="exporting || !records.records.length" @click="doExport">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span class="act__t">匯出</span>
          <span class="act__d tiny muted">單一 JSON 檔，含圖片</span>
        </button>
        <button class="act" @click="pickImport">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14V4m0 0 4 4m-4-4L8 8" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span class="act__t">匯入</span>
          <span class="act__d tiny muted">合併去重（id／圖片 MD5）</span>
        </button>
        <button class="act act--danger" @click="askReset = true">
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
          <h2 class="sec__title">離線使用</h2>
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
            <button class="btn btn--sm" @click="updateSW(true)">檢查更新</button>
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

    <!-- 編輯分類 -->
    <Transition name="fade">
      <div v-if="editingCat" class="modal" @click.self="editingCat = null">
        <div class="card modal__box">
          <h3>編輯分類</h3>
          <input v-model="editingCat.name" class="field" maxlength="12" />
          <input v-model="editingCat.color" class="modal__color" type="color" />
          <button class="btn btn--primary" @click="editingCat = null">完成</button>
        </div>
      </div>
    </Transition>

    <ConfirmDialog
      :open="!!pendingImport"
      title="匯入資料"
      :message="`檔案含 ${pendingImport?.records.length ?? 0} 筆記錄。是否同時還原匯出時的設定（分類、匯率、幣別）？`"
      confirm-text="連設定一起還原"
      alt-text="只匯入記錄"
      cancel-text="取消"
      @confirm="runImport(true)"
      @alt="runImport(false)"
      @cancel="pendingImport = null"
    />

    <ConfirmDialog
      :open="askReset"
      title="確定要重置嗎？"
      message="所有記錄與圖片都會被清除，且無法復原（幣別、匯率、分類等設定會保留）。"
      confirm-text="重置"
      danger
      @confirm="doReset"
      @cancel="askReset = false"
    />
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
.rates__add {
  margin-top: 10px;
}
.rates__addsel {
  max-width: 260px;
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
.catchip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.catchip__name {
  font-size: 13px;
  font-weight: 550;
}
.catchip__x {
  color: var(--text-3);
  font-size: 15px;
  line-height: 1;
  padding: 0 2px;
}
.catchip__x:hover {
  color: var(--expense);
}
.addcat {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.addcat .field {
  background: var(--surface);
}
.addcat__type {
  width: 88px;
}
.addcat__color {
  width: 42px;
  height: 42px;
  padding: 2px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
}
.favs__hint {
  margin: 0 0 11px;
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
.modal {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(27, 26, 24, 0.34);
  display: grid;
  place-items: center;
  padding: 20px;
}
.modal__box {
  width: 100%;
  max-width: 320px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow-3);
}
.modal__box h3 {
  font-size: 15.5px;
}
.modal__color {
  width: 100%;
  height: 40px;
  padding: 2px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
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
