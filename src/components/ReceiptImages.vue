<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ImageRef, LevelKey } from '@/types'
import { useRecordsStore } from '@/stores/records'
import { md5OfFile } from '@/lib/md5'
import { deleteImage } from '@/lib/imageDb'
import { formatBytes } from '@/lib/imaging'
import { IMG_LEVELS } from '@/lib/imgLevels'
import {
  blobOf,
  commonLevel,
  dropPending,
  flushLevels,
  isLocked,
  isSaved,
  levelBusyId,
  setLevel,
  setLevelAll,
  stageImage,
} from '@/composables/useImgLevels'
import { uid } from '@/lib/id'
import { notify } from '@/lib/alerts'
import { IMG_MIME } from '@/lib/clipboard'
import { dupNotice } from '@/lib/receiptDup'
import { usePasteImages } from '@/composables/usePasteImages'
import ImageLightbox from '@/components/ImageLightbox.vue'

/**
 * 「收據圖片」區塊：上傳／貼上／拖曳收圖，縮圖排排站，點一下放大檢視。
 *
 * 生命週期（這個元件只管**還沒存檔**的圖片）：
 *   - 0.1.71 起圖片**延遲寫入**：上傳當下只壓縮到預設等級（A）留在記憶體，
 *     父層在 `records.add` 前呼叫 `flush()` 才寫進 IndexedDB（見 useImgLevels）
 *   - 使用者按 ✕ 移除 → 收回記憶體（沒寫過 DB，什麼都不用刪）
 *   - 存檔成功 → 呼叫 `release()`：清空清單但**保留 blob**（現在歸那筆記錄所有）
 *   - 清空表單／離開頁面 → 呼叫 `discard()`（或由 onBeforeUnmount 自動處理）：
 *     把本次新增的記憶體全收回，不讓 IndexedDB 留孤兒
 *
 * ⚠ 記錄明細（`RecordSheet.vue`）用的是另一套政策（要跟「原始圖片」比對才知道誰該刪），
 *   所以那邊沒有改用這個元件；但剪貼簿解析與放大檢視是共用的
 *   （`lib/clipboard.ts`、`components/ImageLightbox.vue`）。
 */
const props = withDefaults(
  defineProps<{
    modelValue: ImageRef[]
    label?: string
    /**
     * 0.1.72（需求 5）：切換頁面時**保留**這些圖（設定頁「記帳頁暫存資料＝保留」時給 true）。
     * 原本元件卸載會自動 `discard()`（把還沒記錄的圖從記憶體收掉）——
     * 設定成保留時不能收，不然回到記帳頁圖就沒了。
     */
    keepOnUnmount?: boolean
  }>(),
  { label: '收據圖片', keepOnUnmount: false },
)
const emit = defineEmits<{ 'update:modelValue': [v: ImageRef[]] }>()

const records = useRecordsStore()

const busy = ref(false)
const over = ref(false)
/** 本次新增、還沒存檔的圖片 id（放棄時要把這些 blob 刪掉） */
const added = new Set<string>()
/** 已經被記錄接手的圖片：卸載時不要再刪 */
let kept = false

/* ── 縮圖點開放大 ───────────────────────────────────────── */
const urls = ref<Record<string, string>>({})
const lightbox = ref<string | null>(null)

function revoke(id: string) {
  if (urls.value[id]) {
    URL.revokeObjectURL(urls.value[id])
    delete urls.value[id]
  }
}

async function openImage(im: ImageRef) {
  if (!urls.value[im.id]) {
    // 0.1.71：先看記憶體（還沒寫 DB 的新圖），再退回 IndexedDB
    const blob = await blobOf(im.id)
    if (!blob) {
      notify('圖片已不存在（可能已被清除）', 'warn')
      return
    }
    urls.value[im.id] = URL.createObjectURL(blob)
  }
  lbId.value = im.id
  lightbox.value = urls.value[im.id]
}

/* ── 0.1.72：燈箱裡的壓縮等級（需求 3）───────────────────── */
/** 燈箱現在看的是哪一張（null＝燈箱沒開） */
const lbId = ref<string | null>(null)
const lbImage = computed(() => props.modelValue.find((im) => im.id === lbId.value) ?? null)
const lbLevel = computed(() => lbImage.value?.level ?? null)
const lbLocked = computed(() => (lbImage.value ? isLocked(lbImage.value.id) : true))
const lbBytes = computed(() => lbImage.value?.bytes ?? 0)

