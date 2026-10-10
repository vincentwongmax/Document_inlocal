<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { notify } from '@/lib/alerts'
import CalcSheet from '@/components/CalcSheet.vue'
import CategorySheet from '@/components/CategorySheet.vue'
import CategoryPicker from '@/components/CategoryPicker.vue'
import ClearableInput from '@/components/ClearableInput.vue'
import QuickNotePicker from '@/components/QuickNotePicker.vue'
import DateTimeField from '@/components/DateTimeField.vue'
import ReceiptImages from '@/components/ReceiptImages.vue'
import CategoryIcon from '@/components/CategoryIcon.vue'
import { withAlpha, DEFAULT_TRIP_COLOR } from '@/lib/color'
import {
  displayMain,
  displaySub,
  calcValue,
  calcExpr,
  initCalc,
  input,
  equals,
  isLongDisplay,
  type CalcState,
} from '@/lib/calc'
import { currency, fmtMoney } from '@/lib/currency'
import { fromLocalInput, nowLocalInput } from '@/lib/date'
import type { ImageRef, QuickPreset, TxType } from '@/types'
import { writeJSON } from '@/lib/storage'

const records = useRecordsStore()
const settings = useSettingsStore()

/*
 * ⚠ 0.1.26：這一頁**不再有**「上傳收據圖片 → 自動辨識記帳」的區塊
 *   （ReviewSheet／useUpload 都已移出）。使用者要求把它搬到設定頁的 BETA 區塊。
 *   留在這裡的只有「收據圖片」區塊（ReceiptImages）—— 那是把圖片附加到這次記帳上，
 *   跟 OCR 辨識記帳是兩件事，**刻意不動它**。
 *   連帶的：整頁拖放也拆了（drop 收進 ReceiptImages 自己處理），
 *   所以在這一頁把圖拖到「收據圖片」區塊上仍然可以附加圖片。
 */

/* ── 表單狀態 ───────────────────────────────────────────── */
const calc = ref<CalcState>(initCalc())
const type = ref<TxType>('expense')
const note = ref('')
const occurredAt = ref(nowLocalInput())

// 0.1.41：分類**永不預選**（使用者原話：「分類的按鈕永遠不要預選（用戶設定預設的
// 分類除外），只要用戶切換其他頁面再回來，就一定要清空用戶之前已選的分類，這樣
// 用戶在記錄時就不會出錯」）——初始一律空字串，只有「設定的預設分類」能自動帶入
// （見 pickInitialCategory）。⚠ 不再讀 draft 裡的上次分類（那是「預選」的來源）。
const categoryId = ref<string>('')
const curCode = ref<string>(settings.inputCurrency)

const amount = computed(() => Number(calcValue(calc.value).toFixed(2)))
const expr = computed(() => displaySub(calc.value))
const display = computed(() => displayMain(calc.value))
/** 這次記帳要附加的收據圖片（存檔前的暫存；上傳／貼上／拖曳都在 ReceiptImages 裡處理） */
const images = ref<ImageRef[]>([])
const imgEl = ref<InstanceType<typeof ReceiptImages> | null>(null)
/** 只有長公式／很大的結果才縮小字級（單一數字最多 11 位，永遠不會觸發） */
const displayLong = computed(() => isLongDisplay(display.value))
/** 還沒按 = 之前不顯示換算預覽，答案要按了等於才出現 */
const converted = computed(() => calc.value.done && curCode.value !== settings.baseCurrency)

/** 0.1.39：標題「旅行模式中」標籤的顏色＝進行中旅行的 color（舊資料沒有＝琥珀回退） */
const tripColor = computed(() => settings.activeTrip?.color ?? DEFAULT_TRIP_COLOR)

