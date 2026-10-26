<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { notify } from '@/lib/alerts'
import type { DateRange } from '@/composables/useStats'
import type { TxRecord } from '@/types'
import RecordList from '@/components/RecordList.vue'
import RecordRow from '@/components/RecordRow.vue'
import RecordSheet from '@/components/RecordSheet.vue'
import DateField from '@/components/DateField.vue'
import ClearableInput from '@/components/ClearableInput.vue'
import CategorySearchPicker from '@/components/CategorySearchPicker.vue'
import CategoryIcon from '@/components/CategoryIcon.vue'
import HighlightText from '@/components/HighlightText.vue'
import MoreFilterMenu from '@/components/MoreFilterMenu.vue'
import { currency, fmtCompact, fmtMoney } from '@/lib/currency'
import { iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import {
  addDays,
  dayKey,
  formatGap,
  formatRange,
  monthKey,
  monthRange,
  todayKey,
  todayUnit,
  unitLabel,
  unitRange,
  type RangeUnit,
} from '@/lib/date'

const records = useRecordsStore()
const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()

const mode = ref<'unit' | 'custom'>('unit')
const unit = ref<RangeUnit>('day')
const key = ref(todayUnit('day'))
const start = ref(todayKey())
const end = ref(todayKey())

/** 收支篩選 */
const typeFilter = ref<'all' | 'expense' | 'income'>('all')

/**
 * 「最近」檢視：改用**記錄被新增的時間**（createdAt）查詢，而不是使用者填的交易時間。
 * 用途：今天才補登前幾天（甚至上個月）的發票時，用交易時間是找不到的，
 * 切成新增時間才看得到「我最近才輸入的那些」。
 */
const recent = ref(false)

/**
 * 0.1.61：待辦篩選（檢視列的新按鈕，每按一下換一檔，循環）。
 * 使用者原話：「檢視裡的依新增時間的按鈕的左手邊新增一個按鈕，
 * 不限制 → 待辦(全部 icon) → 待辦(完成 icon) → 待辦(未完成 icon)，
 * 用戶按了這個按鈕後，搜索的結果會再根據這些按鈕再篩選」。
 *
 * 四檔（預設 `off`＝不限制，不做任何事）：
 *  - `off`     不限制（所有記錄）
 *  - `has`     有待辦（掛了至少一個待辦事項，不管完成與否）
 *  - `done`    待辦全部完成（有待辦，而且每一個都打勾）
 *  - `pending` 有待辦未完成（至少一個還沒打勾）
 */
const todoFilter = ref<'off' | 'has' | 'done' | 'pending'>('off')
const TODO_CYCLE: Array<'off' | 'has' | 'done' | 'pending'> = ['off', 'has', 'done', 'pending']
function cycleTodo() {
  const i = TODO_CYCLE.indexOf(todoFilter.value)
  todoFilter.value = TODO_CYCLE[(i + 1) % TODO_CYCLE.length]
}
/** 按鈕上的字：只有「不限制」是字面，其餘三檔都叫「待辦」，靠 icon 區分 */
const todoBtnLabel = computed(() => (todoFilter.value === 'off' ? '不限制' : '待辦'))
/** 說明目前這一檔、按下去會切到哪一檔 */
const todoTitle = computed(() => {
  switch (todoFilter.value) {
    case 'off':
      return '待辦篩選：不限制（按一下改成只看有待辦的記錄）'
    case 'has':
      return '待辦篩選：有待辦事項的記錄（再按改成只看全部完成）'
    case 'done':
      return '待辦篩選：待辦全部完成的記錄（再按改成只看未完成）'
    default:
      return '待辦篩選：還有未完成的記錄（再按回不限制）'
  }
})

/**
 * 0.1.62：「更多」下拉篩選（檢視列最右邊那一顆，取代原本的「依新增時間／依實時」）。
 *
 * 使用者原話：「依實時的按鈕改成一個下拉選單（不要影響依實時的功能，這部份的功能由用戶
 * 可按『最近』的按鈕取代），名字改成更多，下拉選單: (圖片，旅行，待辦事項)，
 * 用戶可以單選或多選，只顯示在目前條件下有這些標籤的記錄，例如用戶選了圖片和旅行，
 * 即記錄要同時有圖片和旅行的標籤顯示…用戶選擇後，按鈕的名字改成用戶已選的，
 * 但只要第一個字，如果是多選，圖+旅 之類的」。
 *
 * ⚠⚠ 原本那一顆跟「最近」**控制的是同一個東西**（`recent`：用新增時間還是交易時間），
 *   所以把它換掉**不會**損失功能——切時間基準就按「最近」那一顆（它還在原地）。
 * - `v` 是內部鍵，`short` 是按鈕上顯示的那**一個字**（使用者原話：「只要第一個字」）。
 * - 過濾是 **AND**：勾了「圖片＋旅行」就只留同時有圖片與旅行標籤的記錄。
 * - 標籤的判定跟記錄列上的標籤（RecordRow）同一套：
 *   圖（`images.length`）／旅（`tripId`）／記（`todos`）。
 * 0.1.64：新增第四項「未計入統計」（`short`＝「排」）。它不是標籤而是**狀態**
 *   （統計頁總結卡跳過來就是勾這一格），`short` 刻意跟記錄列那顆橙色「排」
 *   標記用同一個字——使用者在兩邊看到的是同一個詞彙。
 */
const MORE_TAGS = [
  { v: 'img', label: '圖片', short: '圖' },
  { v: 'trip', label: '旅行', short: '旅' },
  { v: 'todo', label: '待辦事項', short: '待' },
  { v: 'excl', label: '未計入統計', short: '排' },
] as const
/** 下拉的選項（給 MoreFilterMenu；`short` 只用在按鈕上，不進選項） */
const moreOptions: { v: string; label: string }[] = MORE_TAGS.map((t) => ({
  v: t.v,
  label: t.label,
}))
/** 已勾選的標籤（順序照 MORE_TAGS） */
const moreTags = ref<string[]>([])
const moreActive = computed(() => moreTags.value.length > 0)
/** 按鈕上的字：沒勾＝「更多」；勾了＝首字以「+」連接（圖+旅／圖+旅+待） */
const moreLabel = computed(() => {
  const picked = MORE_TAGS.filter((t) => moreTags.value.includes(t.v))
  const base = picked.length ? picked.map((t) => t.short).join('+') : '更多'
  // 0.1.69：開了「顯示實際時間」也要讓按鈕看得出來（用「時」接在後面）
  // 0.1.77：時間差開關用「差」接在後面
  const marks = [showAbsTime.value ? '時' : '', showGapTime.value ? '差' : ''].filter(Boolean)
  return marks.length ? `${base}+${marks.join('+')}` : base
})
const moreTitle = computed(() =>
  moreActive.value
    ? `只顯示符合以下條件的記錄：${MORE_TAGS.filter((t) => moreTags.value.includes(t.v))
        .map((t) => t.label)
        .join('、')}（再按可取消）`
    : '更多篩選：圖片／旅行／待辦事項／未計入統計（可複選）',
)
/**
 * 0.1.69：「更多 › 顯示方式 › 顯示實際時間」開關。
 *
 * ⚠ 這**不是**篩選條件（不影響記錄筆數），所以不混進 `moreTags`，
 *   而是 `MoreFilterMenu` 的 `extras`／`extraOn`（下拉裡用分隔線隔開的一段）。
 *
 * ⚠ 持久化到 localStorage：這是**顯示偏好**，不是資料篩選 —— 重新整理後
 *   使用者不該要再按一次。鍵名帶 app 前綴，避免跟其他設定打架。
 */
const ABS_TIME_KEY = 'mop-ledger.ui.absTime.v1'
const absTimeOn = ref<string[]>(loadAbsTime())
function loadAbsTime(): string[] {
  try {
    return localStorage.getItem(ABS_TIME_KEY) === '1' ? ['abs-time'] : []
  } catch {
    return []
  }
}
function saveAbsTime() {
  try {
    localStorage.setItem(ABS_TIME_KEY, showAbsTime.value ? '1' : '0')
  } catch {
    /* 隱私模式等 → 記不住就記不住，不影響使用 */
  }
}
/**
 * 0.1.77：「顯示與上一筆記錄的時間差」開關（同一個下拉裡的「顯示方式」區）。
 *
 * 使用者原話：「在檢視的區域, 更多的下拉選單，增加一個選項，用戶選擇後，
 *   按當前用戶顯示的數據，在每筆記都會顯示多一個標籤，這個標籤會與上一個記錄
 *   做一個時間差，顯示給用戶看，詳細至日時分，標籤的風格和時間標籤的風格類似」。
 *
 * ⚠ 跟「顯示實際時間」一樣是**顯示偏好**（不篩選記錄）→ 放 `extras` 不放 `options`。
 * ⚠ 持久化到 localStorage（跟 abs-time 共用同一個鍵，存成 JSON 陣列）。
 */
const GAP_TIME_KEY = 'mop-ledger.ui.gapTime.v1'
const gapTimeOn = ref<string[]>(loadGapTime())
function loadGapTime(): string[] {
  try {
    return localStorage.getItem(GAP_TIME_KEY) === '1' ? ['gap-time'] : []
  } catch {
    return []
  }
}
function saveGapTime() {
  try {
    localStorage.setItem(GAP_TIME_KEY, showGapTime.value ? '1' : '0')
  } catch {
    /* 隱私模式等 → 記不住就記不住，不影響使用 */
  }
}
/** 開關打開了嗎 */
const showAbsTime = computed(() => absTimeOn.value.includes('abs-time'))
/** 0.1.77：時間差標籤開關打開了嗎 */
const showGapTime = computed(() => gapTimeOn.value.includes('gap-time'))
watch(absTimeOn, () => saveAbsTime(), { deep: true })
watch(gapTimeOn, () => saveGapTime(), { deep: true })
/** 下拉裡「顯示方式」那一段的選項 */
const moreExtras = [
  { v: 'abs-time', label: '顯示實際時間' },
  // 0.1.82（需求 2）：使用者原話「上一筆記錄時間差 改成 時間差標籤」
  { v: 'gap-time', label: '時間差標籤' },
]
/**
 * 0.1.77：MoreFilterMenu 的 `extraOn` 只有一個 v-model，
 * 但「顯示方式」現在有兩個開關 → 這裡合併成一份再拆回去。
 * ⚠ 兩個來源各自存自己的 localStorage 鍵，合併只是給元件看的。
 */
const extraOn = computed<string[]>({
  get: () => [...absTimeOn.value, ...gapTimeOn.value],
  set: (v) => {
 absTimeOn.value = v.includes('abs-time') ? ['abs-time'] : []
    gapTimeOn.value = v.includes('gap-time') ? ['gap-time'] : []
  },
})
/**
 * ⚠⚠ computed 的 setter **不會**被 `<script setup>` 模板裡的
 *   `@update:extra-on="extraOn = $event"` 叫到（`extraOn` 是 const，
 *   模板賦值寫到 setup 物件上，不會回到 computed 的 setter）——
 *   所以要用**明確的函式**接事件。
 */
function setExtraOn(v: string[]) {
  extraOn.value = v
}
/**
 * 全部記錄是不是同一天？
 * 使用者原話：「如果記錄都是同一天，就不用顯示日期，只顯示時間，
 * 若是記錄中有一個不是同一天的，就日期時間都顯示」。
 *
 * ⚠ 判斷用的是**目前篩選後的全部記錄**（`rows`），不是目前這一頁 ——
 *   使用者講的是「記錄中有一個不是同一天的」，只要清單裡有任何一筆跨日就要顯示日期。
 *   時間來源用 `occurredAt`（跟 RecordRow 顯示的時間一致）。
 */
const allSameDay = computed(() => {
  const list = rows.value
  if (!list.length) return true
  const k0 = dayKey(list[0].occurredAt)
  return list.every((r) => dayKey(r.occurredAt) === k0)
})
/**
 * 傳給 RecordList → RecordRow 的時間顯示粒度（0.1.70 改成四級）。
 *
 * 判斷順序由粗到細，看**目前篩選後的全部記錄**（`rows`）最細到哪裡相同：
 *   'full'  → 年份有差異：2023/10/18 22:08
 *   'md'    → 年份相同但月或日有差異：10/18 22:08
 *   'd'     → 年月相同但日有差異：18 22:08
 *   'time'  → 年月日全同（只有時間不同）：22:08
 * ⚠ 只往「同」的方向顯示，不會多加永遠不會變的年／月 —— 在今天的清單裡
 *   顯示「2026/10/18」只是雜訊，跨年才會出現年份。
 */
const absTimeMode = computed<'off' | 'time' | 'd' | 'md' | 'full'>(() => {
  if (!showAbsTime.value) return 'off'
  const list = rows.value
  if (!list.length || allSameDay.value) return 'time'
  const y0 = monthKey(list[0].occurredAt).slice(0, 4)
  const sameYear = list.every((r) => monthKey(r.occurredAt).slice(0, 4) === y0)
  if (!sameYear) return 'full'
  const m0 = monthKey(list[0].occurredAt)
  const sameMonth = list.every((r) => monthKey(r.occurredAt) === m0)
  return sameMonth ? 'd' : 'md'
})

/** 有這個標籤嗎（供 `rows` 過濾用） */
function hasTag(r: TxRecord, v: string): boolean {
  if (v === 'img') return (r.images?.length ?? 0) > 0
  if (v === 'trip') return !!r.tripId
  if (v === 'todo') return (r.todos?.length ?? 0) > 0
  // 0.1.64：「未計入統計」——明細裡單獨標記的，或所屬分類（含上層）被標記的
  if (v === 'excl') return records.isExcluded(r)
  return true
}

/* ── 旅行過濾（0.1.38）：從「過去的旅行」詳情頁點「旅行期間記錄 N 筆」跳過來 ──
 * URL 長這樣：`#/records?trip=<id>`。
 * ⚠ 用 **tripId 精確比對**（`r.tripId === tripFilter`），不是文字搜索——
 *   使用者特別交代「不要搜到不相關的記錄，例如請考慮旅行名字同名之類」；
 *   帶 id 過濾之後，同名旅行、備注裡剛好提到旅行名的記錄都不會誤中。
 * ⚠ 過濾生效時**不看日期區間**——詳情頁要的是「這趟的全部 N 筆」
 *   （區間預設是今天，不繞過的話只會看到今天那幾筆）。
 *   收支篩選與關鍵字照舊作用（跳轉進來時都是預設值＝不影響）。
 * 頂部會出現一顆琥珀 chip（見模板），按 ✕ 解除過濾。 */
const tripFilter = computed(() => {
  const v = route.query.trip
  return typeof v === 'string' && v ? v : ''
})

/**
 * 0.1.41：實際生效的旅行過濾＝URL（0.1.38，一次性跳轉）**優先**，
 * 其次是「查看旅行記錄」的持久模式（settings.tripViewFilter——TravelSheet 開啟後
 * 切頁也保持，直到關閉或結束旅行）。
 * ⚠ 兩者都是 tripId 精確比對、都不看日期區間。
 */
const viewFilter = computed(() => tripFilter.value || settings.tripViewFilter || '')
const tripFilterName = computed(() => settings.tripById(viewFilter.value)?.name ?? '旅行')

/** 解除旅行過濾：把 query 拿掉＋關掉持久模式（一顆 ✕ 同時清兩種來源） */
function clearTripFilter() {
  router.push({ path: '/records' })
  settings.setTripViewFilter(null)
}

/** 這個範圍／排序要用哪個時間戳；整頁（含列表分組）都靠它，才不會互相打架 */
function timeOf(r: TxRecord): string {
  return recent.value ? r.createdAt : r.occurredAt
}

/** 關鍵字搜尋：比對「備註」「分類名稱」與「旅行名稱」（0.1.36 加旅行名） */
const q = ref('')
/** trim + 轉小寫後的關鍵字（空字串代表沒在搜尋） */
const kw = computed(() => q.value.trim().toLowerCase())
/**
 * 0.1.51（使用者原話）：「搜索框支持用戶輸入空白鍵，可以同時搜索更多的條件，
 * 需同時符合才會出結果。例：搜『餐飲 123』→ 只出分類餐飲且備註含 123 的那筆；
 * 搜『餐飲』→ 兩筆都出」
 * → 以空白把關鍵字切成多個詞，**每一個詞都要在（備註／分類／旅行名）任一欄命中**（AND）。
 *   單一詞時行為跟以前完全一樣；連續空白／前後空白都會被濾掉。
 */
const terms = computed(() => kw.value.split(/\s+/).filter(Boolean))

/**
 * 0.1.44：記錄明細摘要區塊（餐飲 支出 MOP$1.00 那塊）點下去 →
 * 關掉明細，用這筆的分類名稱直接搜尋（本頁就有搜索框，不必跳頁）。
 */
function searchCat(name: string) {
  editingId.value = null
  q.value = name
}

/** 記錄所屬分類的顯示名稱（未分類也要能被搜尋到，所以用同一個 fallback） */
/** 子分類顯示成「餐飲 › 早餐」，搜尋時打大類或子類都找得到 */
function catNameOf(categoryId: string) {
  return settings.category(categoryId) ? settings.fullNameOf(categoryId) : '未分類'
}

/**
 * 記錄所屬旅行的名稱（0.1.36）。
 * 標記結束後保留，所以歷史旅行也搜得到；沒有標記回空字串（不參與比對）。
 */
function tripNameOf(r: TxRecord): string {
  return r.tripId ? (settings.tripById(r.tripId)?.name ?? '') : ''
}

watch(unit, (u) => {
  key.value = todayUnit(u)
})

/**
 * 0.1.81（需求 2）：搜索框的「**精準搜索**」開關。
 *
 * 使用者原話：「在記錄要的搜索框中，增加精準搜索的按鈕，例如數據1-->A , 2-->AA,
 *   3--> AB — 用戶搜索"A" 那就只顯示，只出現1-->A, 不要2-->AA , 3-->AB，
 *   當沒有按下這個按鈕時，一切都和之前的一樣。」
 *
 * → 按下時每個關鍵字要**完全等於**某一欄（備註／分類名稱／旅行名稱）才留下；
 *   沒按下時照舊 `includes`（部分符合）。多關鍵字一樣是 AND（全部命中）。
 * ⚠ 跟「顯示實際時間」一樣是**顯示偏好** → 持久化到 localStorage，
 *   重新整理後不用再按一次（想關掉再按一下就好）。
 */
const EXACT_KEY = 'mop-ledger.ui.exactSearch.v1'
const exactSearch = ref(loadExact())
function loadExact(): boolean {
  try {
    return localStorage.getItem(EXACT_KEY) === '1'
  } catch {
    return false
  }
}
function toggleExact() {
  exactSearch.value = !exactSearch.value
  try {
    localStorage.setItem(EXACT_KEY, exactSearch.value ? '1' : '0')
  } catch {
    /* 隱私模式等 → 記不住就記不住，不影響使用 */
  }
}

/**
 * 0.1.44：從記錄明細的摘要區塊（或統計頁）跳過來搜尋某個分類。
 * 用 `?q=` 帶分類名稱進來；同頁內再點一次也能觸發（query 變化就同步）。
 */
watch(
  () => route.query.q,
  (v) => {
    // ⚠ 不碰 editingId：immediate 會在 setup 早期（editingId 初始化前）就跑
    if (typeof v === 'string' && v) q.value = v
  },
  { immediate: true }, // 從統計頁跳過來時 query 在掛載前就帶好了，必須 immediate 才接得到
)

/**
 * 0.1.64：從統計頁「未計入統計」總結卡點過來 → URL 帶 `?excl=1`，
 * 自動勾上「更多」裡的「排」（未計入統計）。
 * 使用者原話：「用戶點擊黎，跳至記錄的頁面，只顯示未計入統計」。
 *
 * 同時接住 `from`／`to`（統計頁當下的區間）：卡片上的「N 筆」是照那個區間算的，
 * 不帶的話記錄頁預設只有「今天」，使用者會看到比 N 少的記錄。
 * → 把區間設成自訂範圍（日期如實在範圍列上顯示，不是偷偷繞過）。
 *
 * ⚠ 只做「勾上這一格＋套用帶過來的區間」：收支、關鍵字等一律不碰——跳過來時
 *   這個頁面剛掛載，其他條件本來就是預設值，額外重置反而會蓋掉使用者手動組的網址
 *   （例：自己打 `?excl=1&q=餐飲` 想兩個都要）。
 * ⚠ 使用者之後可以在「更多」裡手動取消；URL 上的參數留著不會再自動生效
 *   （watch 只在值改變時觸發），重新整理則會重新套上——行為可預期。
 */
watch(
  () => route.query.excl,
  (v) => {
    if (v !== '1') return
    if (!moreTags.value.includes('excl')) moreTags.value = [...moreTags.value, 'excl']
    const f = route.query.from
    const t = route.query.to
    if (typeof f === 'string' && typeof t === 'string' && f && t) {
      start.value = f <= t ? f : t
      end.value = f <= t ? t : f
      mode.value = 'custom'
    }
  },
  { immediate: true },
)

const units: { key: RangeUnit; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
]

/**
 * 依單位算出的區間一律只有「目前選定的那一個單位」：
 * 日 = 使用者選的那一天、月 = 那一個月、年 = 那一年。
 */
const range = computed<DateRange>(() => {
  if (mode.value === 'custom') {
    return start.value <= end.value
      ? { start: start.value, end: end.value }
      : { start: end.value, end: start.value }
  }
  return unitRange(unit.value, key.value)
})

const rangeText = computed(() =>
  range.value.start === range.value.end
    ? range.value.start.replace(/-/g, '/')
    : formatRange(range.value.start, range.value.end),
)

/**
 * ⚠ 0.1.29：「依新增時間」**不再放在這裡**。
 * 使用者原話：「用戶按了最近按鈕，就會見到…日月年按鈕右手邊的依新增時間標籤，
 *   現在要把依新增時間**按鈕**放到檢視分類按鈕和最近按鈕的最右手邊」。
 * 所以它搬到「檢視」那一列的最右邊，而且變成**可以按的按鈕**（見下面 `.bycat--basis`），
 * 這裡只留區間與筆數兩顆標籤。
 */
const rangeTags = computed(() => [rangeText.value, `${rows.value.length} 筆`])

const rows = computed(() =>
  records.records
    .filter((r) => {
      // 旅行過濾（0.1.38）：tripId 精確比對、日期區間不參與（見 tripFilter 的註解）
      if (viewFilter.value) {
        if (r.tripId !== viewFilter.value) return false
      } else {
        const k = dayKey(timeOf(r))
        if (k < range.value.start || k > range.value.end) return false
      }
      if (typeFilter.value !== 'all' && r.type !== typeFilter.value) return false
      // 0.1.61：待辦篩選（在日期／收支／關鍵字之上再疊一層）
      if (todoFilter.value !== 'off') {
        const ts = r.todos ?? []
        if (todoFilter.value === 'has' && ts.length === 0) return false
        if (todoFilter.value === 'done' && !(ts.length > 0 && ts.every((t) => t.done))) return false
        if (todoFilter.value === 'pending' && !ts.some((t) => !t.done)) return false
      }
      // 0.1.62：「更多」標籤篩選（AND——勾幾個就要同時有幾個標籤）
      if (moreTags.value.length && !moreTags.value.every((v) => hasTag(r, v))) return false
      if (!terms.value.length) return true
      // 0.1.51：每一欄各自轉小寫的「可搜尋字串」，多詞之間是 AND（全部命中才留）
      const hay = [r.note ?? '', catNameOf(r.categoryId), tripNameOf(r)].map((x) => x.toLowerCase())
      // 0.1.81（需求 2）：精準搜索開著時要比「完全等於」，關掉時照舊 includes
      return terms.value.every((t) =>
        hay.some((h) => (exactSearch.value ? h === t : h.includes(t))),
      )
    })
    .sort((a, b) => (timeOf(a) < timeOf(b) ? 1 : -1)),
)

/** 有在搜尋時，空列表的文案要帶出關鍵字，否則看不出是「找不到」還是「這個範圍本來就沒有」 */
const emptyText = computed(() => {
  if (kw.value) {
    // 0.1.51：多個詞時順便說明「要同時符合」——搜索框 placeholder 放不下這個說明
    return terms.value.length > 1
      ? `找不到同時符合「${q.value.trim()}」的記錄（多個條件要全部命中）`
      : `找不到符合「${q.value.trim()}」的記錄`
  }
  if (viewFilter.value) return '這趟旅行沒有記錄'
  // 0.1.64：只勾了「排」時的專屬文案（「沒有同時有這些標籤」對它不通）
  if (moreTags.value.length === 1 && moreTags.value[0] === 'excl') return '這個範圍沒有未計入統計的記錄'
  if (moreTags.value.length) return '沒有同時有這些標籤的記錄'
  if (todoFilter.value === 'pending') return '沒有未完成的待辦記錄'
  if (todoFilter.value === 'done') return '沒有待辦全完成的記錄'
  if (todoFilter.value === 'has') return '沒有帶待辦的記錄'
  return recent.value ? '這段時間沒有新增的記錄' : '這個範圍沒有記錄'
})

/* ── 檢視方式：逐筆 / 依分類 ────────────────────────────── */
const byCat = ref(false)
/** 切成分類檢視後，把日期分組收掉，避免兩種分組互相打架 */
const byCatOpen = ref<Set<string>>(new Set())

/** 某個分類底下掛著的金額（用來做子分類小計） */
interface SubTotal {
  id: string
  name: string
  exp: number
  inc: number
}

interface CatGroup {
  /** 大類（根分類）的 id */
  id: string
  name: string
  color: string
  icon: string
  exp: number
  inc: number
  list: TxRecord[]
  /** 子分類小計；大類自己身上的金額以「未細分」放在最後 */
  subs: SubTotal[]
  /**
   * 0.1.77：組內每一筆的「與上一筆記錄的時間差」標籤文字。
   * ⚠ 依分類檢視時各組是分開的視覺區塊 → 只能在**組內**算相鄰的差。
   * ⚠ 以「完整組內順序」計算（不是只算畫面上露出來的前幾筆），
   *   這樣收合／展開時數字不會跳動。
   */
  gap: Map<string, string>
}

/**
 * 依「大類」分組：子分類的記錄一律歸到它最上層的大類去，
 * 所以「交通」與「交通 › 巴士」會在同一組，不會被拆開。
 *
 * 旅行模式（0.1.35）：有 `tripId` 標記的記錄**整筆**歸到「旅行名」這一組（不看原分類），
 * 組名＝旅行名（例：日本旅行），組內的子分類小計仍是真分類 ——
 * 畫面上就是「日本旅行 → 餐飲／交通…」的效果（使用者拍板：旅行標記方案）。
 * 0.1.36：標記結束後保留，所以結束過的旅行照樣有自己的組（名稱用 tripById 查）。
 */
/**
 * 0.1.77：算一串記錄「每筆與下一筆（較舊那筆）」的時間差標籤。
 *
 * ⚠ 順序必須跟畫面上看到的一致（`sorted` 是由新到舊），
 *   所以第 i 筆是跟第 i+1 筆比；最後一筆沒有下一筆 → `-- --`。
 */
function gapMapOf(sorted: TxRecord[]): Map<string, string> {
  const m = new Map<string, string>()
  if (!showGapTime.value) return m
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    const next = sorted[i + 1]
    m.set(cur.id, formatGap(timeOf(cur), next ? timeOf(next) : null))
  }
  return m
}

