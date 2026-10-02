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

const rateRows = computed(() =>
  CURRENCIES.filter((c) => c.code !== settings.baseCurrency).map((c) => ({
    code: c.code,
    name: c.name,
    value: settings.state.rates[c.code] ?? 1,
  })),
)

function commitRate(code: string) {
  const raw = rateDraft.value[code]
  if (raw === undefined) return
  const n = Number(raw)
  if (isFinite(n) && n > 0) settings.setRate(code, n)
  delete rateDraft.value[code]
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
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">設定</h1>
        <p class="page-sub">幣別、分類、收據辨識與資料管理</p>
      </div>
    </div>

    <!-- 幣別與匯率 -->
    <section class="card sec">
      <h2 class="sec__title">幣別與匯率</h2>
      <p class="tiny muted sec__hint">
        每筆記錄會把「當下的匯率」快照下來，之後改匯率不會影響既有記錄
      </p>

      <div class="rows">
        <label class="row">
          <span>主幣別</span>
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

      <div class="rates">
        <div class="rates__hd">
          <span class="tiny muted">1 單位外幣 = ? {{ settings.baseCurrency }}</span>
          <button class="btn btn--sm" :disabled="refreshing" @click="refresh">
            {{ refreshing ? '更新中…' : '更新匯率' }}
          </button>
        </div>
        <p class="tiny muted">最後更新：{{ updatedText }}</p>
        <div class="rates__grid">
          <div v-for="r in rateRows" :key="r.code" class="rate">
            <span class="rate__code">{{ r.code }}</span>
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
    </section>

    <!-- 收據辨識 -->
    <section class="card sec">
      <h2 class="sec__title">收據辨識</h2>
      <div class="rows">
        <div class="row row--col">
          <span>辨識語言<small class="tiny muted">全部在瀏覽器離線執行</small></span>
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
        <label class="row">
          <span>多幣別時預設採用</span>
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
    </section>

    <!-- 分類 -->
    <section class="card sec">
      <h2 class="sec__title">分類</h2>
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

      <!-- 主頁常用分類 -->
      <div class="favs">
        <div class="favs__hd">
          <span class="tiny muted">主頁常用分類</span>
          <span class="tiny muted">
            已選 {{ settings.favoriteCategories.length }} 個
          </span>
        </div>
        <p class="tiny muted sec__hint">
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
      <h2 class="sec__title">資料</h2>
      <p class="tiny muted sec__hint">
        {{ records.records.length }} 筆記錄 · {{ imageCount }} 張圖片 · localStorage 約 {{ usedBytes }}
      </p>

      <div class="dataacts">
        <button class="btn" :disabled="exporting || !records.records.length" @click="doExport">
          匯出（含圖片）
        </button>
        <button class="btn" @click="pickImport">匯入</button>
        <button class="btn btn--danger" @click="askReset = true">重置</button>
      </div>
      <p class="tiny muted sec__hint">
        匯出為單一 JSON 檔；匯入採「合併」方式，相同 id 或圖片 MD5 重複者會自動略過。
      </p>
      <input ref="importInput" class="hidden" type="file" accept="application/json,.json" @change="onImportFile" />
    </section>

    <!-- 離線與版本 -->
    <section class="card sec">
      <h2 class="sec__title">離線使用</h2>
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
      <p class="tiny muted sec__hint">
        iPhone：Safari 分享 → 「加入主畫面」；Android：瀏覽器選單 → 「安裝應用程式」。
      </p>
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
.sec {
  padding: 16px;
  margin-bottom: 14px;
}
.sec__title {
  font-size: 15.5px;
  margin-bottom: 4px;
}
.sec__hint {
  margin: 0 0 12px;
}
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
}
@media (min-width: 480px) {
  .row__ctl {
    width: auto;
    min-width: 170px;
  }
}
.rates {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.rates__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 2px;
}
.rates__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.rate {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rate__code {
  width: 46px;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.rate__input {
  height: 36px;
  font-size: 13px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
}
.chip.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.chip--add {
  color: var(--accent);
  border-style: dashed;
}
.catgroup {
  margin-bottom: 12px;
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
.favs {
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--line);
}
.favs__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.favs__hd > span {
  font-weight: 650;
  color: var(--text-2);
}
.favs .sec__hint {
  margin: 6px 0 10px;
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
  margin-top: 6px;
  flex-wrap: wrap;
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
.dataacts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tag--ok {
  background: var(--accent-soft);
  color: var(--accent);
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
@media (min-width: 768px) {
  .sec {
    padding: 20px;
  }
}
</style>
