<script setup lang="ts">
import { computed } from 'vue'
import type { DraftRecord } from '@/types'
import { useUpload } from '@/composables/useUpload'
import { useSettingsStore } from '@/stores/settings'
import CategoryPicker from './CategoryPicker.vue'
import { CURRENCIES, currency, fmtMoney } from '@/lib/currency'
import { toLocalInput, fromLocalInput, formatFull } from '@/lib/date'

const up = useUpload()
const settings = useSettingsStore()

const list = computed(() => up.drafts.value)
const ocrBusy = computed(() => up.stage.value === 'ocr')
const committable = computed(
  () => list.value.filter((d) => d.amount !== null && d.amount > 0).length,
)

function candsOf(d: DraftRecord) {
  return (d.ocr?.amountCandidates ?? []).slice(0, 8)
}

function currencyOptions(d: DraftRecord): string[] {
  const set = new Set<string>()
  for (const c of d.ocr?.amountCandidates ?? []) {
    if (c.currency !== 'UNKNOWN') set.add(c.currency)
  }
  if (!set.size) set.add(settings.preferredCurrency || settings.baseCurrency)
  return [...set]
}

function applyCandidate(d: DraftRecord, value: number, cur: string) {
  d.amount = value
  d.currency = cur
  if (d.ocr) d.ocr.pickedCurrency = cur
}

function applyCurrency(d: DraftRecord, cur: string) {
  d.currency = cur
  if (d.ocr) d.ocr.pickedCurrency = cur
  const best = (d.ocr?.amountCandidates ?? [])
    .filter((c) => c.currency === cur)
    .sort((a, b) => Number(b.isTotal) - Number(a.isTotal) || b.value - a.value)[0]
  if (best) d.amount = best.value
  // 記住偏好，下一張圖直接套用
  settings.setPreferredCurrency(cur)
}

function applyDate(d: DraftRecord, iso: string) {
  d.occurredAt = iso
}
</script>

