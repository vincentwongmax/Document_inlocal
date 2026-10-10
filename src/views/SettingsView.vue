<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { QUICK_NOTE_MAX, useSettingsStore } from '@/stores/settings'
import { useRecordsStore } from '@/stores/records'
import { notify, confirmDialog } from '@/lib/alerts'
import CategoryManageModal from '@/components/CategoryManageModal.vue'
import QuickAmountSheet from '@/components/QuickAmountSheet.vue'
import HomeDefaultSheet from '@/components/HomeDefaultSheet.vue'
import TravelSheet from '@/components/TravelSheet.vue'
import TripHistorySheet from '@/components/TripHistorySheet.vue'
import CategoryIcon from '@/components/CategoryIcon.vue'
import { iconForCategory } from '@/lib/icons'
// 0.1.40：isHexColor——旅行區塊的強調色跟著 activeTrip.color（跟 TravelSheet 同一套驗證）
import { withAlpha, isHexColor } from '@/lib/color'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { parseImport, restoreImages } from '@/lib/exportImport'
import ExportModal from '@/components/ExportModal.vue'
import WalletSection from '@/components/WalletSection.vue'
import ReviewSheet from '@/components/ReviewSheet.vue'
import { useUpload } from '@/composables/useUpload'
import { usageBytes, walletUsageBytes } from '@/lib/storage'
import { listImageIds } from '@/lib/imageDb'
import { formatBytes } from '@/lib/imaging'
import { offlineReady, updateSW } from '@/lib/pwa'
import { APP_VERSION } from '@/lib/version'
import type { Category, Settings, TxType } from '@/types'

const settings = useSettingsStore()
const records = useRecordsStore()
const route = useRoute()

/**
 * BETA：收據辨識記帳（0.1.26 從記帳頁搬過來）。
 *
 * ⚠ `useUpload` 的狀態是**模組層級**的（`drafts`／`reviewOpen` 都定義在檔案頂端），
 *   所以它是一個 singleton：這裡呼叫 `up.pick()` 產生的草稿，
 *   會由同樣掛在這一頁的 `<ReviewSheet />` 顯示出來（兩邊看的是同一份狀態）。
 *   ⚠ 因此 ReviewSheet 只需要掛在「當下要顯示它的那一頁」——
 *     0.1.26 起就是這一頁；記帳頁已經完全沒有它了。
 */
const up = useUpload()

/** BETA 區塊的拖放狀態：拖進那個框就亮起來 */
const betaOver = ref(false)
function onBetaDragLeave(e: DragEvent) {
  const to = e.relatedTarget as Node | null
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) betaOver.value = false
}
async function onBetaDrop(e: DragEvent) {
  betaOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
  if (files.length) await up.addFiles(files)
}

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

/* ── 快速金額（0.1.29；0.1.30 編輯移到子頁面）────────── */
/** 設定頁預覽用的顯示資料（按鈕上只秀數字，跟記帳頁那排一樣沒有 icon） */
const presetViews = computed(() =>
  settings.quickPresets.map((p) => {
    const cat = p.categoryId ? settings.category(p.categoryId) ?? null : null
    const bits: string[] = []
    if (p.amount > 0) bits.push(`金額 ${p.amount}`)
    if (p.currency) bits.push(`以 ${p.currency} 記錄`)
    if (cat) bits.push(settings.fullNameOf(cat.id))
    if (p.note.trim()) bits.push(p.note.trim())
    return { preset: p, label: p.amount > 0 ? String(p.amount) : '—', summary: bits.join(' · ') || '還沒設定內容' }
  }),
)

/** 「詳細」子頁面開關（新增／修改／刪除都在 QuickAmountSheet 裡做） */
const quickAmtOpen = ref(false)

/** 「旅行模式」子頁面開關（0.1.35；0.1.37 起主 cell 右側多三顆小鈕） */
const travelOpen = ref(false)

/** 「過去的旅行」子頁面開關（0.1.37；清單從 TravelSheet 搬出來，可修改／可刪除） */
const histOpen = ref(false)

/**
 * 切換鈕（0.1.37）：沒旅行＝打開 TravelSheet 開始表單（那裡就是開始介面）；
 * 旅行中＝**直接走結束確認**（不用先開子頁面再按結束）。
 * 確認文案與 TravelSheet.askEnd 同一套（筆數＋支出＋標記保留說明）。
 */
async function onToggleTrip() {
  const t = settings.activeTrip
  if (!t) {
    travelOpen.value = true
    return
  }
  const s = records.tripSummary(t.id)
  const answer = await confirmDialog({
    title: `結束「${t.name}」？`,
    message: `這趟共 ${s.count} 筆記錄、支出 ${fmtMoney(s.expense, settings.displayCurrency)}${
      s.income > 0 ? `、收入 ${fmtMoney(s.income, settings.displayCurrency)}` : ''
    }。結束後記錄會保留「${t.name}」的旅行標記（不回歸一般記錄），幣別恢復原本的設定；之後可以在「過去的旅行」查看這一趟。`,
    confirmText: '結束旅行',
    danger: true,
  })
  if (answer !== 'confirm' || settings.activeTrip?.id !== t.id) return
  settings.finishTrip()
  notify(`已結束旅行「${t.name}」，記錄標記保留`, 'ok')
}