/** 記帳幣別選單：設定頁可挑選要顯示哪幾個（沒選 = 全部），目前選用的幣別一律保留 */
const currencyOptions = computed(() => {
  const all = settings.allCurrencies
  const vis = settings.visibleCurrencies
  if (!vis.length) return all
  const list = all.filter((c) => vis.includes(c.code))
  if (list.length && !list.some((c) => c.code === curCode.value)) {
    const cur = all.find((c) => c.code === curCode.value)
    if (cur) return [cur, ...list]
  }
  return list
})
const convertedAmount = computed(() => Number((amount.value * settings.rate(curCode.value)).toFixed(2)))

/* ── 快速金額預設（0.1.29；0.1.30 搬進金額框內＋拿掉 icon）── */
/**
 * 顯示用資料（按鈕上只秀數字，tooltip 秀完整內容）。
 * ⚠ 分類是**另查**的：使用者可能把 preset 指到的分類刪掉，那時要當作「沒指定」。
 */
const presetRows = computed(() =>
  settings.quickPresets.map((p) => {
    const cat = p.categoryId ? settings.category(p.categoryId) ?? null : null
    const bits: string[] = []
    if (p.amount > 0) bits.push(`金額 ${p.amount}`)
    if (p.currency) bits.push(`以 ${p.currency} 記錄`)
    if (cat) bits.push(settings.fullNameOf(cat.id))
    if (p.note.trim()) bits.push(p.note.trim())
    return {
      preset: p,
      label: p.amount > 0 ? String(p.amount) : '—',
      title: bits.length ? bits.join(' · ') : '還沒設定內容',
    }
  }),
)

/**
 * 點一顆快速金額：帶入類型 → 分類 → 備註 → 金額。
 * ⚠ 順序有關係：先切類型，分類清單才會是對的那一組；
 *   分類用「有指定且還存在」才蓋，否則維持使用者目前選的。
 */
function applyPreset(p: QuickPreset) {
  type.value = p.type
  // 幣別（0.1.32）：有指定才切，沒指定維持記帳頁目前的幣別
  if (p.currency) curCode.value = p.currency
  if (p.categoryId && settings.category(p.categoryId)) categoryId.value = p.categoryId
  if (p.note.trim()) note.value = p.note
  if (p.amount > 0) {
    // 把金額一位一位餵進計算機，最後按 = ：這樣顯示、換算預覽跟手打的一模一樣
    calc.value = initCalc()
    for (const ch of String(p.amount)) calc.value = input(calc.value, ch)
    calc.value = equals(calc.value)
  }
}

/**
 * 分類預設的優先順序（0.1.41 改）：
 *   1. **設定的「預設分類」**（使用者在分類管理裡按了「設為預設」）—— 類型要對得上
 *   2. 沒有就**空著**（使用者自己選）——原本的「上次用過的」「該類型第一個」兩級
 *      都拿掉：那是「預選」的來源，使用者明確要求不要（記錄時不會帶錯分類）。
 *
 * ⚠ 「預設分類」是 0.1.22 的新功能，跟主頁的**常用分類按鈕**完全無關：
 *   常用分類決定主頁顯示哪幾顆，這裡決定的是「預先選中誰」。
 */
function pickInitialCategory() {
  const list = settings.categoriesByType(type.value)
  const def = settings.defaultCategory
  // 預設分類的收支類型要跟目前的分頁一致，否則會選到一個這頁看不到的分類
  if (def && def.type === type.value && list.some((c) => c.id === def.id)) return def.id
  return ''
}

/** 每次記錄完成後，記帳頁要回到哪一個分類（有設預設就一律回到它） */
function resetCategory() {
  const def = settings.defaultCategory
  if (def && def.type === type.value) {
    categoryId.value = def.id
    return
  }
  // 0.1.41：沒設預設＝清空（原本保留剛剛用的那一個）——連續記帳時下一筆
  // 常常是別的分類，留著上一次的選擇反而容易記錯（使用者的原話精神）
  categoryId.value = ''
}

watch(
  [type, () => settings.categories.length],
  () => {
    const list = settings.categoriesByType(type.value)
    if (!list.some((c) => c.id === categoryId.value)) {
      categoryId.value = pickInitialCategory()
    }
  },
  { immediate: true },
)