/** 還有任何一張圖能改等級嗎（全部已記錄/已儲存 → 全域鈕鎖住） */
const hasEditable = computed(() => props.modelValue.some((im) => !isLocked(im.id)))
const levelBusy = computed(() => !!levelBusyId.value)

/**
 * 標題列那一排：一次套用到**所有還沒記錄／儲存**的圖片。
 * ⚠ 套用完要順手把這些圖的 object URL 換掉 —— 不然燈箱／縮圖還是舊的那一級
 * （使用者原話：「按下對應的壓縮模式時都沒有實時看到圖片的效果」）。
 */
async function applyAll(level: LevelKey) {
  const n = await setLevelAll(props.modelValue, level)
  for (const im of props.modelValue) refreshUrl(im.id)
  if (lbId.value) lightbox.value = urls.value[lbId.value] ?? lightbox.value
  if (n) notify(`已把 ${n} 張還沒記錄的圖片改成 ${level.toUpperCase()} 級`, 'info')
}

/** 燈箱裡改這一張的等級 → 換 blob → 換 object URL → 圖片當場重載（實時預覽） */
async function onLightboxLevel(level: LevelKey) {
  const im = lbImage.value
  if (!im || isLocked(im.id)) return
  await setLevel(im, level)
  refreshUrl(im.id)
  lightbox.value = urls.value[im.id] ?? lightbox.value
}

/** 燈箱關掉：收掉 URL 與「現在看的是哪一張」 */
function closeLightbox() {
  lightbox.value = null
  lbId.value = null
}

/** 丟掉舊的 object URL、用現在的 blob 重出一個（切等級後畫面才會跟著變） */
async function refreshUrl(id: string) {
  revoke(id)
  const blob = await blobOf(id)
  if (blob) urls.value[id] = URL.createObjectURL(blob)
}

