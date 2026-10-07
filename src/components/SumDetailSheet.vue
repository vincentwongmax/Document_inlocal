<script setup lang="ts">
/**
 * 統計頁摘要卡的詳情小卡（支出／收入／結餘共用）。
 *
 * 使用者 0.1.22 指定：點摘要卡要「彈出頁面（有動畫）」，但**不要太多資訊**。
 * 所以這裡刻意只吃三種資料：
 *   - 標題與主數字（跟卡片上看到的一致，讓使用者知道點的是哪一張）
 *   - 幾列「標籤｜值」的關鍵數字（不超過 4 列）
 *   - 最多幾條「排行」（收入來源用，帶比例長條）
 * 不放圖表、不放清單、不放可操作項。
 */
import { ref, toRef } from 'vue'
import { useScrollLock } from '@/composables/useScrollLock'

export interface DetailRow {
  label: string
  value: string
  /** 值要用「支出紅／收入綠」上色，或單純強調 */
  tone?: 'up' | 'down' | 'plain'
}
export interface DetailRank {
  name: string
  value: string
  /** 0～1，畫長條用 */
  ratio: number
  color?: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    amount: string
    /** 主數字用哪個顏色（支出紅／收入綠／自動） */
    tone?: 'up' | 'down' | 'plain'
    /** 主數字底下的一行小字（例如「較前期 +12%」） */
    caption?: string
    rows?: DetailRow[]
    ranks?: DetailRank[]
    /** 排行區塊的標題，例如「收入來源前 3 名」 */
    rankTitle?: string
  }>(),
  { tone: 'plain', rows: () => [], ranks: () => [], rankTitle: '' },
)
const emit = defineEmits<{ close: [] }>()

/**
 * 鎖住背景捲動（全站約定）。
 * 這張卡內容很短、正常不會超高；但仍列進可捲清單當保險 ——
 * 小螢幕（例如橫向、或字級放大）時才不會整張卡卡住滑不動。
 */
const boxEl = ref<HTMLElement | null>(null)
useScrollLock(toRef(props, 'open'), { scrollable: () => boxEl.value })
</script>

<template>
  <Transition name="pop">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div ref="boxEl" class="card box" role="dialog" aria-modal="true">
        <!-- 抓把：手機上暗示可以下拉關閉（實際靠點背景或關閉鈕） -->
        <span class="grab" aria-hidden="true" />

        <div class="hd">
          <span class="hd__t">{{ title }}</span>
          <button class="hd__x" type="button" aria-label="關閉" @click="emit('close')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div class="amt">
          <strong class="num" :class="tone !== 'plain' ? `t-${tone}` : ''">{{ amount }}</strong>
          <span v-if="caption" class="tiny muted amt__cap">{{ caption }}</span>
        </div>

        <dl v-if="rows.length" class="rows">
          <div v-for="r in rows" :key="r.label" class="row">
            <dt class="tiny muted">{{ r.label }}</dt>
            <dd class="tiny num" :class="r.tone === 'up' ? 'up' : r.tone === 'down' ? 'down' : ''">
              {{ r.value }}
            </dd>
          </div>
        </dl>

        <div v-if="ranks.length" class="rank">
          <p class="tiny muted rank__t">{{ rankTitle }}</p>
          <ul class="rank__list">
            <li v-for="(k, i) in ranks" :key="k.name" class="rk">
              <span class="rk__i">{{ i + 1 }}</span>
              <span class="rk__n">{{ k.name }}</span>
              <span class="rk__v num">{{ k.value }}</span>
              <span class="rk__bar">
                <i
                  :style="{
                    width: Math.max(4, Math.min(100, k.ratio * 100)) + '%',
                    background: k.color || 'var(--accent)',
                  }"
                />
              </span>
            </li>
          </ul>
        </div>

        <p class="tip tiny muted">點卡片以外的地方就可以關閉</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: rgba(27, 26, 24, 0.34);
  display: grid;
  place-items: center;
  padding: 20px;
}
.box {
  width: 100%;
  max-width: 330px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 17px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 動畫起點：從卡片位置微微放大浮出（見 .pop-*） */
  transform-origin: center 60%;
}
/* 抓把（桌機看不到也不礙事，純裝飾） */
.grab {
  display: none;
  align-self: center;
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: var(--line-strong);
  margin-bottom: 2px;
}
.hd {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hd__t {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--text-2);
}
.hd__x {
  margin-left: auto;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  background: var(--surface-3);
}
.hd__x:hover {
  color: var(--text);
}
.hd__x svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.amt {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.amt strong {
  font-size: 30px;
  font-weight: 680;
  letter-spacing: -0.01em;
  line-height: 1.1;
}
.amt__cap {
  font-weight: 600;
}
.t-up {
  color: var(--expense);
}
.t-down {
  color: var(--income);
}
.rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line);
  border-radius: 11px;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px;
  background: var(--surface);
}
.row dd {
  margin: 0;
  font-weight: 650;
  color: var(--text);
}
.up {
  color: var(--expense);
}
.down {
  color: var(--income);
}
.rank {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rank__t {
  margin: 0;
  font-weight: 600;
}
.rank__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.rk {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 2px 8px;
}
.rk__i {
  grid-row: 1 / 3;
  align-self: center;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 10px;
  font-weight: 700;
}
.rk__n {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rk__v {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.rk__bar {
  grid-column: 2 / 4;
  height: 4px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
.rk__bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
}
.tip {
  text-align: center;
  margin: 0;
}

/* ── 動畫：淡入遮罩 ＋ 卡片微微放大浮出（使用者要的「有動畫」） ── */
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.18s ease;
}
.pop-enter-active .box,
.pop-leave-active .box {
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}
.pop-enter-from .box,
.pop-leave-to .box {
  opacity: 0;
  transform: translateY(10px) scale(0.94);
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active,
  .pop-enter-active .box,
  .pop-leave-active .box {
    transition: none;
  }
}
</style>