/**
 * 0.1.40：旅行區塊的強調色（使用者原話：「圖標icon 顏色，和旅行中標籤的顏色，
 * 和3個按鈕點擊時（除了開始鍵/停止鍵）要兩種顏色，也要跟著用戶在子頁中的旅行顏色設定」）。
 * - 跟 TravelSheet.accentStyle 同一套三變數（--trip-c／-soft／-line），
 *   掛在 .travel-sec 上，icon／「旅行中」標籤／按鈕按下態的 CSS 都吃它。
 * - 沒有旅行時不掛（undefined）→ CSS 全部 fallback 回琥珀，畫面跟 0.1.39 前一樣。
 * - 「兩種顏色」拍板＝按下態的**底色（旅行色 12% 軟底）＋字色（旅行色主色）**；
 *   「3 個按鈕」＝主 cell（＝詳細）＋詳細小鈕＋過去的旅行小鈕——
 *   開始/停止切換鈕有自己的開始（琥珀）/結束（紅）語意，刻意不跟。
 */
const tripAccent = computed(() => {
  const t = settings.activeTrip
  if (!t || !isHexColor(t.color)) return undefined
  const c = t.color
  return {
    '--trip-c': c,
    '--trip-c-soft': withAlpha(c, 0.12),
    '--trip-c-line': withAlpha(c, 0.35),
  }
})

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
  settings.allCurrencies.filter((c) => settings.state.visibleCurrencies.includes(c.code)),
)

/** 主頁幣別選單：還能加入下拉的幣別 */
const addableVisible = computed(() =>
  settings.allCurrencies.filter((c) => !settings.state.visibleCurrencies.includes(c.code)),
)

function addVisible(e: Event) {
  const el = e.target as HTMLSelectElement
  if (el.value) settings.toggleVisibleCurrency(el.value)
  el.value = ''
}

/* ── 自訂貨幣（0.1.44）────────────────────────────────────
 * 使用者原話：「增加一個區塊，用戶可以新增或修改或刪除一個現在沒有選單中的貨幣，
 * 自訂匯率，（用戶記錄後，如果DEL 這個匯率的選單，也不影響已記錄的數據）」。
 * 匯率寫進 rates map（跟內建同一個地方）；刪除只從選單移除、rates 留著，
 * 已記錄的資料（自己凍結的 rate）與顯示換算都不受影響。
 */
const customs = computed(() => settings.state.customCurrencies)
const cxCode = ref('')
const cxName = ref('')
const cxRate = ref('')
/** 0.1.45：新增列預設收起，按標題右邊的「＋」才展開；提交成功（或按取消）後收起 */
const cxOpen = ref(false)
const cxDraftName = ref<Record<string, string>>({})
const cxDraftRate = ref<Record<string, string>>({})

/** 0.1.45：收起新增列並清空輸入 */
function closeCx() {
  cxOpen.value = false
  cxCode.value = ''
  cxName.value = ''
  cxRate.value = ''
}

/* ── 記帳頁排版（0.1.45；0.1.46 加入「分類」變 1..7）──────────
 * 1=支出/收入＋幣別、2=金額＋快速金額、3=分類、4=備註、5=日期時間、
 * 6=收據圖片、7=清空＋記錄。點擊順序＝顯示順序；沒點＝不顯示
 * （隱藏區塊的預設值在「預設值」子頁面裡設）。
 */
const layoutItems: { n: number; label: string; icon: string }[] = [
  { n: 1, label: '支出/收入＋幣別', icon: 'M4 8h10M4 8l3-3M4 8l3 3M20 16H10M20 16l-3-3M20 16l-3 3' },
  { n: 2, label: '金額＋快速金額', icon: 'M4.7 2.7h14.6v18.6H4.7zM8.2 7h7.6M8.6 11.4h.01M12 11.4h.01M15.4 11.4h.01M8.6 17.8h3.6' },
  { n: 3, label: '分類', icon: 'M4.6 4.6h5.8l9 9-5.8 5.8-9-9V4.6ZM8.3 8.3h.01' },
  { n: 4, label: '備註', icon: 'M5 5h14v14l-3-1.6L13 19l-2-1.6L8 19l-3-1.6V5ZM9 10h6M9 13.4h4' },
  { n: 5, label: '日期時間', icon: 'M4.4 6.4h15.2v13.2H4.4zM4.4 10.6h15.2M8.4 3.8v4M15.6 3.8v4' },
  { n: 6, label: '收據圖片', icon: 'M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21V3ZM9.5 8h5M9.5 12h5' },
  { n: 7, label: '清空＋記錄', icon: 'M5 12.6 9.4 17 19 7.4' },
]

/** 「預設值」子頁面（0.1.46）：隱藏區塊提交時要用的預設內容 */
const hdOpen = ref(false)

/** 點方塊：已排＝取消；沒排＝加到排序最後 */
function toggleLayout(n: number) {
  const cur = settings.state.homeLayout
  settings.setHomeLayout(cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n])
}

/** 恢復預設＝清空排序（全部顯示、照原本順序） */
function resetLayout() {
  settings.setHomeLayout([])
}

function addCx() {  const code = cxCode.value.trim().toUpperCase()
  const rate = Number(cxRate.value)
  if (!/^[A-Z]{3}$/.test(code)) {
    notify('貨幣代碼要 3 個大寫英文字母（例如 XYZ）', 'warn')
    return
  }
  if (CURRENCIES.some((c) => c.code === code)) {
    notify(`${code} 是內建幣別，直接在選單選就好`, 'warn')
    return
  }
  if (settings.state.customCurrencies.some((c) => c.code === code)) {
    notify(`${code} 已經加過了`, 'warn')
    return
  }
  if (!(isFinite(rate) && rate > 0)) {
    notify('匯率要大於 0（1 單位自訂貨幣 = ? 主幣）', 'warn')
    return
  }
  settings.addCustomCurrency(code, cxName.value, rate)
  notify(`已新增自訂貨幣 ${code}（1 ${code} = ${rate} ${settings.baseCurrency}）`, 'ok')
  cxCode.value = ''
  cxName.value = ''
  cxRate.value = ''
  cxOpen.value = false // 0.1.45：提交成功後再次隱藏
}