<template>
  <Transition name="rv">
    <div v-if="up.reviewOpen.value" class="wrap">
      <div class="panel">
        <header class="hd">
          <div>
            <h3>收據辨識</h3>
            <p class="tiny muted hd__sub">
              <template v-if="ocrBusy">
                辨識中 {{ up.progress.value.done }} / {{ up.progress.value.total }}
              </template>
              <template v-else>
                共 {{ list.length }} 張 · 可新增 {{ committable }} 筆
                <template v-if="up.duplicates.value > 0">
                  · 略過 {{ up.duplicates.value }} 張重複
                </template>
              </template>
            </p>
          </div>
          <button class="btn btn--ghost btn--sm" @click="up.clear()">關閉</button>
        </header>

        <div v-if="ocrBusy" class="bar">
          <div class="bar__fill" :style="{ width: `${(up.progress.value.done / Math.max(1, up.progress.value.total)) * 100}%` }" />
        </div>

        <div class="body">
          <p v-if="!list.length" class="muted empty">沒有待確認的圖片</p>

          <article v-for="d in list" :key="d.key" class="dcard card">
            <div class="dcard__top">
              <div class="thumb">
                <img v-if="d.images[0]?.thumb" :src="d.images[0].thumb" alt="" />
              </div>
              <div class="dcard__info">
                <span class="dcard__name">{{ d.images[0]?.name || '圖片' }}</span>
                <span class="tiny muted">
                  <template v-if="d.images[0]?.shotAt">
                    拍攝 {{ formatFull(d.images[0].shotAt) }}
                  </template>
                  <template v-else>無拍攝時間資訊</template>
                </span>
                <span v-if="d.status === 'error'" class="tag tag--warn">辨識失敗，請手動輸入</span>
                <span v-else-if="d.status === 'ocr'" class="tag">辨識中…</span>
                <span v-else-if="d.ocr" class="tag">已辨識</span>
              </div>
              <button class="btn btn--ghost btn--sm" @click="up.removeDraft(d.key)">略過</button>
            </div>

            <div class="grid">
              <label class="lb">
                <span>金額</span>
                <div class="amt">
                  <input v-model.number="d.amount" class="field num" inputmode="decimal" placeholder="0.00" />
                  <select v-model="d.currency" class="field sel">
                    <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">{{ c.code }}</option>
                  </select>
                </div>
              </label>

              <label class="lb">
                <span>時間</span>
                <input
                  class="field"
                  type="datetime-local"
                  :value="toLocalInput(d.occurredAt)"
                  @input="applyDate(d, fromLocalInput(($event.target as HTMLInputElement).value))"
                />
              </label>
            </div>

            <!-- 多幣別：選擇預設採用哪一個 -->
            <div v-if="currencyOptions(d).length > 1" class="curpick">
              <span class="tiny muted">圖上有多種幣別，預設採用：</span>
              <div class="chips">
                <button
                  v-for="c in currencyOptions(d)"
                  :key="c"
                  class="chip"
                  :class="{ 'is-on': d.currency === c }"
                  @click="applyCurrency(d, c)"
                >
                  {{ c }} {{ currency(c).name }}
                </button>
              </div>
            </div>

            <div v-if="candsOf(d).length" class="cands">
              <span class="tiny muted">辨識到的金額（點選套用）：</span>
              <div class="chips">
                <button
                  v-for="(c, i) in candsOf(d)"
                  :key="i"
                  class="chip chip--num"
                  :class="{ 'is-on': d.amount === c.value && d.currency === (c.currency === 'UNKNOWN' ? d.currency : c.currency) }"
                  @click="applyCandidate(d, c.value, c.currency === 'UNKNOWN' ? d.currency : c.currency)"
                >
                  <span class="num">{{ fmtMoney(c.value, c.currency === 'UNKNOWN' ? d.currency : c.currency) }}</span>
                  <span v-if="c.isTotal" class="dot" title="命中總計關鍵字" />
                </button>
              </div>
            </div>

            <div class="lb">
              <span class="tiny muted">分類</span>
              <CategoryPicker v-model="d.categoryId" :type="d.type" />
            </div>

            <input v-model="d.note" class="field" placeholder="備註（可留空）" maxlength="80" />

            <details v-if="d.ocr?.text" class="raw">
              <summary class="tiny muted">辨識原始文字（信心度 {{ Math.round(d.ocr.confidence) }}%）</summary>
              <pre>{{ d.ocr.text }}</pre>
            </details>
          </article>
        </div>

        <footer class="ft">
          <button class="btn" @click="up.clear()">全部略過</button>
          <button class="btn btn--primary" :disabled="!committable || ocrBusy" @click="up.commit()">
            新增 {{ committable }} 筆
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.wrap {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.hd h3 {
  font-size: 17px;
}
.hd__sub {
  margin: 2px 0 0;
}
.bar {
  height: 3px;
  background: var(--surface-3);
}
.bar__fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.25s;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dcard {
  padding: 13px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.dcard__top {
  display: flex;
  align-items: center;
  gap: 11px;
}
.thumb {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface-3);
  flex: none;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.dcard__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dcard__name {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.grid {
  display: grid;
  gap: 10px;
}
.lb {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lb > span {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-2);
}
.amt {
  display: grid;
  grid-template-columns: 1fr 92px;
  gap: 8px;
}
.sel {
  padding: 0 10px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
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
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.raw pre {
  margin: 8px 0 0;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow: auto;
}
.ft {
  display: flex;
  gap: 10px;
  padding: 12px 18px calc(14px + var(--safe-b));
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.ft .btn--primary {
  flex: 1;
  height: 46px;
}
.empty {
  text-align: center;
  padding: 30px 0;
}
.rv-enter-active,
.rv-leave-active {
  transition: opacity 0.2s;
}
.rv-enter-from,
.rv-leave-to {
  opacity: 0;
}

@media (min-width: 768px) {
  .wrap {
    padding: 28px;
    background: rgba(27, 26, 24, 0.32);
  }
  .panel {
    margin: 0 auto;
    width: 100%;
    max-width: 720px;
    background: var(--surface);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-3);
    overflow: hidden;
  }
  .grid {
    grid-template-columns: 1fr 1fr;
  }
  .ft {
    padding-bottom: 14px;
  }
}
@media (min-width: 1024px) {
  .wrap {
    padding: 32px;
  }
  .panel {
    max-width: 860px;
  }
}
</style>