const catGroups = computed<CatGroup[]>(() => {
  const m = new Map<string, TxRecord[]>()
  for (const r of rows.value) {
    // 沒有上層就是自己；資料異常查不到時退回自己的 id，至少不會消失
    const root = r.tripId
      ? `trip:${r.tripId}`
      : (settings.pathOf(r.categoryId)[0]?.id ?? r.categoryId)
    const list = m.get(root)
    if (list) list.push(r)
    else m.set(root, [r])
  }

  return [...m.entries()]
    .map(([rootId, list]) => {
      // 旅行組：分類表裡查不到是正常的（它不是分類），名稱／顏色／icon 用旅行主題
      const isTrip = rootId.startsWith('trip:')
      const c = isTrip ? undefined : settings.category(rootId)
      const sorted = [...list].sort((a, b) => (timeOf(a) < timeOf(b) ? 1 : -1))

      // 先把每一筆按它自己的分類累加，才知道各子分類佔多少
      const per = new Map<string, { exp: number; inc: number }>()
      for (const r of sorted) {
        const cur = per.get(r.categoryId) ?? { exp: 0, inc: 0 }
        // 0.1.53：用記錄自己凍結的匯率（已記錄數據的匯率固定）
        const v = settings.displayOf(r)
        if (r.type === 'expense') cur.exp += v
        else cur.inc += v
        per.set(r.categoryId, cur)
      }
      const sumOf = (pick: (v: { exp: number; inc: number }) => number) =>
        [...per.values()].reduce((s, v) => s + pick(v), 0)

      const subs: SubTotal[] = [...per.entries()]
        .filter(([id]) => id !== rootId)
        .map(([id, v]) => ({ id, name: settings.category(id)?.name ?? '未分類', ...v }))
        .sort((a, b) => b.exp + b.inc - (a.exp + a.inc))

      // 直接記在大類上的金額：有子分類時補一列「未細分」放最後，數字才對得起來
      const own = per.get(rootId)
      if (own && subs.length) subs.push({ id: rootId + '__own', name: '未細分', ...own })

      return {
        id: rootId,
        // 旅行組（0.1.36）：結束過的旅行照樣有組——名稱用 tripById 查（先進行中、後歷史）
        name: isTrip
          ? (settings.tripById(rootId.slice('trip:'.length))?.name ?? '旅行')
          : (c?.name ?? '未分類'),
        color: isTrip ? '#d9a326' : (c?.color ?? '#8a857c'),
        icon: isTrip
          ? 'luggage'
          : c
            ? iconForCategory(c)
            : iconForCategory({ id: '', name: '' }),
        exp: sumOf((v) => v.exp),
        inc: sumOf((v) => v.inc),
        list: sorted,
        subs,
        // 0.1.77：組內相鄰兩筆的時間差（依分類檢視時各組是分開的視覺區塊）
        gap: gapMapOf(sorted),
      }
    })
    .sort((a, b) => b.exp + b.inc - (a.exp + a.inc))
})