function commitCx(code: string) {
  const name = cxDraftName.value[code]
  const rateRaw = cxDraftRate.value[code]
  const patch: { name?: string; rate?: number } = {}
  if (name !== undefined) patch.name = name
  if (rateRaw !== undefined) {
    const n = Number(rateRaw)
    if (isFinite(n) && n > 0) patch.rate = n
  }
  settings.updateCustomCurrency(code, patch)
  delete cxDraftName.value[code]
  delete cxDraftRate.value[code]
}

function removeCx(code: string) {
  settings.removeCustomCurrency(code)
  notify(`已移除自訂貨幣 ${code}（已記錄的資料不受影響）`, 'info')
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
function onCreateCat(p: CatForm & { makeDefault?: boolean }) {
  const c = settings.addCategory(p.name, p.type, p.color, p.icon, p.parentId)
  // 建立時勾了「建立後設為預設分類」：分類 id 這一刻才生出來，所以在這裡補設定
  if (p.makeDefault && c) settings.setDefaultCategory(c.id)
  showCatMgr.value = false
  const under = p.parentId ? settings.category(p.parentId)?.name : ''
  const tail = p.makeDefault && c ? '，並設為記帳預設' : ''
  notify((under ? `已在「${under}」底下新增子分類` : '已新增分類') + tail, 'ok')
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
/** 「記帳預設」切換：空字串＝取消預設 */
function onSetDefaultCat(id: string) {
  settings.setDefaultCategory(id)
  if (!id) {
    notify('已取消預設分類', 'ok')
    return
  }
  const c = settings.category(id)
  notify(c ? `記帳時會預選「${c.name}」` : '已設定預設分類', 'ok')
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

/**
 * 資料統計分兩組（0.1.24）：
 *   本錢包 —— 「當前錢包」的記錄數＋它用到的圖片數＋估算的 localStorage 用量
 *   總資料 —— 全部錢包（含所有錢包）
 *
 * ⚠ 圖片數看的是「這個錢包用到了幾張」而不是 IndexedDB 裡有幾個 blob：
 *   圖檔 blob 是**跨錢包共用**的（同一張圖兩個錢包都用也只存一份），
 *   所以「總圖片數」不等於各錢包相加（聯集才是）。總數那一格直接用
 *   IndexedDB 的 blob 數（= 真正佔空間的張數），並在文案裡說明。
 */
const walletShare = computed(() => {
  const total = records.all.length
  return total ? records.records.length / total : 0
})

/** 全部錢包裡有幾個「不重複」的圖片 id（給總資料那列用） */
const allImageIds = computed(() => {
  const s = new Set<string>()
  for (const r of records.all) for (const im of r.images ?? []) s.add(im.id)
  return s.size
})

const walletImageCount = computed(() => {
  const s = new Set<string>()
  for (const r of records.records) for (const im of r.images ?? []) s.add(im.id)
  return s.size
})

const walletStats = computed(() => ({
  records: records.records.length,
  images: walletImageCount.value,
  bytes: walletUsageBytes(settings.activeWalletId, walletShare.value),
}))

const totalStats = computed(() => ({
  records: records.all.length,
  images: allImageIds.value,
  blobs: imageCount.value,
  wallets: settings.wallets.length,
  bytes: usage.value,
}))

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
  const walletWord = parsed.wallets?.length ? `${parsed.wallets.length} 個錢包、` : ''
  const answer = await confirmDialog({
    title: '匯入資料',
    message: `檔案含 ${walletWord}${parsed.records.length} 筆記錄。是否同時還原匯出時的錢包與設定（分類、匯率、幣別）？`,
    confirmText: '連錢包與設定一起還原',
    denyText: '只匯入記錄',
    cancelText: '取消',
  })
  if (answer === 'cancel') return
  await runImport(parsed, answer === 'confirm')
}

/** 把一份設定套到**當前錢包**上（幣別、匯率、分類、常用備註等都跟著換） */
function applyWalletSettings(s: Settings) {
  settings.state.categories = s.categories
  settings.state.preferredCurrency = s.preferredCurrency
  settings.state.ocrLangs = s.ocrLangs
  settings.state.baseCurrency = s.baseCurrency
  settings.state.inputCurrency = s.inputCurrency
  settings.state.rates = { ...settings.state.rates, ...s.rates }
  settings.state.ratesUpdatedAt = s.ratesUpdatedAt
}

async function runImport(p: ParsedImport, withSettings: boolean) {
  if (withSettings) {
    if (p.wallets?.length) {
      // v2：先把檔案裡沒有的錢包（含各自設定）加進來，再套用當前錢包那份
      settings.upsertWallets(p.wallets, p.settingsByWallet)
      const mine = p.settingsByWallet?.[settings.activeWalletId] ?? p.settings
      if (mine) applyWalletSettings(mine)
    } else if (p.settings) {
      // v1（單錢包時代的舊檔）：設定就套在當前錢包上
      applyWalletSettings(p.settings)
    }
  }
  await restoreImages(p.records, p.images)
  const { added, skipped } = records.mergeImport(p.records)
  await refreshUsage()
  notify(`匯入完成：新增 ${added} 筆${skipped ? `、略過 ${skipped} 筆重複` : ''}`, 'ok')
}

/* ── 重置 ───────────────────────────────────────────────── */
async function doReset() {
  const name = settings.activeWallet.name
  const answer = await confirmDialog({
    title: '確定要重置嗎？',
    message: `「${name}」的所有記錄與收據圖片都會被清除，且無法復原（幣別、匯率、分類等設定會保留）。其他錢包不受影響。`,
    confirmText: '重置這個錢包',
    danger: true,
  })
  if (answer !== 'confirm') return
  // ⚠ 不能用 clearImages()：那會把別的錢包還在用的圖片一起刪掉。
  // records.reset() 是一筆一筆 remove，會自己檢查「還有誰在用這張圖」
  await records.reset()
  localStorage.removeItem('mop-ledger.draft.v1')
  await refreshUsage()
  notify(`已重置「${name}」`, 'info')
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

/** 錢包名稱（顯示在「本錢包」那組的標題上） */
const activeWalletName = computed(() => settings.activeWallet.name)
</script>

<template>
  <div class="page settings">
    <div class="page-head">
      <div>
        <h1 class="page-title">設定</h1>
        <p class="page-sub">幣別、分類、收據辨識與資料管理</p>
      </div>
    </div>

    <!-- 錢包：切換＝換一本帳，各自有自己的記錄與設定 -->
    <WalletSection />

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
            <span>
              目前記帳幣別
              <!--
                0.1.39：旅行中只顯示「由旅行貨幣決定」（使用者原話：「移除"這趟沒有設旅行貨幣"
                的文字 和 "旅行模式進行中"的文字，只保留"由旅行貨幣決定"」）。
                ⚠ 原本的 v-else-if「（這趟沒有設旅行貨幣）」防呆分支一併移除——
                  不管這趟有沒有設旅行貨幣，提示都是同一句（畫面更乾淨）。
                0.1.38：已移除括號內的幣別（select 本身顯示的就是旅行貨幣）。
              -->
              <small v-if="settings.activeTrip" class="tiny muted">由旅行貨幣決定</small>
              <small v-else class="tiny muted">出國時改成當地幣別</small>
            </span>
            <!--
              0.1.36：旅行模式進行中把這個 select 停用（灰色、不可動）——
              使用者原話：「如果打開了旅行模式，目前記帳幣別的選擇變成灰色，而且不會生效，
              旅行模式中的貨幣單位變成目前記帳的貨幣單位」。
              ⚠ 值顯示的就是 inputCurrency——旅行開始時已自動切到旅行貨幣，所以灰色框裡
              看到的正是旅行貨幣；結束旅行後自動恢復、select 跟著解鎖。
            -->
            <select
              class="field row__ctl"
              :class="{ 'row__ctl--locked': !!settings.activeTrip }"
              :value="settings.inputCurrency"
              :disabled="!!settings.activeTrip"
              @change="settings.setInputCurrency(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="c in settings.allCurrencies" :key="c.code" :value="c.code">
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

      <!--
        自訂貨幣（0.1.44 → 0.1.45 改版）
        ──────────────────────────────────────────────
        0.1.45：① 說明文字全部移除（使用者原話）；② 新增改為標題最右的「＋」icon 鈕，
        按了才展開輸入列，提交（或取消）後收起。
      -->
      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">自訂貨幣</span>
          <button
            class="cx__plus"
            type="button"
            :class="{ 'is-open': cxOpen }"
            :title="cxOpen ? '收起新增列' : '新增自訂貨幣'"
            :aria-label="cxOpen ? '收起新增列' : '新增自訂貨幣'"
            :aria-expanded="cxOpen"
            @click="cxOpen = !cxOpen"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <div v-if="customs.length" class="cx__list">
          <div v-for="c in customs" :key="c.code" class="cx__row">
            <span class="cx__code num">{{ c.code }}</span>
            <input
              class="field cx__in"
              :value="cxDraftName[c.code] ?? c.name"
              :aria-label="`${c.code} 名稱`"
              @input="cxDraftName[c.code] = ($event.target as HTMLInputElement).value"
              @blur="commitCx(c.code)"
              @keyup.enter="commitCx(c.code)"
            />
            <input
              class="field cx__in cx__in--rate num"
              :value="cxDraftRate[c.code] ?? (settings.state.rates[c.code] ?? 1)"
              inputmode="decimal"
              :aria-label="`${c.code} 匯率`"
              @input="cxDraftRate[c.code] = ($event.target as HTMLInputElement).value"
              @blur="commitCx(c.code)"
              @keyup.enter="commitCx(c.code)"
            />
            <button
              class="cx__del"
              type="button"
              :title="`刪除自訂貨幣 ${c.code}`"
              :aria-label="`刪除自訂貨幣 ${c.code}`"
              @click="removeCx(c.code)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 7.8 16.2 16.2M16.2 7.8 7.8 16.2" /></svg>
            </button>
          </div>
        </div>
        <div v-if="cxOpen" class="cx__add">
          <input
            v-model="cxCode"
            class="field cx__addin cx__addin--code num"
            type="text"
            :maxlength="3"
            placeholder="代碼"
            aria-label="自訂貨幣代碼（3 個大寫字母）"
            @keydown.enter.prevent="addCx"
          />
          <input
            v-model="cxName"
            class="field cx__addin"
            type="text"
            :maxlength="12"
            placeholder="名稱"
            aria-label="自訂貨幣名稱"
            @keydown.enter.prevent="addCx"
          />
          <input
            v-model="cxRate"
            class="field cx__addin cx__addin--rate num"
            inputmode="decimal"
            placeholder="匯率"
            aria-label="自訂貨幣匯率"
            @keydown.enter.prevent="addCx"
          />
          <!-- 0.1.46：三個輸入框同一行；新增＋取消掉到下一行、貼右、兩顆之間不留白 -->
          <div class="cx__btns">
            <button class="btn btn--primary btn--sm" type="button" :disabled="!cxCode.trim()" @click="addCx">
              新增
            </button>
            <button class="btn btn--sm" type="button" @click="closeCx">取消</button>
          </div>
        </div>      </div>

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

    <!--
      旅行模式（0.1.36）：獨立區塊。
      使用者原話：「旅行模式的按鈕放在獨立的區塊中」——0.1.35 是掛在「幣別與匯率」
      標題列最右，現在整個搬出來自成一個 section（整列可點，打開 TravelSheet 子頁面）。
      進行中會亮成琥珀色並顯示旅行名。
      0.1.40：強調色跟著旅行顏色（tripAccent 掛 --trip-c 系變數；沒旅行 fallback 琥珀）。
    -->
    <section class="card sec travel-sec" :style="tripAccent">
      <!--
        0.1.37：主 cell 右側加三顆小按鈕（使用者原話：「旅行模式增加3個小型按鈕，
        開始旅行和結束旅行的切換按鈕，詳細按鈕，過去的旅行按鈕(新增子頁面, 可修改，可刪除)」）。
        ⚠ button 不能嵌 button → 外面包 .travel-row：主 cell（＝詳細）＋右側三顆獨立小鈕。
      -->
      <div class="travel-row">
        <button class="travel-cell" type="button" @click="travelOpen = true">
          <span class="travel-cell__ic" :class="{ 'is-on': !!settings.activeTrip }" aria-hidden="true">
            <CategoryIcon name="luggage" :size="19" :stroke="1.9" />
          </span>
          <span class="travel-cell__txt">
            <b>旅行模式</b>
            <em v-if="settings.activeTrip">旅行中 · {{ settings.activeTrip.name }}（點開查看或結束）</em>
            <em v-else>出國旅行時用：記錄歸進旅行、自動換幣別</em>
          </span>
          <span v-if="settings.activeTrip" class="travel-cell__tag">旅行中</span>
        </button>
        <span class="travel-cell__minis">
          <!-- 切換鈕：沒旅行＝開始（打開 TravelSheet 表單）；旅行中＝結束（直接走確認） -->
          <button
            class="travel-mini"
            :class="settings.activeTrip ? 'is-end' : 'is-start'"
            type="button"
            :title="settings.activeTrip ? '結束旅行' : '開始旅行'"
            :aria-label="settings.activeTrip ? '結束旅行' : '開始旅行'"
            @click="onToggleTrip"
          >
            <svg v-if="settings.activeTrip" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7.5" y="7.5" width="9" height="9" rx="1.2" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.5 6.2v11.6L18 12z" />
            </svg>
          </button>
          <!-- 詳細鈕：打開 TravelSheet（跟點主 cell 同一個子頁面） -->
          <button class="travel-mini" type="button" title="旅行詳細" aria-label="旅行詳細" @click="travelOpen = true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.6" />
              <path d="M12 11v5" />
              <path d="M12 7.6v.2" />
            </svg>
          </button>
          <!-- 過去的旅行：獨立子頁面（可修改／可刪除，0.1.37 新增） -->
          <button class="travel-mini" type="button" title="過去的旅行" aria-label="過去的旅行" @click="histOpen = true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.6" />
              <path d="M12 7.6V12l3.1 1.9" />
            </svg>
          </button>
        </span>
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
              <option v-for="c in settings.allCurrencies" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>
          </label>
        </div>
      </div>
      <!--
        0.1.45：原本獨立的「BETA 收據辨識記帳」section 整個移除，
        上傳入口併進這一節、放在「多幣別時預設採用」的下方（使用者原話）。
        上傳／拖放／ReviewSheet 的邏輯（betaOver、onBetaDragLeave、onBetaDrop、up）都不變。
      -->
      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">上傳收據辨識記帳</span>
          <span class="beta">BETA</span>
        </div>
        <button
          class="upload"
          type="button"
          title="上傳收據後自動辨識，幫你建立記錄"
          :class="{ 'is-over': betaOver }"
          @click="up.pick()"
          @dragenter.prevent="betaOver = true"
          @dragover.prevent="betaOver = true"
          @dragleave="onBetaDragLeave"
          @drop.prevent="onBetaDrop"
        >
          <svg class="uic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V5m0 0 4 4m-4-4L8 9" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
          <span>上傳收據圖片</span>
          <em class="tiny muted">自動辨識記帳</em>
        </button>
        <p class="tiny muted beta__hint">
          也可以直接把圖片拖進上面的框。辨識完會彈出一張清單，讓你逐筆確認後才建立記錄。
          ⚠ 這是實驗性功能：數字若辨識得怪怪的，請以收據上的金額為準，或改用記帳頁的「收據圖片」。
        </p>
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
            <span class="qn__no num" aria-hidden="true">{{ i + 1 }}</span>
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

    <!--
      記帳頁排版（0.1.45）：把記帳頁的六個區塊由上到下排序，不點的＝不顯示。
      使用者原話：「用戶先點擊先排序……或不顯示(沒參加排序不顯示, 不顯示的時候，
      記錄提交按預設走，所有東西都可以不參加排序)」。
      互動：按想要出現的順序**逐顆點**（第 1 顆點的最上面），點已排的＝取消；
      沒排任何一顆＝全部照預設顯示。
    -->
    <section id="sec-homelayout" class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="3.6" y="3.6" width="7.2" height="7.2" rx="1.8" />
            <rect x="13.2" y="3.6" width="7.2" height="7.2" rx="1.8" />
            <rect x="3.6" y="13.2" width="7.2" height="7.2" rx="1.8" />
            <rect x="13.2" y="13.2" width="7.2" height="7.2" rx="1.8" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">記帳頁排版</h2>
          <p class="sec__desc">照你喜歡的上下順序點下面的方塊；沒點到的區塊不會顯示在記帳頁</p>
        </div>
        <!-- 0.1.46：兩顆都貼在標題列最右（照「快速金額」的詳細鈕同一個位置） -->
        <button class="btn btn--ghost btn--sm ly__hd-btn" type="button" @click="hdOpen = true">
          預設值
        </button>
        <button
          v-if="settings.state.homeLayout.length"
          class="btn btn--sm ly__hd-btn"
          type="button"
          @click="resetLayout"
        >
          恢復預設
        </button>
      </header>

      <div class="panel">
        <div class="panel__hd">
          <span class="panel__label">
            {{ settings.state.homeLayout.length ? `目前順序（${settings.state.homeLayout.length} 個區塊）` : '預設（全部顯示）' }}
          </span>
        </div>

        <!-- 目前順序的預覽：1 → 3 → 4 …（空的時候不顯示） -->
        <p v-if="settings.state.homeLayout.length" class="ly__order tiny">
          <template v-for="(n, i) in settings.state.homeLayout" :key="n">
            <span class="ly__chip num">{{ i + 1 }} {{ layoutItems.find((x) => x.n === n)?.label }}</span>
            <span v-if="i < settings.state.homeLayout.length - 1" class="ly__arrow" aria-hidden="true">→</span>
          </template>
        </p>

        <div class="ly__grid">
          <button
            v-for="it in layoutItems"
            :key="it.n"
            type="button"
            class="ly__t"
            :class="settings.state.homeLayout.includes(it.n) ? 'is-on' : 'is-off'"
            :title="settings.state.homeLayout.includes(it.n) ? '點一下取消顯示' : '點一下加到排序最後'"
            @click="toggleLayout(it.n)"
          >
            <span class="ly__ic" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path :d="it.icon" /></svg>
            </span>
            <span class="ly__n">{{ it.label }}</span>
            <span v-if="settings.state.homeLayout.includes(it.n)" class="ly__no num">
              {{ settings.state.homeLayout.indexOf(it.n) + 1 }}
            </span>
            <span v-else class="ly__off">不顯示</span>
          </button>
        </div>
      </div>
    </section>

    <!--
      快速金額（0.1.29 → 0.1.31 精簡）：
      本區**只留「記帳頁會長這樣」的即時預覽**（使用者：「按鈕內容的外框和以下文字移除」），
      「詳細」按鈕移到**標題列最右邊**；新增／修改／刪除都在 QuickAmountSheet 子頁面裡。
    -->
    <section id="sec-quickamt" class="card sec">
      <header class="sec__hd">
        <span class="sec__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="3.4" y="6.2" width="17.2" height="11.6" rx="2.6" />
            <circle cx="12" cy="12" r="2.7" />
            <path d="M6.4 10.2h.01M17.6 13.8h.01" />
          </svg>
        </span>
        <div class="sec__meta">
          <h2 class="sec__title">快速金額</h2>
          <p class="sec__desc">
            記帳頁金額框裡的那排方鈕，點一下帶入金額／分類／備註（還是要自己按「記錄」）
          </p>
        </div>
        <!-- 0.1.31：從 panel 底下移上來，貼在標題列最右 -->
        <button class="btn btn--ghost btn--sm qa__detail" type="button" @click="quickAmtOpen = true">
          詳細
        </button>
      </header>

      <!-- 即時預覽：跟記帳頁金額框裡那排一模一樣（只有數字、沒有 icon） -->
      <div v-if="settings.quickPresets.length" class="qprev">
        <span class="qprev__lb">記帳頁會長這樣</span>
        <div class="qprev__row">
          <span v-for="v in presetViews" :key="v.preset.id" class="qprev__b" :title="v.summary">
            <span class="qprev__n num">{{ v.label }}</span>
          </span>
        </div>
      </div>
      <p v-else class="tiny muted qn__none">還沒有任何快速金額，按右上角的「詳細」加第一顆。</p>
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
          <p class="sec__desc">
            備份與還原；資料只存在這台裝置。統計分成「本錢包」與「總資料（含所有錢包）」
          </p>
        </div>
      </header>

      <!-- 本錢包 -->
      <div class="usage">
        <div class="usage__hd">
          <span class="usage__tag">本錢包</span>
          <span class="tiny muted">{{ activeWalletName }}</span>
        </div>
        <div class="usage__grid">
          <div class="usage__stat">
            <strong class="num">{{ walletStats.records }}</strong>
            <span class="tiny muted">筆記錄</span>
          </div>
          <div class="usage__stat">
            <strong class="num">{{ walletStats.images }}</strong>
            <span class="tiny muted">張圖片</span>
          </div>
          <div class="usage__stat">
            <strong class="num">{{ formatBytes(walletStats.bytes) }}</strong>
            <span class="tiny muted">約佔空間</span>
          </div>
        </div>
      </div>

      <!-- 總資料（含所有錢包） -->
      <div class="usage">
        <div class="usage__hd">
          <span class="usage__tag usage__tag--all">總資料</span>
          <span class="tiny muted">含所有錢包 · {{ totalStats.wallets }} 本帳</span>
        </div>
        <div class="usage__grid">
          <div class="usage__stat">
            <strong class="num">{{ totalStats.records }}</strong>
            <span class="tiny muted">筆記錄</span>
          </div>
          <div class="usage__stat">
            <strong class="num">{{ totalStats.images }}</strong>
            <span class="tiny muted">張圖片</span>
          </div>
          <div class="usage__stat">
            <strong class="num">{{ formatBytes(totalStats.bytes) }}</strong>
            <span class="tiny muted">localStorage</span>
          </div>
        </div>
        <p class="usage__hint tiny muted">
          圖片檔是跨錢包共用的（同一張圖多本帳用到也只存一份），所以總張數不一定等於各錢包相加
        </p>
      </div>

      <div class="acts">
        <button class="act" :disabled="!records.all.length" @click="exportOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span class="act__t">匯出</span>
          <span class="act__d tiny muted">JSON（可還原）或 Excel（ZIP），可選本錢包或全部錢包</span>
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
          <span class="act__d tiny muted">只清除當前錢包的記錄與圖片</span>
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
      :default-id="settings.defaultCategoryId"
      @close="showCatMgr = false"
      @create="onCreateCat"
      @save="onSaveCat"
      @remove="onRemoveCat"
      @set-default="onSetDefaultCat"
    />

    <!-- 匯出：先選格式（JSON／Excel）與範圍，再下載 -->
    <!-- 快速金額的詳細子頁面（格局照「管理分類」：鎖背景、下拉關閉、清單↔編輯轉場） -->
    <QuickAmountSheet :open="quickAmtOpen" @close="quickAmtOpen = false" />
    <!-- 記帳頁排版的「預設值」子頁面（0.1.46）：隱藏區塊提交時要用的預設內容 -->
    <HomeDefaultSheet :open="hdOpen" @close="hdOpen = false" />

    <!-- 旅行模式子頁面（0.1.35；骨架與其他子頁面同一套） -->
    <TravelSheet :open="travelOpen" @close="travelOpen = false" />
    <TripHistorySheet :open="histOpen" @close="histOpen = false" />

    <ExportModal :open="exportOpen" @close="exportOpen = false" />

    <!--
      BETA 收據辨識的結果清單（0.1.26 從記帳頁搬過來）。
      ⚠ 它讀的是 `useUpload()` 的模組層級狀態，所以在哪一頁掛它就決定了「辨識結果
        會出現在哪一頁」—— 記帳頁已經完全沒有它了，這裡是唯一的一處。
    -->
    <ReviewSheet />
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

/* ── BETA 區塊（0.1.26：收據辨識記帳從記帳頁搬過來）─────────
   樣式刻意沿用記帳頁原本那顆 `.upload`（虛線框、hover 轉墨綠），
   讓從舊位置過來的人一眼認得是同一個功能。 */
.sec--beta {
  border-color: var(--accent-light);
}
.beta {
  margin-left: 6px;
  vertical-align: 2px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--pick-soft);
  color: var(--pick);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
}
.upload {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 13px;
  border-radius: 12px;
  border: 1px dashed var(--line-strong);
  background: var(--surface-2);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.upload:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
/* 拖曳進來時同一個亮法（以前在記帳頁是整頁遮罩，現在只亮這個框） */
.upload.is-over {
  background: var(--accent-soft);
  border-color: var(--accent);
  border-style: solid;
  color: var(--accent);
}
.upload em {
  margin-left: auto;
  font-style: normal;
  font-weight: 500;
}
.uic {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: none;
}
.beta__hint {
  margin: 9px 0 0;
  line-height: 1.55;
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
/* ⚠ 字級 16px 是 0.1.25 的全站約定（見 src/style.css）：iOS 對 < 16px 的可編輯元素
   會 focus zoom，且 blur 後不保證還原 → 「點過輸入框後連點空白處頁面會往上滑」。
   **這裡曾經是 14px，不能再改回去。**（高度仍由上面的 32px 控制） */
.rate__input {
  height: 32px;
  font-size: 16px;
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
  margin-bottom: 12px;
}
/* 0.1.44 美化：每列改成卡片（描邊＋圓角＋淡底），列內輸入框去框融入卡片 */
.qn__row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px 5px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
}
.qn__no {
  flex: none;
  width: 20px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
}
/* 這裡的輸入框刻意比 .field 矮（34px），跟旁邊的「新增」鈕同高，列才不會鬆掉。
   ⚠ 字級 16px 是 0.1.25 的全站約定（見 src/style.css）：iOS 對 < 16px 的可編輯元素
   會 focus zoom，且 blur 後不保證還原 → 「點過輸入框後連點空白處頁面會往上滑」。
   **這裡曾經是 14px，不能再改回去。**（高度仍然由上面的 34px 控制，字級不影響列高） */
.qn__in,
.qn__addin {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  font-size: 16px;
  background: var(--surface);
}
/* 列內的輸入框融入卡片：去框、透明底（字級 16px 約定照舊） */
.qn__row .qn__in {
  padding: 0 2px;
  border: 0;
  background: transparent;
}
.qn__del {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  transition:
    background 0.12s,
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

/* ── 記帳頁排版（0.1.45）────────────────────────────────── */
/* 目前順序的預覽（1 支出/收入 → 3 備註 → …） */
.ly__order {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin: 0 0 11px;
}
.ly__chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 650;
}
.ly__arrow {
  color: var(--text-3);
}
/* 六個小方塊：兩欄卡片格 */
.ly__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.ly__t {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.12s,
    background 0.12s,
    opacity 0.12s;
}
.ly__t.is-on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.ly__t.is-off {
  opacity: 0.6;
}
.ly__t:hover {
  border-color: var(--accent);
}
.ly__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--surface-3);
  color: var(--text-2);
}
.ly__t.is-on .ly__ic {
  background: var(--surface);
  color: var(--accent);
}
.ly__ic svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ly__n {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.ly__no {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 750;
}
.ly__off {
  flex: none;
  font-size: 10px;
  font-weight: 650;
  color: var(--text-3);
}

/* ── 自訂貨幣（0.1.44；0.1.45 新增列收合）────────────── */
/* 標題最右的「＋」icon 鈕：按了展開／收起新增列（樣式跟 ClearableInput 的小鈕同一族） */
.cx__plus {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  transition:
    background 0.12s,
    color 0.12s,
    transform 0.06s;
}
.cx__plus:hover,
.cx__plus.is-open {
  background: var(--accent);
  color: #fff;
}
.cx__plus:active {
  transform: scale(0.94);
}
.cx__plus svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.cx__hint {
  margin: 0 0 10px;
}
.cx__list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 10px;
}
.cx__row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px 5px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
}
.cx__code {
  flex: none;
  width: 42px;
  font-size: 13px;
  font-weight: 750;
  letter-spacing: 0.04em;
  color: var(--accent);
}
.cx__in {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  font-size: 16px;
  background: transparent;
  border: none;
}
.cx__in--rate {
  flex: none;
  width: 88px;
  text-align: right;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.cx__del {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--text-3);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.cx__del:hover {
  border-color: var(--expense);
  background: var(--expense-soft);
  color: var(--expense);
}
.cx__del svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.cx__add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface-2);
}
.cx__addin {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  font-size: 16px;
  background: var(--surface);
}
.cx__addin--code {
  flex: none;
  width: 64px;
  text-transform: uppercase;
}
.cx__addin--rate {
  flex: none;
  width: 84px;
  text-align: right;
}
/*
 * 0.1.46（使用者原話）：「自訂貨幣的3個輸入框，都要放在同一行，新增和取消的
 * 按鈕放在下一行的最右邊, 兩個按鈕之間不要有空白」。
 * 輸入框一整行（名稱吃彈性）；按鈕包成一組推到最右、組內 gap=0 緊鄰。
 */