// 開啟 App（或換到記帳頁）時，有設預設分類就直接跳到它
watch(
  () => settings.defaultCategoryId,
  () => {
    if (settings.defaultCategory) categoryId.value = pickInitialCategory()
  },
)

watch([type, categoryId], () => {
  writeJSON('mop-ledger.draft.v1', { type: type.value, categoryId: categoryId.value })
})

watch(
  () => settings.inputCurrency,
  (v) => {
    curCode.value = v
  },
)

/* ── 鍵盤 ───────────────────────────────────────────────── */
/** 計算機子頁面是否開啟（點金額欄打開） */
const keypadOpen = ref(false)
/** 分類子頁面是否開啟（點分類的「更多」打開） */
const catSheetOpen = ref(false)

function press(k: string) {
  calc.value = k === '=' ? equals(calc.value) : input(calc.value, k)
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  const map: Record<string, string> = { '*': '×', '/': '÷', x: '×', X: '×' }
  if (e.key === '(' || e.key === ')') {
    press(e.key)
    e.preventDefault()
    return
  }
  if (/^[0-9.]$/.test(e.key)) {
    press(e.key)
    e.preventDefault()
    return
  }
  if (['+', '-', '*', '/'].includes(e.key)) {
    press(map[e.key] ?? e.key)
    e.preventDefault()
    return
  }
  if (e.key === 'Enter') {
    // 計算機開著時 Enter 只是關掉它，避免手滑直接送出記錄
    if (keypadOpen.value) keypadOpen.value = false
    else submit()
    e.preventDefault()
    return
  }
  if (e.key === 'Backspace') {
    press('⌫')
    e.preventDefault()
    return
  }
  if (e.key === 'Escape') {
    // 計算機開著時 Esc 關計算機，沒有才清空金額
    if (keypadOpen.value) keypadOpen.value = false
    else calc.value = initCalc()
    e.preventDefault()
  }
}

/* ── 送出 ───────────────────────────────────────────────── */
/**
 * 回到乾淨狀態：金額、備註、時間。
 * 收支類型、分類、幣別刻意保留，方便連續記帳
 * —— 除非使用者設了「預設分類」，那時分類一律跳回它。
 */
function resetForm() {
  calc.value = initCalc()
  note.value = ''
  occurredAt.value = nowLocalInput()
  resetCategory()
}

/** 清空鈕：沒有內容時不動作，避免彈出沒意義的提示 */
function clearForm() {
  const hadImages = images.value.length > 0
  const dirty = calc.value.tokens.length > 0 || note.value !== '' || hadImages
  resetForm()
  // 還沒存檔的圖片要一起丟掉（連 IndexedDB 的 blob 也刪，不留孤兒）
  if (hadImages) imgEl.value?.discard()
  if (dirty) notify('已清空', 'info')
}

function submit() {
  if (!(amount.value > 0)) {
    notify('請先輸入金額', 'warn')
    return
  }
  if (!categoryId.value) {
    notify('請選擇分類', 'warn')
    return
  }
  /*
   * 旅行模式（0.1.35）：
   * - 模式一 → 這筆記錄蓋上 tripId 標記（記錄頁／統計頁歸到旅行名下；分類照舊）
   * - 模式二 → 備注**提交後**自動補「_旅行名」（使用者原話：
   *   「用戶正常輸入的備注, 用戶提交記錄後才增加補上(這個旅行的名字)」）
   *   ⚠ 只在有打備注時補——空備注沒有東西可以「補上」。
   */
  const trip = settings.activeTrip
  const noteBase = note.value.trim()
  const noteOut = trip?.mode2 && noteBase ? `${noteBase}_${trip.name}` : noteBase
  const rec = records.add({
    type: type.value,
    categoryId: categoryId.value,
    amount: amount.value,
    currency: curCode.value,
    occurredAt: fromLocalInput(occurredAt.value),
    note: noteOut,
    // 算出來的才記算式（單純輸入一個數字不記）
    expr: calcExpr(calc.value),
    images: [...images.value],
    source: 'manual',
    ...(trip?.mode1 ? { tripId: trip.id } : {}),
  })
  // 圖片已經被這筆記錄接手：清空面板但**不能**刪 blob
  imgEl.value?.release()
  // 0.1.28：通知裡的金額也用「目前的主幣別」顯示（跟清單同一套換算）
  // 0.1.35：模式一開著時補上旅行名，讓使用者知道這筆進了旅行
  // 0.1.36：顯示幣別——旅行中金額直接用旅行貨幣呈現
  const label = `${fmtMoney(settings.toDisplay(rec.amount, rec.currency), settings.displayCurrency)} · ${settings.category(rec.categoryId)?.name ?? ''}${trip?.mode1 ? ` · ${trip.name}` : ''}`
  notify(`已記錄 ${label}`, 'ok', { label: '復原', run: () => records.remove(rec.id) })

  resetForm()
}