/** 每組預設只露前 3 筆，想看全部再展開（同一個分類可能幾十筆） */
const CAT_PREVIEW = 3
function catOpen(id: string): boolean {
  return byCatOpen.value.has(id)
}
function toggleCatGroup(id: string) {
  if (byCatOpen.value.has(id)) byCatOpen.value.delete(id)
  else byCatOpen.value.add(id)
}
function visibleCat(row: CatGroup): TxRecord[] {
  return catOpen(row.id) ? row.list : row.list.slice(0, CAT_PREVIEW)
}

// 換範圍／篩選／關鍵字／時間基準／旅行過濾時把展開狀態清掉，免得殘留不相關的分類
// 0.1.53：同時回到第 1 頁（不然可能停在一筆都沒有的頁碼上）
watch([range, typeFilter, kw, recent, viewFilter, todoFilter, moreTags], () => {
  byCatOpen.value.clear()
  page.value = 1
})

/* ── 0.1.53：逐筆檢視的分頁（0.1.54：PWA 改成「滑到底無縫載入」）──────────────
 * 使用者原話（0.1.53）：「在記錄的頁面中，PWA 時，每X 筆下拉才接著刷新記錄，
 * 在電腦版中加入，上一頁下一頁第一頁 最後一頁 用戶選擇顯示多少頁的下拉清單」。
 * 使用者原話（0.1.54）：「PWA 時，每 10 筆（用戶可設置）下拉才接著刷新記錄，
 * **不是按鈕**，要無縫刷新，即原數據 1,2,3 ... 10，下拉後 1,2,3 ... 10 ... 20，
 * 如果太多內容也要回收上方的記錄（用戶看不到的畫面），當用戶往回滑的時候，
 * 又再刷新顯示，要做到 Facebook 那種往上往下滑貼文的效果」。
 *
 * 拍板的設計：
 * - **電腦版（≥520px）**：維持 0.1.53 的分頁列（20/50/100/全部，預設 50）
 *   ＋第一頁／上一頁／第 X / Y 頁／下一頁／最後一頁。
 * - **PWA（≤519px）**：沒有任何按鈕。
 *   ① 一次載入 `pageSize`（**預設 10 筆**，就是使用者講的「每 10 筆」）；
 *   ② 列表最下面有一顆看不見的哨兵，滑到它就**自動**再加一批（無縫，
 *      1…10 → 1…20，舊的都還在上面，不是換頁）；
 *   ③ 畫面外的記錄由 `RecordList` 的視窗化回收（見 RecordList 的 `virtual`）。
 * - 「每 X 筆」的下拉清單兩邊都保留（使用者兩邊都要求「用戶可設置」）。
 */