.cx__btns {
  display: flex;
  margin-left: auto;
  gap: 0;
}

/* ── 快速金額（0.1.29；0.1.30 編輯移到子頁面）────────── */
/* 本區只剩「即時預覽」與「詳細」按鈕：
   新增／修改／刪除全部在 QuickAmountSheet（格局照「管理分類」）裡做。 */
/* 即時預覽：外觀跟記帳頁金額框裡那排一致（只有數字、32px 高、9px 圓角、白底描邊） */
.qprev {
  margin: 0 0 12px;
  padding: 10px 11px 11px;
  border: 1px dashed var(--accent-light);
  border-radius: var(--r-md);
  background: var(--accent-soft);
}
.qprev__lb {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.qprev__row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.qprev__b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 32px;
  padding: 0 11px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 700;
}
.qprev__n {
  line-height: 1;
}
/* 「詳細」按鈕（0.1.31：移到「快速金額」標題列的最右邊） */
.qa__detail {
  margin-left: auto;
  align-self: center;
}
/* 旅行模式（0.1.36 獨立區塊；0.1.37 主 cell 右側加三顆小按鈕）
   ⚠ button 不能嵌 button → .travel-row 包「主 cell（＝詳細）＋三顆獨立小鈕」 */
.travel-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.travel-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px;
  text-align: left;
}
.travel-cell__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--surface-3);
  border: 1px solid var(--line);
  color: var(--text-2);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