/*
 * ── 拖放（0.1.26 簡化）─────────────────────────────────────
 * 以前這裡是整頁的 dragover/drop，再依落點分流：
 *   落在「收據圖片」區塊 → 附加到這次記帳；落在別處 → 走 OCR 辨識記帳。
 * OCR 搬到設定頁之後，這一頁就只剩「附加到這次記帳」一種結果，
 * 所以 drop 直接由 `ReceiptImages` 自己接（它自己就有 dragover/drop 了），
 * 這裡不必再掛任何拖放監聽，也就不會再有那個整頁的「放開即可上傳收據」遮罩。
 */

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!--
    ⚠ 0.1.26：原本這裡掛著整頁的 dragover／dragleave／drop 與「放開即可上傳收據」
      遮罩（把圖拖到別處＝走 OCR 辨識記帳）。OCR 搬到設定頁的 BETA 區塊之後，
      這一頁不需要任何拖放監聽了 —— 拖放改由「收據圖片」區塊自己接。
  -->
  <div class="page home">
    <!--
      0.1.27 加上標題（使用者：「記帳的頁面也加上標題」）。
      跟記錄／統計／設定三頁同一套 `.page-head`／`.page-title`（全域樣式），
      四個頁面的標題才會長得一樣、切換時不會跳。
      ⚠ 0.1.28：**副標「記下每一筆收支」拿掉了**（使用者：移除記下每一筆收支），
        這一頁只留標題；其他三頁的副標不受影響。
    -->
    <div class="page-head page-head--home">
      <div class="page-head__txt">
        <h1 class="page-title">記帳</h1>
      </div>
      <!--
        0.1.39：旅行進行中時，標題最右側掛「旅行模式中」小標籤（行李箱 icon＋文字）。
        - 顏色跟 activeTrip 的旅行顏色（0.1.39 色板），沒設＝琥珀回退。
        - .page-head 是 baseline 對齊，膠囊自己 align-self: center 才不會沉底。
      -->
      <span
        v-if="settings.activeTrip"
        class="tripmode"
        :style="{
          color: tripColor,
          borderColor: withAlpha(tripColor, 0.35),
          background: withAlpha(tripColor, 0.12),
        }"
      >
        <CategoryIcon name="luggage" :size="13" :stroke="2" />
        <b>旅行模式中</b>
      </span>
    </div>

    <div class="home__grid">
      <!-- 記帳表單 -->
      <section class="card pad card--ledger">
        <div class="seg">
          <button
            class="seg__btn"
            :class="{ 'is-on': type === 'expense', 'is-expense': type === 'expense' }"
            @click="type = 'expense'"
          >
            支出
          </button>
          <button
            class="seg__btn"
            :class="{ 'is-on': type === 'income', 'is-income': type === 'income' }"
            @click="type = 'income'"
          >
            收入
          </button>
          <div class="seg__cur">
            <select v-model="curCode" class="sel" :title="'目前以 ' + curCode + ' 記錄'">
              <option v-for="c in currencyOptions" :key="c.code" :value="c.code">
                {{ c.code }}
              </option>
            </select>
          </div>
        </div>

        <!--
          ⚠ 0.1.26：原本這裡有一顆「上傳收據圖片／自動辨識記帳」的按鈕，
            已搬到「設定 → BETA 收據辨識記帳」。記帳頁不再顯示它。
            下面的「收據圖片」區塊是完全不同的功能（附加圖片到這次記帳），維持不動。
        -->

        <!--
          金額框（0.1.30 改版）：
          ⚠ 外框改成包一層 `.amountbox`（框線／底色／陰影都移到它身上），
            因為「快速金額」那一排要放在**框內上方**（使用者：「放在計算機的點擊輸入金額裡
            （金額數字的框內上方）」），而按鈕裡面不能再包按鈕（HTML 不允許，
            瀏覽器會把巢狀 button 解析壞掉）→ `.amount` 保持是 button（點它開計算機），
            快速金額按鈕跟它是**平輩**，一起被包在 `.amountbox` 裡。
        -->
        <div class="amountbox">
          <!--
            快速金額（0.1.29 → 0.1.30）：這排的數量與內容由設定頁「快速金額」決定。
            0.1.30 兩個改動：①搬進金額框**內**的上方；②按鈕**不用 icon**（使用者明確要求）。
            ⚠ 點下去**只帶入**金額／類型／分類／備註，**不自動送出**——
              使用者原話：「依然要用戶手動按記錄的按鈕」。
          -->
          <div v-if="presetRows.length" class="qamt">
            <button
              v-for="row in presetRows"
              :key="row.preset.id"
              type="button"
              class="qamt__b"
              :title="row.title"
              @click="applyPreset(row.preset)"
            >
              <span class="qamt__n num">{{ row.label }}</span>
            </button>
          </div>

          <!-- 金額：只留顯示欄位，點一下開計算機子頁面 -->
          <button
            type="button"
            class="amount"
            :class="{ 'is-empty': !calc.tokens.length }"
            @click="keypadOpen = true"
          >
            <span class="amount__hint">
              <svg class="amount__ic" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4.7" y="2.7" width="14.6" height="18.6" rx="2.8" />
                <path d="M8.2 7h7.6" />
                <path d="M8.6 11.4h.01M12 11.4h.01M15.4 11.4h.01" />
                <path d="M8.6 14.6h.01M12 14.6h.01M15.4 14.6h.01" />
                <path d="M8.6 17.8h3.6" />
              </svg>
              <em class="tiny">{{ calc.tokens.length ? '點擊修改' : '點擊輸入金額' }}</em>
            </span>
            <span class="amount__val">
              <span class="amount__expr num">{{ expr || '\u00a0' }}</span>
              <span class="amount__main">
                <span class="amount__sym">{{ currency(curCode).symbol }}</span>
                <span class="amount__num num" :class="{ 'is-long': displayLong }">{{ display }}</span>
              </span>
              <span v-if="converted && amount > 0" class="amount__conv num tiny">
                ≈ {{ fmtMoney(convertedAmount, settings.baseCurrency) }}
              </span>
            </span>
          </button>
        </div>

        <div class="pad__meta">
          <div class="catbox">
            <span class="catbox__label">分類</span>
            <CategoryPicker
              v-model="categoryId"
              :type="type"
              collapsed
              more-external
              @more="catSheetOpen = true"
            />
          </div>
          <ClearableInput v-model="note" placeholder="備註（可留空）" :maxlength="80">
            <template #trailing>
              <QuickNotePicker v-model="note" />
            </template>
          </ClearableInput>
          <!-- 日期跟備註同層（同一個 flex 直欄），寬度永遠一致，
               不會被下面「清空／記錄」那列的 min-width 撐寬而跑掉 -->
          <DateTimeField v-model="occurredAt" />
          <!-- 收據圖片：上傳／貼上／拖曳，附在這次記帳上 -->
          <ReceiptImages ref="imgEl" v-model="images" />
          <div class="pad__row">
            <button class="btn btn--clear" @click="clearForm">清空</button>
            <button class="btn btn--primary btn--save" @click="submit">記錄</button>
          </div>
        </div>
      </section>
    </div>

    <CategorySheet
      :open="catSheetOpen"
      :type="type"
      :model-value="categoryId"
      @update:model-value="categoryId = $event"
      @close="catSheetOpen = false"
    />

    <CalcSheet
      :open="keypadOpen"
      :calc="calc"
      :symbol="currency(curCode).symbol"
      :cur-code="curCode"
      @press="press"
      @close="keypadOpen = false"
    />
  </div>