const PAGE_SIZES = [20, 50, 100, 0]
const FEED_SIZES = [10, 20, 50, 0]
/**
 * 哨兵的「提前載入」距離（px）：哨兵還在視窗下方這麼多像素時就开始載下一批，
 * 滑到底時下一批通常已經備好了，才會有「無縫」的感覺。
 *
 * ⚠⚠ 0.1.54.1 修的 bug 就在這個數字身上：
 *   原本 IntersectionObserver 的 rootMargin 寫 400px，但 `pump()` 的停止條件卻寫
 *   `top > window.innerHeight`（**沒有**加這個提前量）→ 兩個判定不一致，
 *   中間出現一段「IO 說相交、pump 卻直接 return」的死區：
 *     慢慢往下滑，哨兵進到「視窗下方 0~400px」時 IO 回呼 → pump 什麼都不載就結束；
 *     而 IntersectionObserver **只在相交狀態改變時回呼**，
 *     之後哨兵一直停在視窗裡、狀態再也沒變 → **永遠不會再載** →
 *     使用者看到的就是「轉圈一直轉、卻沒有 11~20」。
 *   （之前的測試是用「一次跳到最底」觸發，剛好跳過這段死區，所以沒抓到。）
 *   所以這兩個地方**必須共用同一個常數**，之後要調也只改這裡。
 */
const FEED_SLACK = 200

/** 窄螢幕（PWA）：跟 CSS 的 `@media (max-width: 519px)` 同一個斷點 */
const NARROW_Q = '(max-width: 519px)'
const narrow = ref(false)
let mq: MediaQueryList | null = null
function onNarrow(e: MediaQueryListEvent | MediaQueryList) {
  narrow.value = e.matches
}
onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  mq = window.matchMedia(NARROW_Q)
  onNarrow(mq)
  mq.addEventListener('change', onNarrow)
  // 餵食模式的滑動備援（只有 PWA 會真的做事，`pump()` 自己會判斷是否餵食模式）
  window.addEventListener('scroll', onFeedScroll, { passive: true })
  void pump()
})
onBeforeUnmount(() => {
  mq?.removeEventListener('change', onNarrow)
  mq = null
  window.removeEventListener('scroll', onFeedScroll)
  if (feedScrollRaf) cancelAnimationFrame(feedScrollRaf)
  feedScrollRaf = 0
  feedIo?.disconnect()
  feedIo = null
})

/** 電腦版與 PWA 各自記一份每頁筆數（切換時才不會把對方的設定蓋掉） */
const pageSizeDesk = ref(50)
const pageSizeFeed = ref(FEED_SIZES[0])
const pageSize = computed({
  get: () => (narrow.value ? pageSizeFeed.value : pageSizeDesk.value),
  set: (v: number) => {
    if (narrow.value) pageSizeFeed.value = v
    else pageSizeDesk.value = v
  },
})
const sizeOptions = computed(() => (narrow.value ? FEED_SIZES : PAGE_SIZES))
/** PWA 的「餵食模式」：無限載入 ＋ 視窗化（沒有頁碼、沒有按鈕） */
const feedMode = computed(() => narrow.value)

const page = ref(1)

/** 分頁列要不要出現：逐筆檢視＋真的超過一頁的量 */
const showPager = computed(
  () => !byCat.value && rows.value.length > (narrow.value ? FEED_SIZES[0] : PAGE_SIZES[0]),
)

const pageCount = computed(() => {
  if (pageSize.value === 0) return 1
  return Math.max(1, Math.ceil(rows.value.length / pageSize.value))
})

/** 頁數縮減時（換篩選後記錄變少）把頁碼夾回來，避免停在一筆都沒有的頁 */
watch(pageCount, (n) => {
  if (page.value > n) page.value = n
})

/** 目前這一頁要顯示的記錄（全部＝不分） */
const pagedRows = computed(() => {
  if (pageSize.value === 0) return rows.value
  const start = (page.value - 1) * pageSize.value
  return rows.value.slice(start, start + pageSize.value)
})

function gotoPage(n: number) {
  page.value = Math.min(Math.max(1, n), pageCount.value)
}

/* ── 0.1.54：PWA 的「無限載入」（滑到底自動加一批，沒有按鈕）────────────── */
/** 目前已載入幾筆（只餵食模式用；電腦版走 `page`） */
const feedCount = ref(FEED_SIZES[0])
/** 這次要餵給 RecordList 的資料；「全部」＝不分批 */
const feedRows = computed(() => {
  if (pageSize.value === 0) return rows.value
  return rows.value.slice(0, feedCount.value)
})
/** 全部都載完了（→ 不再顯示哨兵，改顯示「已顯示全部 N 筆」） */
const feedDone = computed(() => feedRows.value.length >= rows.value.length)
/** 逐筆檢視實際要渲染的資料：PWA 走餵食、電腦版走分頁 */
const listRows = computed(() => (feedMode.value ? feedRows.value : pagedRows.value))