/* ── 收圖：上傳、拖曳、貼上最後都走 addFiles ─────────────── */
async function addFiles(files: File[]) {
  const list = files.filter((f) => IMG_MIME.test(f.type))
  if (!list.length) return
  busy.value = true
  try {
    const batch = new Set<string>()
    let skipped = 0
    /** 跟**別筆記錄**重複的：照收，但收集起來一起提醒使用者 */
    let dupOther = 0
    const next = [...props.modelValue]
    for (const file of list) {
      const md5 = await md5OfFile(file)
      /**
       * ⚠⚠ 兩級不同（0.1.22 使用者指定）：
       *  - **這一筆裡面**已經有同一張（含同一批重複）→ 靜默略過，連提示都不用
       *  - **其他記錄**已有同一張 → 還是收下（同一張發票分兩筆記是正常用法），
       *    但最後彈一個提醒讓使用者知道「這張圖別筆用過了，可能是重複記帳」
       */
      if (batch.has(md5) || next.some((im) => im.md5 === md5)) {
        skipped++
        continue
      }
      if (records.ownersOfMd5(md5).length) dupOther++
      batch.add(md5)
      const id = uid('img')
      // 0.1.71：只壓縮到預設等級（A）留記憶體，DB 等 flush() 才寫
      next.push(await stageImage(file, id, md5))
      added.add(id)
    }
    emit('update:modelValue', next)
    if (skipped) notify(`已略過 ${skipped} 張重複圖片`, 'warn')
    // 跨記錄重複：收了但提醒（訊息由 lib/receiptDup 統一組，明細那邊文案一致）
    if (dupOther) notify(dupNotice(dupOther), 'warn')
  } finally {
    busy.value = false
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
function pick() {
  fileInput.value?.click()
}
async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await addFiles(files)
}

function remove(im: ImageRef) {
  emit(
    'update:modelValue',
    props.modelValue.filter((x) => x.id !== im.id),
  )
  // 先比對再 revoke：revoke 會把 urls 裡那一筆刪掉，順序顛倒就永遠關不掉正在看的那張
  if (lightbox.value && lightbox.value === urls.value[im.id]) lightbox.value = null
  revoke(im.id)
  if (added.has(im.id)) {
    added.delete(im.id)
    // 0.1.71：沒 flush 過 → DB 裡根本沒有東西，收回記憶體即可；
    //   只有已經寫進 DB 的（送出瞬間的極窄窗口）才需要補刪
    if (isSaved(im.id)) void deleteImage(im.id)
    dropPending(im.id)
  }
}

/* ── 貼上（剪貼簿）────────────────────────────────────────
 * 三條路（圖片檔／讓瀏覽器貼進 DOM 再讀／自己解析 text/html）都寫在
 * `composables/usePasteImages.ts`，記帳頁與記錄明細共用同一份。
 *
 * 兩條基本路都要有，因為兩邊的支援度剛好互補：
 *   - iOS 只在「可編輯元素」取得焦點時才發 paste，所以在磚上鋪一層看不見的
 *     contenteditable 當接收面；監聽掛在 document 的 capture 階段，
 *     焦點在頁面任何地方（連備註欄都算）都收得到。
 *   - `navigator.clipboard.read()` 是加分項（Safari 支援反覆），失敗是常態。
 */
const pasteEl = ref<HTMLElement | null>(null)
const tileEl = ref<HTMLElement | null>(null)
const { armed: pasteMode, onPaste, onInput, pasteFromClipboard } = usePasteImages({
  target: () => pasteEl.value,
  tile: () => tileEl.value,
  onFiles: (files) => void addFiles(files),
  onNothing: () => notify('剪貼簿裡沒有圖片', 'info'),
})

/* ── 拖曳（0.1.26 起自己接，不再依賴外層頁面）──────────────────
   ⚠ 以前 drop 是掛在 HomeView 的整個頁面上，那裡再用 `[data-drop="receipt"]`
     判斷落點：落在這一塊就附加圖片，落在別處就走「上傳收據 → OCR 辨識記帳」。
     0.1.26 把 OCR 那段整個搬到設定頁的 BETA 區塊，記帳頁不再有那個gesture，
     所以 drop 直接收進這個元件自己處理 ——
     這樣不管在哪一頁（記帳頁、記錄明細、設定頁）拖進來都一樣能附加圖片。
   ⚠ dragover 一定要 preventDefault：不擋的話瀏覽器不會把這裡當成放置目標，
     drop 根本不會觸發（而且會顯示「不允許」的游標）。 */
function isFileDrag(e: DragEvent) {
  return !!e.dataTransfer?.types.includes('Files')
}
function onDragEnter(e: DragEvent) {
  if (!isFileDrag(e)) return
  over.value = true
}
function onDragLeave(e: DragEvent) {
  const to = e.relatedTarget as Node | null
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) over.value = false
}
function onDragOver(e: DragEvent) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
  over.value = true
}
async function onDrop(e: DragEvent) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  over.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) await addFiles(files)
}

/* ── 生命週期 ───────────────────────────────────────────── */
/**
 * 0.1.71：把本次上傳的圖（各自選定的等級）寫進 IndexedDB。
 * 父層（HomeView.submit）在 `records.add` **之前**呼叫 ——
 * 記錄送出的當下 blob 就必須已經在 DB 裡，不然重新載入會看到破圖。
 */
async function flush() {
  await flushLevels(added)
}

/** 存檔成功：清單清空，但 blob 歸那筆記錄所有，不能刪 */
function release() {
  kept = true
  for (const id of Object.keys(urls.value)) revoke(id)
  // 0.1.71：blob 已經在 flush() 時寫進 DB → 從暫存區收回記憶體
  for (const id of added) dropPending(id)
  added.clear()
  lightbox.value = null
  emit('update:modelValue', [])
}

/** 放棄（清空表單／離開頁面）：把這次新增的記憶體全收回 */
function discard() {
  // 0.1.71：還沒 flush 過 → DB 裡沒有東西可刪，收回記憶體就不留孤兒
  for (const id of added) dropPending(id)
  added.clear()
  for (const id of Object.keys(urls.value)) revoke(id)
  lightbox.value = null
  // ⚠ 一定要清空清單：縮圖還掛著的話，畫面會留著一張點不開的圖，
  //   而且「清空」看起來像沒生效（張數沒歸零）。
  if (props.modelValue.length) emit('update:modelValue', [])
}

onMounted(() => document.addEventListener('paste', onPaste, true))
onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste, true)
  // 0.1.72：設定成「切頁保留」時什麼都不收（草稿由 HomeView 還原，blob 還在記憶體）
  if (!kept && !props.keepOnUnmount) discard()
})