</template>

<style scoped>
.home__grid {
  display: grid;
  gap: 18px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
}
/**
 * 0.1.28：記帳頁整體往上移一點（使用者：「整體向上移一點」）。
 * 做了兩件事：頁首的下方留白 16px → 8px、這一頁自己的上內距 20px → 12px。
 * 標題只有一行（沒有副標），留白跟著收緊才不會看起來頭重。
 * ⚠ 只動這一頁（scoped），其他三頁的 `.page-head`／`.page` 不受影響。
 */
.page-head--home {
  margin-bottom: 8px;
}
.home {
  padding-top: 12px;
}
/*
 * 0.1.39：標題最右的「旅行模式中」標籤（行李箱 icon＋文字膠囊）。
 * 顏色（字／框／底）由 inline style 綁旅行顏色，這裡只管形狀與排版；
 * .page-head 是 baseline 對齊，膠囊 align-self: center 才不會沉到標題底線。
 */
.tripmode {
  align-self: center;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--amber-line);
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}
.pad {
  padding: 16px;
}
/**
 * 0.1.28：記帳表單的外框加一圈**淺綠**（使用者：「在記帳頁中的外框，加一個淺綠外框」）。
 * 用的是既有的 `--accent-light`（墨綠的淺色版），只換框色、不動圓角與陰影，
 * 也不加背景色 —— 背景仍是原本的白，才不會跟「米白紙感」的基調打架。
 * ⚠ 只圈**表單這一張卡**（下面的「收據圖片」「最近」卡維持原框色）。
 */