const sentinelEl = ref<HTMLElement | null>(null)
let feedIo: IntersectionObserver | null = null
/** 哨兵要掛不掛會一直變（載完就收掉），所以用 watch 跟著它走 */
watch(sentinelEl, (el) => {
  feedIo?.disconnect()
  feedIo = null
  if (!el || typeof IntersectionObserver === 'undefined') return
  feedIo = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void pump()
    },
    // ⚠ rootMargin 必須跟 `pump()` 裡的停止條件用同一個 `FEED_SLACK`（見該常數的註解）
    { rootMargin: `${FEED_SLACK}px 0px` },
  )
  feedIo.observe(el)
})

/** 加一批（每次 `pageSize` 筆；「全部」時不會走到這裡） */
function loadMore() {
  if (!feedMode.value) return
  const step = pageSize.value || FEED_SIZES[0]
  if (feedCount.value >= rows.value.length) return
  feedCount.value = Math.min(rows.value.length, feedCount.value + step)
}

/**
 * 一直補到「哨兵被推出（視窗 + FEED_SLACK）」或「全部載完」為止。
 *
 * ⚠ 為什麼需要這個迴圈：IntersectionObserver 只在**相交狀態改變**時回呼。
 *   第一批 10 筆可能連一屏都填不滿（哨兵還在畫面裡），那時狀態沒有「改變」→
 *   不會再叫一次 → 使用者就卡在 10 筆。這裡主動補到填滿為止。
 *   `guard` 是保險絲（正常情況 1~3 次就停）。
 *
 * ⚠⚠ 停止條件一定要用 `innerHeight + FEED_SLACK`，不能只寫 `innerHeight`：
 *   只寫 `innerHeight` 會跟 IO 的 rootMargin 不一致，產生「叫了卻不載」的死區
 *   （0.1.54.1 修的就是這個，詳細說明見 `FEED_SLACK` 的註解）。
 */
let pumping = false
async function pump() {
  // 保險鎖：scroll 備援與 IO 可能同時叫進來，避免同一次重複加好幾批
  if (pumping) return
  pumping = true
  try {
    await nextTick()
    for (let guard = 0; guard < 60; guard += 1) {
      if (!feedMode.value) return
      const el = sentinelEl.value
      if (!el) return
      if (el.getBoundingClientRect().top > window.innerHeight + FEED_SLACK) return
      const before = feedCount.value
      loadMore()
      if (feedCount.value === before) return
      await nextTick()
    }
  } finally {
    pumping = false
  }
}

/**
 * 備援：真機（尤其 PWA／iOS）有時 IntersectionObserver 的時機就是不穩，
 * 這裡在滑動時照樣用同一套判定再檢查一次（rAF 節流，成本極低）。
 * `pump()` 自己會判斷位置、不在範圍就直接結束，所以不會多載。
 */
let feedScrollRaf = 0
function onFeedScroll() {
  if (!feedMode.value || feedScrollRaf) return
  feedScrollRaf = requestAnimationFrame(() => {
    feedScrollRaf = 0
    void pump()
  })
}

// 換篩選／搜尋／範圍後從頭開始（不然會停在上一次已經載了很多筆的狀態）
watch([range, typeFilter, kw, recent, viewFilter, todoFilter, moreTags], () => {
  feedCount.value = pageSize.value || FEED_SIZES[0]
  void pump()
})
// 改「每 X 筆」：已載入的筆數直接對齊新的設定（選「全部」時 feedRows 本來就全部）
watch(pageSize, (n) => {
  feedCount.value = n || FEED_SIZES[0]
})

// 0.1.53：用記錄自己凍結的匯率換算成顯示幣別（即時換算是 0.1.28 的舊行為）
const expense = computed(() =>
  rows.value.filter((r) => r.type === 'expense').reduce((s, r) => s + settings.displayOf(r), 0),
)
const income = computed(() =>
  rows.value.filter((r) => r.type === 'income').reduce((s, r) => s + settings.displayOf(r), 0),
)
const net = computed(() => income.value - expense.value)

/**
 * 0.1.57：區間總覽的數字＝**幣別符號 + K/M 縮寫**。
 * ⚠ 為什麼這邊要帶符號、統計頁（0.1.54）不用：記錄頁這三格本來就是 `fmtMoney`
 *   （`JP¥4,000.00` 這種帶幣別的完整數字），直接換成純數字會把幣別資訊弄丟 ——
 *   旅行貨幣、換過主幣別時特別容易誤讀。統計頁那三張卡當初就是拍板成純數字，
 *   那邊維持原樣不動。
 * 0.1.75：數量模式沒有任何幣別 → 只顯示純數字。
 */
const sumSym = computed(() => currency(settings.displayCurrency).symbol)
const sumText = (v: number) => `${settings.quantityMode ? '' : sumSym.value}${fmtCompact(v)}`

function shiftUnit(delta: number) {
  if (unit.value === 'day') key.value = addDays(key.value, delta)
  else if (unit.value === 'month') key.value = shiftMonthKey(key.value, delta)
  else key.value = String(Number(key.value) + delta)
}