defineExpose({ addFiles, release, discard, flush })

const hintText = computed(() => {
  if (pasteMode.value) return '長按「貼上圖片」磚 → 選「貼上」（電腦可直接 Ctrl／⌘ + V）'
  // 0.1.72（需求 4）：使用者要求移除「共 N 張 · 點圖片放大檢視、✕ 可移除、可切換壓縮等級…」
  //   這行提示 —— 有圖時不再顯示任何說明（空的話 template 會整段不渲染）。
  //   壓縮等級的說明改放在標題列那一排（原/A/B/C/D）與燈箱裡。
  if (props.modelValue.length) return ''
  return '可上傳、貼上或拖曳圖片（每張圖可選壓縮等級，記錄後鎖定）'
})
</script>

<template>
  <div
    class="rec"
    :class="{ 'is-over': over }"
    data-drop="receipt"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div class="rec__labelrow">
      <span class="rec__label">{{ label }}</span>
      <!--
        0.1.72（需求 3）：收據圖片文字的**最右邊**多一排全域等級鈕。
        使用者原話：「用戶在這裡如果選擇了例如 A，那當前所有未記錄或儲存的圖片都是 A
        （用戶隨後可以點擊圖片，在圖片頁面再修改，只要用戶未記錄或儲存）」
        → 只對**還沒鎖定**的圖生效；已記錄／已儲存的圖不理它。
        全體同一級時那一顆才亮（等級不一致就不亮，避免誤導）。
      -->
      <div v-if="modelValue.length" class="rec__lvall" :class="{ 'is-lock': !hasEditable }">
        <button
          v-for="l in IMG_LEVELS"
          :key="l.key"
          class="rec__lvab"
          type="button"
          :class="{ 'is-on': hasEditable && commonLevel(modelValue) === l.key }"
          :disabled="!hasEditable || levelBusy"
          :title="
            hasEditable
              ? `${l.title}（套用到所有還沒記錄的圖片）`
              : `${l.title}（都已記錄或儲存，不能改了）`
          "
          @click="applyAll(l.key)"
        >
          {{ l.label }}
        </button>
      </div>
    </div>

    <div class="rec__grid">
      <div v-for="im in modelValue" :key="im.id" class="rec__cell">
        <!-- 縮圖＋✕ 包一層：等級列把cell 放寬到 108px 後，✕ 還是要貼在縮圖右上角 -->
        <div class="rec__tw">
          <button class="rec__item" type="button" :title="im.name || '收據圖片'" @click="openImage(im)">
            <img v-if="im.thumb" :src="im.thumb" alt="" />
          </button>
          <button class="rec__x" type="button" title="移除圖片" aria-label="移除圖片" @click="remove(im)">
            ✕
          </button>
        </div>

        <span class="rec__lvsz num" :title="`原始 ${formatBytes(im.originalBytes || 0)}`">{{
          formatBytes(im.bytes || 0)
        }}</span>
      </div>

      <button class="rec__add" type="button" :disabled="busy" @click="pick">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>{{ busy ? '處理中…' : '上傳圖片' }}</span>
      </button>

      <!-- 貼上：磚本身是「接收面」，點它＝把焦點放上去，接著長按選「貼上」 -->
      <div ref="tileEl" class="rec__add rec__paste" :class="{ 'is-armed': pasteMode }">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="3.2" width="8" height="3.6" rx="1.2" />
          <path
            d="M9.4 5H6.8A1.8 1.8 0 0 0 5 6.8v11.4A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V6.8A1.8 1.8 0 0 0 17.2 5h-2.6"
          />
          <path d="M8.6 11.6h6.8M8.6 15.2h4.4" />
        </svg>
        <!-- 看得見的字給眼睛看就好（讀屏名稱統一由下面那層 aria-label 提供，免得唸兩次） -->
        <span aria-hidden="true">{{ busy ? '處理中…' : '貼上圖片' }}</span>
        <span
          ref="pasteEl"
          class="rec__pasteArea"
          contenteditable="true"
          inputmode="none"
          virtualkeyboardpolicy="manual"
          role="button"
          tabindex="0"
          :aria-label="busy ? '正在處理圖片' : '貼上圖片'"
          :aria-busy="busy"
          @click="pasteFromClipboard"
          @keydown.enter.prevent="pasteFromClipboard"
          @keydown.space.prevent="pasteFromClipboard"
          @input="onInput"
        ></span>
      </div>

      <input ref="fileInput" class="hidden" type="file" accept="image/*" multiple @change="onFiles" />
    </div>

    <p v-if="hintText" class="tiny muted rec__hint">{{ hintText }}</p>
  </div>

  <Teleport to="body">
    <ImageLightbox
      :src="lightbox"
      :level="lbLevel"
      :level-locked="lbLocked"
      :level-bytes="lbBytes"
      @set-level="onLightboxLevel"
      @close="closeLightbox"
    />
  </Teleport>