.card--ledger {
  border-color: var(--accent-light);
}
/*
 * ⚠ 0.1.26 移除：`.upload`／`.upload:hover`／`.upload em`／`.uic`／`.dropzone`。
 *   那些是「上傳收據 → 自動辨識記帳」那顆按鈕與整頁拖放遮罩的樣式，
 *   功能已搬到設定頁的 BETA 區塊（樣式也一起搬過去了，見 SettingsView.vue）。
 *   不要把這些規則加回來 —— 記帳頁不該再出現那個區塊。
 */
.seg {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 12px;
}
.seg__btn {
  flex: 1;
  height: 34px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  transition:
    background 0.15s,
    color 0.15s;
}
.seg__btn.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
/**
 * 0.1.27 的保守美化：選中的那一邊帶一點自己的顏色。
 *
 * 這個 App 的慣例本來就是「支出＝暖紅、收入＝墨綠」（記錄列、統計頁都在用），
 * 所以讓「現在記的是哪一種」在第一眼就讀得出來 —— 這是**功能性**的顏色，
 * 不是裝飾：記帳最常犯的錯就是把支出記成收入，這裡給一個不易看錯的線索。
 * ⚠ 刻意只用 soft 底＋文字上色，保留原本的白底膠囊與陰影 ——
 *   使用者要求「不要太大膽」，所以不做整段變色、也不加漸層。
 */