/* 0.1.40：進行中 icon 跟著旅行顏色（--trip-c 由 .travel-sec inline 掛，沒旅行 fallback 琥珀） */
.travel-cell__ic.is-on {
  background: var(--trip-c-soft, var(--amber-soft));
  border-color: var(--trip-c-line, var(--amber));
  color: var(--trip-c, var(--amber));
}
.travel-cell__txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.travel-cell__txt b {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.travel-cell__txt em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 0.1.40：「旅行中」標籤跟著旅行顏色（原本寫死琥珀） */
.travel-cell__tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--trip-c-soft, var(--amber-soft));
  border: 1px solid var(--trip-c, var(--amber));
  color: var(--trip-c, var(--amber));
  font-size: 11.5px;
  font-weight: 700;
}
/* 三顆小按鈕（0.1.37）：切換（開始/結束）／詳細／過去的旅行——34px 方型圓角 */
.travel-cell__minis {
  flex: none;
  display: flex;
  gap: 7px;
}
.travel-mini {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text-2);
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.travel-mini svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 0.1.40：主 cell 按下態也給旅行色軟底回饋（原本整列可點但按下沒反應） */
.travel-cell:active {
  background: var(--trip-c-soft, var(--amber-soft));
  border-radius: var(--r-sm);
}
.travel-mini:hover {
  border-color: var(--amber);
  background: var(--amber-soft);
  color: var(--amber);
}
/* 0.1.40：詳細／過去的旅行兩顆（不含開始/停止切換鈕）按下與 hover 跟旅行顏色。
   :not(.is-start):not(.is-end) 把切換鈕排除——它有自己的開始（琥珀）/結束（紅）語意 */