function shiftMonthKey(k: string, delta: number): string {
  const [y, m] = k.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function goToday() {
  key.value = todayUnit(unit.value)
  mode.value = 'unit'
}

/* ── 自訂範圍快捷 ───────────────────────────────────────── */
function applyCustom(s: string, e: string) {
  start.value = s
  end.value = e
  mode.value = 'custom'
}
const today = computed(() => todayKey())
const y = computed(() => today.value.slice(0, 4))

const presets = computed(() => [
  { label: '近 7 天', run: () => applyCustom(addDays(today.value, -6), today.value) },
  { label: '近 30 天', run: () => applyCustom(addDays(today.value, -29), today.value) },
  {
    label: '本月',
    run: () => {
      const r = monthRange(monthKey(new Date().toISOString()))
      applyCustom(r.start, r.end)
    },
  },
  { label: '今年', run: () => applyCustom(`${y.value}-01-01`, `${y.value}-12-31`) },
  {
    label: '全部',
    run: () => {
      const first = records.records.reduce<string | null>((min, r) => {
        const k = dayKey(r.occurredAt)
        return !min || k < min ? k : min
      }, null)
      applyCustom(first ?? `${y.value}-01-01`, today.value)
    },
  },
])

/* ── 單筆明細 ───────────────────────────────────────────── */
const editingId = ref<string | null>(null)
const editing = computed(() => records.records.find((r) => r.id === editingId.value) ?? null)
/**
 * 0.1.57：放大檢視裡「上一筆／下一筆記錄」的順序。
 * 用 `rows`（**已套用日期／收支／搜索的完整結果**）而不是「目前已載入的那幾筆」——
 * 使用者原話是「目前用戶搜索的上一筆記錄和下一筆記錄」，搜索出來的整份才是他要的範圍；
 * 餵食模式只是延後載入，不該改變導覽範圍（跳過去時明細一樣開得起來）。
 */
const navIds = computed(() => rows.value.map((r) => r.id))

function saveEdit(patch: Partial<TxRecord>) {
  if (editingId.value) records.update(editingId.value, patch)
  editingId.value = null
  notify('已更新', 'ok')
}

function removeEditing(id: string) {
  const r = records.records.find((x) => x.id === id)
  records.remove(id)
  editingId.value = null
  notify('已刪除', 'info', {
    label: '復原',
    run: () => {
      if (r) records.restore(r)
    },
  })
}
</script>

<template>
  <div class="page records">
    <div class="page-head">
      <!-- 標題與副標包成一塊垂直排列，搜尋框才推得到最右邊（副標才不會卡在中間） -->
      <div class="page-head__txt">
        <h1 class="page-title">記錄</h1>
        <p class="page-sub">收支帳目一覽</p>
      </div>

      <!-- 關鍵字搜尋：比對備註／分類名稱／旅行名稱（0.1.51 起空白＝多條件，需同時符合）
           ⚠ placeholder 刻意保持短字串：v95 有「placeholder 必須塞得進可用寬度」的斷言
             （塞不下會被裁掉），多條件的說明放在「找不到」的空狀態文案裡。 -->
      <div class="search">
        <svg class="search__ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.8" cy="10.8" r="6.4" />
          <path d="M15.6 15.6 20 20" />
        </svg>
        <ClearableInput v-model="q" placeholder="搜尋備註或旅行" :maxlength="40">
          <template #trailing>
            <!-- 0.1.44：分類選擇器，點分類把名稱填進搜索框 -->
            <CategorySearchPicker v-model="q" />
            <!--
              0.1.81（需求 2）：精準搜索——按下後關鍵字要**完全符合**才顯示
              （搜 A 不會出現 AA／AB）；再按一次回到原本的部分符合。
            -->
            <button
              v-if="q.trim()"
              class="exbtn"
              type="button"
              :class="{ 'is-on': exactSearch }"
              :aria-pressed="exactSearch"
              :title="
                exactSearch
                  ? '精準搜索：完全符合才顯示（再按一次取消）'
                  : '精準搜索：只顯示完全符合關鍵字的記錄'
              "
              aria-label="精準搜索"
              @click="toggleExact"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="7.1" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
            </button>
          </template>
        </ClearableInput>
      </div>
    </div>

    <!--
      0.1.38：旅行過濾生效時的提示 chip（琥珀主題，跟「旅」標籤同一族）。
      從「過去的旅行」詳情頁跳過來時，下面這顆 chip 說明「現在顯示的是這趟的
      全部記錄（不限日期）」，按 ✕ 解除、回到一般的區間查詢。
    -->
    <div v-if="viewFilter" class="tripfilter">
      <span class="tripfilter__chip">
        <svg class="tripfilter__ic" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.4" y="7.4" width="17.2" height="12.2" rx="2.6" />
          <path d="M9 7.4V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.6" />
          <path d="M3.4 12.4h17.2" />
        </svg>
        <span class="tripfilter__t">旅行：</span>
        <span class="tripfilter__name">{{ tripFilterName }}</span>
        <button
          class="tripfilter__x"
          type="button"
          title="取消旅行過濾"
          aria-label="取消旅行過濾"
          @click="clearTripFilter"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
        </button>
      </span>
      <span class="tripfilter__hint tiny muted">這趟的全部記錄（不限日期）</span>
    </div>

    <!--
      區間總覽。
      0.1.57（使用者原話）：「支出，收入，結餘，如果是超出框框，即平時超出時用... 的，
      用 K(千) → 1000 → 1K，M(百萬) → 1,000,000 → 1M 等等顯示」。
      → 卡片上的數字走 `fmtCompact`（跟統計頁 0.1.54 同一套：不到 1000 完全維持原樣，
        1000 起才是 1.23K／1.2M），`title` 保留 `fmtMoney` 的完整數字。
      ⚠ 為什麼不「量測到真的超出才壓」：卡片寬度隨裝置、字級、幣別長度變，
        量測要綁 ResizeObserver 且每次數字變動都要重新量，容易在換頁那一瞬間閃一下；
        而會「超出到被截成 …」的數字本來就是四位數以上（框框寬度固定），
        壓成 K/M 剛好落在同一批情境，行為也跟統計頁一致。
      ⚠ 註解內一律用「→」：寫成兩個減號會讓 HTML 註解提前結束（0.1.54 踩過）。
    -->
    <div class="card sum">
      <div class="sum__grid">
        <!--
          0.1.76：數量模式也有收支 → 三格（支出／收入／結餘）恢復，
          數字走 `sumText`（數量模式不帶貨幣符號）。
        -->
        <div class="sum__col">
          <span class="sum__label"><i class="sum__dot sum__dot--exp"></i>支出</span>
          <span
            class="sum__val num is-exp"
            :title="fmtMoney(expense, settings.quantityMode ? '' : settings.displayCurrency)"
          >
            {{ sumText(expense) }}
          </span>
        </div>
        <div class="sum__col">
          <span class="sum__label"><i class="sum__dot sum__dot--inc"></i>收入</span>
          <span
            class="sum__val num is-inc"
            :title="fmtMoney(income, settings.quantityMode ? '' : settings.displayCurrency)"
          >
            {{ sumText(income) }}
          </span>
        </div>
        <div class="sum__col">
          <span class="sum__label">結餘</span>
          <span
            class="sum__val num"
            :class="net >= 0 ? 'is-inc' : 'is-exp'"
            :title="fmtMoney(net, settings.quantityMode ? '' : settings.displayCurrency)"
          >
            {{ sumText(net) }}
          </span>
        </div>
      </div>
    </div>

    <div class="card rangebar">
      <!-- 兩列：上面「檢視」（分類／最近），下面「篩選」（收支切換在左、範圍切換推到最右） -->
      <div class="rangebar__top">
        <div class="grp">
          <span class="grp__label">檢視</span>
          <!-- .grp 是直向排列，所以按鈕要自己包一列才排得成橫的 -->
          <div class="grp__row grp__row--view">
            <!-- 依分類檢視的切換鈕 -->
            <button
              type="button"
              class="bycat"
              :class="{ 'is-on': byCat }"
              :aria-pressed="byCat"
              :title="byCat ? '改為逐筆列出' : '改為依分類分組'"
              @click="byCat = !byCat"
            >
              <svg class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
                <path d="m3 12.4 9 4.5 9-4.5" />
                <path d="m3 16.9 9 4.5 9-4.5" />
              </svg>
              分類
            </button>
            <!-- 時間基準：切到「最近」＝用新增時間查詢（補登舊帳時用交易時間找不到） -->
            <button
              type="button"
              class="bycat"
              :class="{ 'is-on': recent }"
              :aria-pressed="recent"
              :title="recent ? '改回依交易時間查詢' : '改為依新增時間查詢（不是交易時間）'"
              @click="recent = !recent"
            >
              <svg class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.4" />
                <path d="M12 7.4V12l3.1 1.9" />
              </svg>
              最近
            </button>
            <!--
              0.1.61：待辦篩選按鈕（在「依新增時間」左手邊）。每按一下循環換檔：
              不限制 → 待辦(全部) → 待辦(完成) → 待辦(未完成) → 不限制…
              它只疊一層「有沒有待辦／完成度」的過濾，不改動日期／收支／關鍵字。
            -->
            <button
              type="button"
              class="bycat"
              :class="{ 'is-on': todoFilter !== 'off' }"
              :title="todoTitle"
              @click="cycleTodo"
            >
              <!-- 不限制：項目符號列表（顯示全部） -->
              <svg v-if="todoFilter === 'off'" class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6.5h11M9 12h11M9 17.5h11" />
                <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
              </svg>
              <!-- 有待辦（全部）：勾選清單 -->
              <svg v-else-if="todoFilter === 'has'" class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6.4l1.4 1.4L8 5.2" />
                <path d="M4 12l1.4 1.4L8 10.8" />
                <path d="M4 17.6l1.4 1.4L8 16.4" />
                <path d="M11 6.5h9M11 12h9M11 17.5h9" />
              </svg>
              <!-- 待辦全部完成：打勾方框 -->
              <svg v-else-if="todoFilter === 'done'" class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
                <path d="M8.4 12.2l2.5 2.5 4.7-4.9" />
              </svg>
              <!-- 有待辦未完成：空方框 -->
              <svg v-else class="bycat__ic" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" />
              </svg>
              {{ todoBtnLabel }}
            </button>
            <!--
              0.1.29：「依新增時間」從區間列的小標籤（.rangetag）搬來這裡，
              而且改成**按鈕**（使用者：「把依新增時間按鈕放到分類按鈕和最近按鈕的最右手邊」）。
              ⚠ 0.1.62：這一顆改成**「更多」多選下拉**（圖片／旅行／待辦事項）。
              原本它跟「最近」控制的是同一個東西（`recent`），所以換掉不會損失功能——
              要切「依新增時間／依交易時間」就按左手邊的「最近」那一顆。
              （使用者原話：「不要影響依實時的功能，這部份的功能由用戶可按"最近"的按鈕取代」）
              按鈕上的字＝已勾選項的首字以「+」連接（圖+旅），沒勾就是「更多」。
            -->
            <MoreFilterMenu
              v-model="moreTags"
              :options="moreOptions"
              :extra-on="extraOn"
              @update:extra-on="setExtraOn"
              :extras="moreExtras"
              :label="moreLabel"
              :active="moreActive || showAbsTime"
              :title="moreTitle"
              aria-label="更多篩選"
            />
          </div>
        </div>

        <div class="grp">
          <span class="grp__label">篩選</span>
          <div class="grp__row grp__row--split">
            <!-- 0.1.76：數量模式也有收支 → 「全部／支出／收入」兩種模式都渲染 -->
            <div class="seg2">
              <button :class="{ 'is-on': typeFilter === 'all' }" @click="typeFilter = 'all'">全部</button>
              <button
                :class="{ 'is-on': typeFilter === 'expense' }"
                class="seg2--exp"
                @click="typeFilter = 'expense'"
              >
                支出
              </button>
              <button
                :class="{ 'is-on': typeFilter === 'income' }"
                class="seg2--inc"
                @click="typeFilter = 'income'"
              >
                收入
              </button>
            </div>
            <!-- 範圍切換：跟收支篩選同一列，但推到最右邊 -->
            <div class="seg2 rangebar__mode">
              <button :class="{ 'is-on': mode === 'unit' }" @click="mode = 'unit'">依單位</button>
              <button :class="{ 'is-on': mode === 'custom' }" @click="mode = 'custom'">自訂範圍</button>
            </div>
          </div>
        </div>
      </div>

      <template v-if="mode === 'unit'">
        <div class="ctl">
          <div class="grp">
            <span class="grp__label">週期</span>
            <div class="seg2">
              <button v-for="u in units" :key="u.key" :class="{ 'is-on': unit === u.key }" @click="unit = u.key">
                {{ u.label }}
              </button>
            </div>
          </div>
          <!-- 區間與筆數：擺在日／月／年這一列的最右邊 -->
          <div class="rangeinfo">
            <span v-for="t in rangeTags" :key="t" class="rangetag">{{ t }}</span>
          </div>
        </div>

        <div class="nav">
          <button class="btn btn--ghost btn--sm" @click="shiftUnit(-1)">‹</button>
          <span class="nav__label">{{ unitLabel(unit, key) }}</span>
          <button class="btn btn--ghost btn--sm" @click="shiftUnit(1)">›</button>
          <button class="btn btn--ghost btn--sm nav__today" @click="goToday">
            {{ unit === 'day' ? '今天' : unit === 'month' ? '本月' : '今年' }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="custom__dates">
          <label class="custom__date">
            <span class="grp__label">從</span>
            <DateField v-model="start" />
          </label>
          <label class="custom__date">
            <span class="grp__label">到</span>
            <DateField v-model="end" />
          </label>
          <!-- 自訂範圍沒有「日／月／年」那一列，標籤改放在日期列下方靠右 -->
          <div class="rangeinfo rangeinfo--end">
            <span v-for="t in rangeTags" :key="t" class="rangetag">{{ t }}</span>
          </div>
        </div>
        <div class="presets">
          <button v-for="p in presets" :key="p.label" class="chip" @click="p.run()">
            {{ p.label }}
          </button>
        </div>
      </template>
    </div>

    <!-- 逐筆（依日期分組）；0.1.53：只渲染目前這一頁 -->
    <!-- ⚠ 一定要用 <template v-if> 包住 RecordList＋分頁列：
         早各自的 v-if／v-else 會讓「依分類」的 v-else 改黏到分頁列的 v-if 上，
         ≤20 筆（showPager=false）時兩種檢視會同時渲染（同一筆記錄出現兩次） -->
    <template v-if="!byCat">
      <RecordList
        :records="listRows"
        :virtual="feedMode"
        :show-time="true"
        :empty-text="emptyText"
        :highlight="kw"
        :date-basis="recent ? 'created' : 'occurred'"
        :abs-time="absTimeMode"
        :gap-time="showGapTime"
        @edit="editingId = $event"
        @remove="removeEditing($event)"
      />

      <!--
        0.1.54：PWA 的哨兵 —— 滑到它（提前 400px）就自動再加一批。
        ⚠ 它**不是按鈕**（使用者：「不是按鈕，要無縫刷新」），
          只是給 IntersectionObserver 量位置用的一條細線；載完就換成下面的「已顯示全部」。
      -->
      <div
        v-if="feedMode && !byCat && !feedDone && rows.length"
        :ref="(el) => (sentinelEl = el as HTMLElement | null)"
        class="feed__sentinel"
        aria-hidden="true"
      >
        <span class="feed__spin"></span>
        <span class="tiny muted">載入更多…</span>
      </div>
      <p v-else-if="feedMode && !byCat && rows.length" class="feed__end tiny muted">
        已顯示全部 {{ rows.length }} 筆
      </p>

      <!-- 0.1.53：分頁列（只有逐筆檢視、且超過一頁的量才出現） -->
      <div v-if="showPager" class="pager">
        <label class="pager__size">
          <span class="pager__lb">每頁</span>
          <!-- ⚠ 一定要 .number：<select> 的 v-model 預設送字串，「全部」的 0 會變 '0'，
               沒有修飾詞時 `pageSize === 0` 永遠是 false → 選「全部」會變成「每頁 0 筆」 -->
          <select v-model.number="pageSize" class="field pager__sel">
            <option v-for="n in sizeOptions" :key="n" :value="n">
              {{ n === 0 ? '全部' : `${n} 筆` }}
            </option>
          </select>
        </label>
        <!-- PWA：沒有頁碼也沒有按鈕，只告訴使用者目前載到第幾筆 -->
        <span v-if="feedMode" class="pager__info num">
          已顯示 {{ Math.min(feedRows.length, rows.length) }} / {{ rows.length }} 筆
        </span>
        <template v-else>
          <span class="pager__info num">第 {{ page }} / {{ pageCount }} 頁</span>
          <!-- 電腦版：四顆頁鈕 -->
          <div class="pager__nav">
            <button class="btn btn--ghost btn--sm" :disabled="page <= 1" @click="gotoPage(1)">第一頁</button>
            <button class="btn btn--ghost btn--sm" :disabled="page <= 1" @click="gotoPage(page - 1)">上一頁</button>
            <button class="btn btn--ghost btn--sm" :disabled="page >= pageCount" @click="gotoPage(page + 1)">下一頁</button>
            <button class="btn btn--ghost btn--sm" :disabled="page >= pageCount" @click="gotoPage(pageCount)">最後一頁</button>
          </div>
        </template>
      </div>
    </template>

    <!-- 依分類分組：每組顯示筆數與收支小計，預設只露前幾筆 -->
    <template v-else>
      <div v-if="!catGroups.length" class="empty card">
        <p class="muted">{{ emptyText }}</p>
      </div>

      <div v-for="g in catGroups" :key="g.id" class="catgrp">
        <div class="catgrp__head">
          <span class="catgrp__ic" :style="{ '--c': g.color, '--bg': withAlpha(g.color, 0.14) }">
            <CategoryIcon :name="g.icon" :size="15" :stroke="1.9" />
          </span>
          <span class="catgrp__name">
            <HighlightText :text="g.name" :query="kw" />
          </span>
          <span class="catgrp__n tiny muted">{{ g.list.length }} 筆</span>
          <span class="catgrp__rule"></span>
          <span class="catgrp__amt">
            <!-- 0.1.76：數量模式也有收支 → 恢復 ± 兩顆（沒有幣別符號） -->
            <span v-if="g.inc > 0" class="catgrp__chip is-inc num">
              +{{ fmtMoney(g.inc, settings.quantityMode ? '' : settings.displayCurrency) }}
            </span>
            <span v-if="g.exp > 0" class="catgrp__chip is-exp num">
              −{{ fmtMoney(g.exp, settings.quantityMode ? '' : settings.displayCurrency) }}
            </span>
          </span>
        </div>

        <!-- 子分類明細：一眼看出這個大類的錢花在哪個子分類 -->
        <div v-if="g.subs.length" class="catgrp__subs">
          <span v-for="s in g.subs" :key="s.id" class="subchip">
            <span class="subchip__n"><HighlightText :text="s.name" :query="kw" /></span>
            <!-- 0.1.76：數量模式也有收支 → 恢復 ±（沒有幣別符號） -->
            <span v-if="s.exp > 0" class="subchip__v num is-exp">
              −{{ fmtMoney(s.exp, settings.quantityMode ? '' : settings.displayCurrency) }}
            </span>
            <span v-if="s.inc > 0" class="subchip__v num is-inc">
              +{{ fmtMoney(s.inc, settings.quantityMode ? '' : settings.displayCurrency) }}
            </span>
          </span>
        </div>

        <div class="card catgrp__card">
          <template v-for="(r, i) in visibleCat(g)" :key="r.id">
            <hr v-if="i > 0" class="divider" />
            <RecordRow
              :record="r"
              :show-time="true"
              :highlight="kw"
              :time-recent="recent"
              :abs-time="absTimeMode"
              :gap-text="g.gap.get(r.id) ?? ''"
              @edit="editingId = $event"
              @remove="removeEditing($event)"
            />
          </template>
        </div>

        <button
          v-if="g.list.length > CAT_PREVIEW"
          class="btn btn--ghost btn--sm catgrp__more"
          @click="toggleCatGroup(g.id)"
        >
          {{ catOpen(g.id) ? '收合' : `顯示全部 ${g.list.length} 筆` }}
        </button>
      </div>
    </template>

    <RecordSheet
      :open="!!editing"
      :record="editing"
      :nav-ids="navIds"
      @close="editingId = null"
      @save="saveEdit"
      @remove="removeEditing"
      @search-cat="searchCat"
      @goto-record="editingId = $event"
    />
  </div>
</template>

<style scoped>
/* ── 旅行過濾 chip（0.1.38）：琥珀主題，跟「旅」標籤／旅行組同一族 ── */
.tripfilter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  min-width: 0;
}
.tripfilter__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 6px 0 11px;
  border-radius: 999px;
  border: 1px solid var(--amber-line);
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 12.5px;
  font-weight: 700;
  min-width: 0;
}
.tripfilter__ic {
  width: 14px;
  height: 14px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tripfilter__t {
  flex: none;
}
.tripfilter__name {
  min-width: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tripfilter__x {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tripfilter__x:hover {
  background: var(--surface-3);
}
.tripfilter__x svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
}
.tripfilter__hint {
  min-width: 0;
}

.sum {
  position: relative;
  overflow: hidden;
  padding: 16px;
  margin-bottom: 14px;
}
.sum::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--expense));
}
.sum__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.sum__col {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.sum__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
.sum__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.sum__dot--exp {
  background: var(--expense);
}
.sum__dot--inc {
  background: var(--income);
}
.sum__val {
  font-size: 17px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sum__val.is-exp {
  color: var(--expense);
}
.sum__val.is-inc {
  color: var(--income);
}
@media (max-width: 519px) {
  .sum__val {
    font-size: 15px;
  }
}

.grp {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.grp__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}

.rangebar {
  padding: 12px 14px 13px;
  margin-bottom: 14px;
}
/* 檢視／篩選各自一列（直向堆疊），手機上不會兩組擠在同一列 */
.grp__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/*
 * 0.1.61：檢視列（分類／最近／待辦／依新增時間）**固定同一列、不換行**。
 * 加了「待辦」後四顆在 375px 手機上剛好貼齊；「依新增時間」窄屏已改顯示「依實時」，
 * 所以套 nowrap 也不會溢出。⚠ 只約束這一列，別影響「篩選」那一列（它有自己的 --split）。
 */
.grp__row--view {
  flex-wrap: nowrap;
}
@media (max-width: 519px) {
  /* PWA：再收一點間距／內距，四顆按鈕在 375px 手機必定同一列 */
  .grp__row--view {
    gap: 6px;
  }
  .grp__row--view .bycat {
    padding: 0 9px;
  }
}
/*
 * 0.1.61（續）：≤374px（320／360 這類小機身）四顆還是塞不進同一列——
 *   實測內容寬約 312px（67＋67＋80＋80＋三個 6px 間距），而 320px 時那一列只有 254px，
 *   套 nowrap 會整排溢出卡片。所以再壓一級：內距 4px、按鈕內距 4px、字 12px、icon 14px。
 *   壓完內容約 242px，320px 也放得下（同一列、不溢出、不掉行）。
 *   ⚠ 只壓「檢視」這一列、只在這個斷點；375px 以上維持原尺寸（375px 原本就放得下）。
 */
@media (max-width: 374px) {
  .grp__row--view {
    gap: 4px;
  }
  .grp__row--view .bycat {
    padding: 0 4px;
    gap: 4px;
    font-size: 12px;
  }
  .grp__row--view .bycat__ic {
    width: 14px;
    height: 14px;
  }
}
/* 篩選那一列：收支段控靠左，「依單位／自訂範圍」推到最右邊 */
.grp__row--split .rangebar__mode {
  margin-left: auto;
}
.rangebar__mode {
  align-self: flex-start;
}
/* 「分類」切換鈕：外觀對齊 .seg2 的外框（3px 內距 → 高 34px），
   開啟時用墨綠淡底，一眼看得出目前是分類檢視 */
.bycat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.bycat:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.bycat.is-on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
/*
 * 0.1.29：「依新增時間」按鈕（從區間列的 .rangetag 搬來）＋黃色外框。
 * - `margin-left: auto`：那一列是 flex，這樣它會黏在最右邊
 * - 黃框**常駐**（不管有沒有開啟），開啟時才補黃底＋深黃字
 * ⚠ 一定要自己寫一份 `:hover`：`.bycat:hover`（0,2,0）會蓋掉這裡的（0,1,0），
 *   不然滑過去黃框就變墨綠框了。
 */
.bycat--basis {
  margin-left: auto;
  border-color: var(--amber);
}
.bycat--basis:hover {
  border-color: var(--amber);
  color: var(--text);
  background: var(--surface-3);
}
.bycat--basis.is-on,
.bycat--basis.is-on:hover {
  background: var(--amber-soft);
  border-color: var(--amber);
  color: var(--warn);
}
.bycat__ic {
  width: 15px;
  height: 15px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── 依分類分組 ────────────────────────────────────────── */
.catgrp {
  margin-bottom: 16px;
}
.catgrp__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px 8px;
}
.catgrp__ic {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 8px;
  color: var(--c);
  background: var(--bg);
}
.catgrp__name {
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catgrp__n {
  flex: none;
}
.catgrp__rule {
  flex: 1;
  min-width: 10px;
  height: 1px;
  background: var(--line);
}
.catgrp__amt {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
}
.catgrp__chip {
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}
.catgrp__chip.is-exp {
  color: var(--expense);
}
.catgrp__chip.is-inc {
  color: var(--income);
}
/* 子分類小計：標題下方一行 chips，超出就換行 */
.catgrp__subs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px 9px;
}
.subchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-2);
}
.subchip__n {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subchip__v {
  font-size: 11.5px;
  font-weight: 700;
}
.subchip__v.is-exp {
  color: var(--expense);
}
.subchip__v.is-inc {
  color: var(--income);
}
.catgrp__card {
  overflow: hidden;
}
.catgrp__more {
  display: flex;
  width: 100%;
  margin: 8px auto 0;
}
/* 與 RecordList 的 .empty 一致（那份是 scoped，這裡要自己一份） */
.empty {
  padding: 30px 18px;
  text-align: center;
}
.rangebar__top {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 搜尋框移到標題列：靠右、與左邊的標題塊垂直居中 */
.page-head {
  align-items: center;
}
.page-head__txt {
  min-width: 0;
}
/* <p> 的 UA 預設下邊距會讓標題塊底部多 13px，置中的搜尋框看起來會偏低；
   只消掉最後一個元素的 margin-bottom，標題與副標之間的間距維持原樣 */
.page-head__txt > :last-child {
  margin-bottom: 0;
}
.search {
  position: relative;
  flex: 1;
  max-width: 200px;
  min-width: 0;
}
.search__ic {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--text-3);
  stroke-width: 1.7;
  stroke-linecap: round;
  pointer-events: none;
  /* ⚠ 一定要有 z-index：ClearableInput 的 `.cf` 是 position:relative 且排在這個 svg 後面，
     兩者 z-index 都是 auto 時「後面的勝」→ 白色輸入框會把放大鏡整個蓋掉（一直以來都看不到，
     左邊卻仍留著 30px 內距，看起來就是文字莫名縮排）。 */
  z-index: 1;
}
/* 搜尋框比一般 .field 小一號（42 → 34px），擺在標題旁邊才不會太笨重。
   ⚠ ClearableInput 自己也有 `.cf__in`／`.cf__x` 的同名樣式，特異度跟
   `.search :deep(.cf__in)` 一樣是 (0,2,0)，**誰贏取決於打包順序**——
   所以這裡刻意多帶一個 class（`.field.cf__in`）或一層（`.cf .cf__x`）把特異度拉高，
   不然 padding-right 與清空鈕的尺寸會被它蓋回去。
   左側讓開放大鏡、右側讓開清空鈕（22px 鈕 + 6px 邊距 + 4px 間隙）。
   ⚠⚠ 字級 16px 是 0.1.25 的全站約定（見 src/style.css）：iOS 對 < 16px 的可編輯元素
   會 focus zoom，而那個縮放 blur 後不保證還原 → 使用者「點過輸入框之後，
   連點空白處頁面就往上滑」。**這裡曾經是 13px，不能再改回去** ——
   搜尋框是「會叫出鍵盤」的輸入框，跟 `<select>` 那種原生滾輪不一樣。
   （`.field.cf__in` 的特異度 (0,2,0) 現在其實輸給 style.css 那條 (0,5,1)，
   這裡明寫 16px 是為了讓「意圖」看得見，不是靠別處的規則默默生效。） */
.search :deep(.field.cf__in) {
  height: 34px;
  min-height: 34px;
  padding-left: 30px;
  padding-right: 32px;
  font-size: 16px;
  border-radius: 10px;
}
.search :deep(.cf .cf__x) {
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 7px;
}
.search :deep(.cf__x svg) {
  width: 13px;
  height: 13px;
}
/* 0.1.81（需求 2）：精準搜索開關——放在搜索框裡（分類選擇器旁邊）。
   ⚠ 只在**有輸入**時才出現：搜索框只有 200px 寬、字級又是 16px（iOS 防縮放），
   常駐一顆鈕會把 placeholder「搜尋備註或旅行」擠到塞不下（v95 有這條斷言）。
   有打字時 placeholder 本來就看不到了，空間讓給按鈕剛好。
   ⚠ 開著時用強調色（跟「顯示實際時間」那類開關同一套語彙）。 */
.exbtn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  transition:
    background 0.12s,
    color 0.12s,
    transform 0.06s;
}
.exbtn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}
.exbtn:hover {
  background: var(--surface-3);
}
.exbtn:active {
  transform: scale(0.94);
}
.exbtn.is-on {
  background: var(--accent-soft);
  color: var(--accent);
}
.ctl {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 11px;
  flex-wrap: wrap;
}
/* 區間／筆數標籤：推到「日／月／年」這一列的最右邊。
   下緣留 3px 是因為 .seg2 有 3px 內距，實際按鈕是內縮的；
   不補的話標籤會比左側按鈕低 3px，看起來不在同一列。 */
