<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ImageRef } from '@/types'
import { useRecordsStore } from '@/stores/records'
import { md5OfFile } from '@/lib/md5'
import { deleteImage, getImage, putImage } from '@/lib/imageDb'
import { compressImage, makeThumb } from '@/lib/imaging'
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
 *   - 使用者按 ✕ 移除 → 直接刪 blob（這時候還沒有任何記錄引用它）
 *   - 存檔成功 → 呼叫 `release()`：清空清單但**保留 blob**（現在歸那筆記錄所有）
 *   - 清空表單／離開頁面 → 呼叫 `discard()`（或由 onBeforeUnmount 自動處理）：
 *     把本次新增的 blob 全刪掉，不讓 IndexedDB 留孤兒
 *
 * ⚠ 記錄明細（`RecordSheet.vue`）用的是另一套政策（要跟「原始圖片」比對才知道誰該刪），
 *   所以那邊沒有改用這個元件；但剪貼簿解析與放大檢視是共用的
 *   （`lib/clipboard.ts`、`components/ImageLightbox.vue`）。
 */
const props = withDefaults(
  defineProps<{
    modelValue: ImageRef[]
    label?: string
  }>(),
  { label: '收據圖片' },
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
    const blob = await getImage(im.id)
    if (!blob) {
      notify('圖片已不存在（可能已被清除）', 'warn')
      return
    }
    urls.value[im.id] = URL.createObjectURL(blob)
  }
  lightbox.value = urls.value[im.id]
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
      const comp = await compressImage(file)
      await putImage(id, comp.blob)
      const thumb = await makeThumb(comp.blob)
      next.push({
        id,
        md5,
        shotAt: null,
        name: file.name,
        thumb,
        w: comp.width || undefined,
        h: comp.height || undefined,
        bytes: comp.bytes,
        originalBytes: comp.originalBytes || file.size,
      })
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
    void deleteImage(im.id)
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

/* ── 拖曳（頁面的掉落判斷交給 HomeView，這裡只負責亮起來）─── */
function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  over.value = true
}
function onDragLeave(e: DragEvent) {
  const to = e.relatedTarget as Node | null
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) over.value = false
}

/* ── 生命週期 ───────────────────────────────────────────── */
/** 存檔成功：清單清空，但 blob 歸那筆記錄所有，不能刪 */
function release() {
  kept = true
  for (const id of Object.keys(urls.value)) revoke(id)
  added.clear()
  lightbox.value = null
  emit('update:modelValue', [])
}

/** 放棄（清空表單／離開頁面）：把這次新增的 blob 全刪掉 */
function discard() {
  for (const id of added) void deleteImage(id)
  added.clear()
  for (const id of Object.keys(urls.value)) revoke(id)
  lightbox.value = null
  // ⚠ 一定要清空清單：blob 刪了但縮圖還掛著的話，畫面會留著一張點不開的破圖，
  //   而且「清空」看起來像沒生效（張數沒歸零）。
  if (props.modelValue.length) emit('update:modelValue', [])
}

onMounted(() => document.addEventListener('paste', onPaste, true))
onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste, true)
  if (!kept) discard()
})

defineExpose({ addFiles, release, discard })

const hintText = computed(() => {
  if (pasteMode.value) return '長按「貼上圖片」磚 → 選「貼上」（電腦可直接 Ctrl／⌘ + V）'
  if (props.modelValue.length) return `共 ${props.modelValue.length} 張 · 點圖片放大檢視、✕ 可移除`
  return '可上傳、貼上或拖曳圖片（自動壓縮，保留文字清晰度）'
})
</script>

<template>
  <div
    class="rec"
    :class="{ 'is-over': over }"
    data-drop="receipt"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
  >
    <span class="rec__label">{{ label }}</span>

    <div class="rec__grid">
      <div v-for="im in modelValue" :key="im.id" class="rec__cell">
        <button class="rec__item" type="button" :title="im.name || '收據圖片'" @click="openImage(im)">
          <img v-if="im.thumb" :src="im.thumb" alt="" />
        </button>
        <button class="rec__x" type="button" title="移除圖片" aria-label="移除圖片" @click="remove(im)">
          ✕
        </button>
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

    <p class="tiny muted rec__hint">{{ hintText }}</p>
  </div>

  <Teleport to="body">
    <ImageLightbox :src="lightbox" @close="lightbox = null" />
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
.rec__label {
  display: block;
  margin: 0 0 8px 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-3);
}
.rec__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rec__cell {
  position: relative;
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