.travel-mini:not(.is-start):not(.is-end):hover,
.travel-mini:not(.is-start):not(.is-end):active {
  border-color: var(--trip-c, var(--amber));
  background: var(--trip-c-soft, var(--amber-soft));
  color: var(--trip-c, var(--amber));
}
/* 開始（▶）＝琥珀（旅行主題）；結束（■）＝紅調（危險動作） */
.travel-mini.is-start {
  border-color: var(--amber-line);
  background: var(--amber-soft);
  color: var(--amber);
}
.travel-mini.is-end {
  border-color: var(--expense);
  background: var(--expense-soft);
  color: var(--expense);
}
/* 旅行進行中，「目前記帳幣別」的 select 停用（使用者：變成灰色、不會生效） */
.row__ctl--locked,
.row__ctl:disabled {
  color: var(--text-3);
  background: var(--surface-3);
  border-color: var(--line);
  opacity: 0.8;
}

/* ── 資料 ─────────────────────────────────────────────── */
/* ⚠ 0.1.24 起分成兩組（本錢包 / 總資料），所以 .usage 不再帶 margin-bottom，
   改由 .usage + .usage 隔開；.usage__grid 才是三欄那一排 */
.usage {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.usage + .usage {
  margin-top: 14px;
}
.usage__hd {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.usage__tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-light);
  white-space: nowrap;
}
.usage__tag--all {
  color: var(--text-2);
  background: var(--surface-3);
  border-color: var(--line);
}
.usage__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.usage__hint {
  margin: 0;
  line-height: 1.45;
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