.ctl .rangeinfo {
  margin-left: auto;
  margin-bottom: 3px;
}
.rangeinfo {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
/* 自訂範圍模式：標籤單獨一列、靠右對齊 */
.rangeinfo--end {
  grid-column: 1 / -1;
  justify-content: flex-end;
}
/* 與左邊的日／月／年按鈕完全同級：13px／600／28px／左右 14px、沿用內文字體
   （刻意不加 .num 的等寬數字字體，那會讓右側看起來與左邊不是同一套字） */
.rangetag {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: normal;
  color: var(--text-2);
  background: var(--surface-3);
  border-radius: 999px;
  white-space: nowrap;
}
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.nav__label {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 14.5px;
  font-weight: 650;
}
.nav__today {
  flex: none;
}
.chip {
  flex: 1;
  height: 30px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 550;
  color: var(--text-2);
  white-space: nowrap;
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
.custom__dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 11px;
}
.custom__date {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
/* ⚠ 用 :deep()：DateField 是子元件，它裡面的 input 不會帶到這一頁的 scope id，
   直接寫 `.custom__date .field` 會選不到 */
.custom__date :deep(.field) {
  min-width: 0;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.presets .chip {
  flex: none;
  padding: 0 12px;
}
.seg2 {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--surface-3);
  border-radius: 10px;
}
.seg2 button {
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}
.seg2 button.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.seg2 .seg2--exp.is-on {
  color: var(--expense);
}
.seg2 .seg2--inc.is-on {
  color: var(--income);
}

/* ── 0.1.53：分頁列 ──────────────────────────────────────
 * 版面：［每頁 ▾］［第 X / Y 頁］………［第一頁］［上一頁］［下一頁］［最後一頁］
 * PWA（≤519px）把四顆頁鈕收起來，換成一顆靠右的「顯示更多」；
 * 電腦版反過來藏起「顯示更多」。下拉清單兩邊都保留（使用者兩邊都要求）。 */
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.pager__size {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}
.pager__lb {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}
.pager__sel {
  width: auto;
  height: 30px;
  padding: 0 26px 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
}
.pager__info {
  font-size: 12.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.pager__nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.pager__nav .btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ── 0.1.54：PWA 的哨兵（滑到底自動載入下一批）─────────────────────
 * ⚠ 它不是按鈕、也不該看起來像可以按的東西：只是一條「正在載入」的狀態列。
 *   高度刻意留 56px：它消失（換成「已顯示全部」）時畫面不會突然往上縮一截。 */
.feed__sentinel,
.feed__end {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 56px;
  padding: 10px 0 4px;
}
.feed__spin {
  width: 13px;
  height: 13px;
  flex: none;
  border-radius: 50%;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  animation: feed-spin 0.7s linear infinite;
}
@keyframes feed-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 系統開「減少動態效果」時不要轉（無障礙） */
@media (prefers-reduced-motion: reduce) {
  .feed__spin {
    animation: none;
  }
}
.feed__end {
  color: var(--text-3);
}
</style>