.seg__btn.is-on.is-expense {
  color: var(--expense);
  background: var(--expense-soft);
}
.seg__btn.is-on.is-income {
  color: var(--income);
  background: var(--accent-soft);
}
.seg__cur {
  padding-right: 2px;
}
.sel {
  height: 34px;
  padding: 0 8px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

/* 金額欄本身是一顆按鈕：點一下開計算機子頁面 */
/*
 * 0.1.30：金額框改成包一層 `.amountbox`——框線／底色／圓角／陰影都在它身上
 * （原本這些是 `.amount` 的），因為「快速金額」那排要放在**框內上方**，
 * 而按鈕裡不能包按鈕 → `.amount` 退成「框內下方那塊可點開計算機的區域」。
 */
.amountbox {
  width: 100%;
  margin: 16px 0 14px;
  padding: 10px 12px 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  /* 0.1.27 的保守美化：金額是這一頁的主角，給一點陰影讓它從表單裡浮出來
     （跟其他 `.card` 同一個陰影，沒有加漸層或強調色） */
  box-shadow: var(--shadow-1);
  transition:
    background 0.15s,
    border-color 0.15s;
}
.amountbox:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}
/*
 * 快速金額（0.1.30）：在金額框**內**的上方；按鈕**只有數字、沒有 icon**
 * （使用者原話：「按鈕不要使用 ICON」）。
 * 外觀仍然照記錄頁的日期方型按鈕那種「描邊＋白底＋方型圓角」做，只是縮小一號
 * （在金額框裡面，跟下面的金額是同一個視覺群組）。
 */
.qamt {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 10px;
}
.qamt__b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 32px;
  padding: 0 11px;
  flex: none;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 700;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}
.qamt__b:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.qamt__n {
  line-height: 1;
}
/* 金額本體：框線那些都交給外層 .amountbox，這裡只留排版 */
.amount {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* 框內左右留白由 .amountbox 統一給，這裡只補下面的（上面的間隙是 .qamt 的 margin） */
  padding: 0 3px 12px;
  border-radius: 0 0 calc(var(--r-md) - 1px) calc(var(--r-md) - 1px);
}
.amount__hint {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
  color: var(--text-3);
}
.amount__hint em {
  font-style: normal;
  font-size: 12px;
}
.amount__ic {
  width: 18px;
  height: 18px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.amount__val {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
  flex: 1;
}
.amount__expr {
  min-height: 18px;
  font-size: 12.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.amount__main {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
  max-width: 100%;
}
.amount__sym {
  font-size: 15px;
  color: var(--text-2);
}
.amount__num {
  font-size: 32px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.amount__num.is-long {
  font-size: 22px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
/* 還沒輸入時把 0 壓淡，讓「點擊輸入金額」是主視覺 */
.amount.is-empty .amount__num {
  color: var(--text-3);
}
.amount.is-empty .amount__sym {
  color: var(--text-3);
}
.amount__conv {
  color: var(--accent);
  margin-top: 2px;
}
.pad__meta {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
/* 每一列都由同一個 flex 直欄撐滿，備註、日期、按鈕列左右一定切齊 */
.pad__meta > * {
  min-width: 0;
}
/* 分類：把整組選框框成一個明顯的區塊，方便一眼看到 */
/*
 * 0.1.29：底色改成**白色**（使用者：「分類的區塊的底色改成白色」）——原本是淡墨綠
 * --accent-soft。白底＋淡綠描邊，區塊邊界一樣清楚，但不會跟選中的分類鈕（淺綠）撞色。
 * ⚠ 邊框刻意留著：整塊純白會跟卡片本身（也是白的）糊在一起。
 */
.catbox {
  padding: 10px 11px 11px;
  border: 1px solid rgba(44, 110, 91, 0.16);
  border-radius: var(--r-md);
  background: var(--surface);
}
.catbox__label {
  display: block;
  margin: 0 0 8px 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
  opacity: 0.75;
}
/* 「清空」與「記錄」自己一列（各佔一半）；日期欄不在這一列，避免被按鈕寬度帶著跑 */
.pad__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.btn--save {
  min-width: 96px;
  height: 42px;
}
/* 「記錄」左邊的清空鈕：次級動作，白底描邊即可，不搶主按鈕焦點 */
.btn--clear {
  min-width: 72px;
  height: 42px;
}

@media (min-width: 1024px) {
  .home__grid {
    gap: 24px;
  }
}
</style>
