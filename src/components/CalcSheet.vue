<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { calcValue, displayMain, displaySub, type CalcState } from '@/lib/calc'
import { fmtMoney } from '@/lib/currency'
import { useScrollLock } from '@/composables/useScrollLock'
import Keypad from '@/components/Keypad.vue'

/**
 * 輸入金額用的計算機子頁面（置中卡片彈窗）。
 * 金額狀態仍由記帳頁持有，這裡只負責顯示與轉發按鍵，
 * 所以關掉再開、或點背景關掉，輸入過的內容都不會不見。
 */
const props = defineProps<{
  open: boolean
  calc: CalcState
  /** 金額前綴的幣別符號 */
  symbol: string
  /** 目前記帳幣別（換算預覽用） */
  curCode: string
}>()

const emit = defineEmits<{ press: [key: string]; close: [] }>()

const settings = useSettingsStore()

const amount = computed(() => Number(calcValue(props.calc).toFixed(2)))
const expr = computed(() => displaySub(props.calc))
const display = computed(() => displayMain(props.calc))
/** 公式較長時縮小字級 */
const displayLong = computed(() => display.value.length > 11)
/** 還沒按 = 之前不顯示換算預覽，答案要按了等於才出現 */
const converted = computed(() => props.calc.done && props.curCode !== settings.baseCurrency)
const convertedAmount = computed(() => Number((amount.value * settings.rate(props.curCode)).toFixed(2)))

/**
 * 背景不滑動：
 * 1. 捲動容器是 documentElement，彈窗期間直接在它上面關掉 overflow（useScrollLock）
 * 2. iOS Safari 只靠 overflow 擋不住手指滑動，useScrollLock 會另外 preventDefault touchmove
 * 3. 卡片本身也不滑動（max-height + overflow hidden），手指在卡片上滑也不會傳給背景
 *
 * 計算機整頁都不需要捲，所以不傳 scrollable —— 任何手指滑動一律擋掉。
 */
useScrollLock(toRef(props, 'open'))
</script>

<template>
  <Transition name="calcfade">
    <div v-if="open" class="calcwrap" @click.self="emit('close')">
      <div class="calccard card" role="dialog" aria-modal="true" aria-label="輸入金額">
        <header class="calccard__hd">
          <span class="calccard__title">輸入金額</span>
          <button type="button" class="btn btn--primary calccard__done" @click="emit('close')">
            完成
          </button>
        </header>

        <div class="calcdisp">
          <div class="calcdisp__expr num">{{ expr || '\u00a0' }}</div>
          <div class="calcdisp__main">
            <span class="calcdisp__sym">{{ symbol }}</span>
            <span class="calcdisp__num num" :class="{ 'is-long': displayLong }">{{ display }}</span>
          </div>
          <div v-if="converted && amount > 0" class="calcdisp__conv num tiny">
            ≈ {{ fmtMoney(convertedAmount, settings.baseCurrency) }}
          </div>
        </div>

        <Keypad class="calccard__pad" @press="(k: string) => emit('press', k)" />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.calcwrap {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(28, 34, 31, 0.42);
  /* 手指滑動不要在這一層產生任何捲動手勢（背景也就不會被帶動）；
     計算機沒有可捲動的區域，所以直接 none 不會影響任何操作 */
  touch-action: none;
  /* 彈窗本身也不要把捲動傳給背景（雙重保險） */
  overscroll-behavior: contain;
}

.calccard {
  width: 100%;
  max-width: 352px;
  /* 卡片不滑動：超過就讓數字鍵縮小，而不是長出捲軸 */
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 12px 14px;
}

.calccard__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--line);
}
.calccard__title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.calccard__done {
  height: 34px;
  min-width: 70px;
  padding: 0 14px;
  font-size: 13px;
}

.calcdisp {
  padding: 12px 4px 14px;
  text-align: right;
  min-height: 0;
}
.calcdisp__expr {
  min-height: 18px;
  font-size: 12.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calcdisp__main {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
.calcdisp__sym {
  font-size: 17px;
  color: var(--text-2);
}
.calcdisp__num {
  font-size: 38px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.calcdisp__num.is-long {
  font-size: 24px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.calcdisp__conv {
  margin-top: 2px;
  color: var(--accent);
}

.calccard__pad {
  margin-top: auto;
}
/* 畫面高度不夠時讓按鍵縮小，維持「卡片不滑動」。
   鍵盤固定 5 列（見 Keypad.vue），橫向小螢幕也要塞得下，所以下限給得比較小 */
.calccard :deep(.key) {
  height: clamp(34px, 6.6vh, 54px);
}

/* ── 進出場 ─────────────────────────────────────────────── */
.calcfade-enter-active,
.calcfade-leave-active {
  transition: opacity 0.18s ease;
}
.calcfade-enter-from,
.calcfade-leave-to {
  opacity: 0;
}
.calcfade-enter-active .calccard,
.calcfade-leave-active .calccard {
  transition: transform 0.18s ease;
}
.calcfade-enter-from .calccard,
.calcfade-leave-to .calccard {
  transform: scale(0.96);
}
</style>