</template>

<style scoped>
.rec {
  padding: 10px 11px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface-2);
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s;
}
/* 拖曳到這個區塊上＝附加圖片（拖到頁面其他地方是「辨識建立記錄」，見 HomeView） */
.rec.is-over {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* 0.1.72：標題列＝「收據圖片」＋最右邊的全域等級鈕（原/A/B/C/D） */
.rec__labelrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px 2px;
}
.rec__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}
.rec__lvall {
  margin-left: auto;
  display: flex;
  gap: 3px;
}
.rec__lvab {
  min-width: 26px;
  height: 22px;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.rec__lvab.is-on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.rec__lvall.is-lock .rec__lvab {
  opacity: 0.45;
  cursor: not-allowed;
}
.rec__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 0.1.72：等級鈕搬到燈箱與標題列了，一張圖回到「縮圖＋體積」的寬度 */
.rec__cell {
  position: relative;
  width: 76px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
/* 縮圖＋✕ 包一層（relative）：✕ 永遠貼在縮圖右上角 */
.rec__tw {
  position: relative;
  width: 76px;
}
.rec__item {
  display: block;
  width: 76px;
  height: 76px;
  padding: 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface-3);
  cursor: zoom-in;
  transition:
    border-color 0.12s,
    box-shadow 0.12s,
    transform 0.12s;
}
.rec__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.rec__item:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-2);
  transform: translateY(-1px);
}
.rec__x {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--text);
  color: var(--surface);
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.rec__x:hover {
  background: var(--expense);
  color: #fff;
}
/* ── 0.1.72：單張的等級鈕已搬到燈箱裡（需求 3），這裡只剩體積 ──── */
.rec__lvsz {
  font-size: 9px;
  line-height: 1.2;
  color: var(--text-3);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rec__add {
  width: 76px;
  height: 76px;
  border-radius: 12px;
  border: 1px dashed var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}
.rec__add:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  border-style: solid;
  color: var(--accent);
}
.rec__add:disabled {
  opacity: 0.6;
}
.rec__add svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* ── 貼上圖片磚 ──────────────────────────────────────────── */
.rec__paste {
  position: relative;
}
/* 按過之後維持強調，提示使用者「現在要長按這裡」 */
.rec__paste.is-armed {
  background: var(--accent-soft);
  border-color: var(--accent);
  border-style: solid;
  color: var(--accent);
}
/**
 * 接收貼上的隱形面：鋪滿整顆磚，只負責「能被聚焦」。
 *
 * ⚠ 下面那組 `.rec .rec__pasteArea` 刻意把全站規則關掉的兩件事打開
 * （style.css 的 `button, [role='button'], a` 有 `-webkit-touch-callout: none`
 * 與 `user-select: none`）：那兩條正是 iOS「長按 → 貼上」選單的開關，關著就永遠貼不了。
 * 看到它們請不要「順手統一」，會直接把功能弄壞。
 * 用兩層選擇器是為了**確定蓋得過**那條全域規則（同權重時只靠載入順序太脆）。
 */
.rec__pasteArea {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  outline: none;
  cursor: pointer;
  white-space: nowrap;
  /* 不要讓游標閃現：它看起來該是一顆按鈕，不是輸入框 */
  caret-color: transparent;
  /* ⚠ 字級一定要 ≥ 16px：iOS 聚焦到字太小的可編輯元素時會把**整頁放大**，
     版面一放大就可以往左滑出一大片空白。 */
  font-size: 16px;
}
.rec .rec__pasteArea {
  -webkit-touch-callout: default;
  user-select: text;
  -webkit-user-select: text;
}
.rec__hint {
  margin: 9px 0 0;
}
.hidden {
  display: none;
}
</style>
