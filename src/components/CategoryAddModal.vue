<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TxType } from '@/types'
import { ICON_KEYS, CATEGORY_ICONS, DEFAULT_ICON, guessIcon } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import CategoryIcon from './CategoryIcon.vue'

const props = withDefaults(defineProps<{ open: boolean; defaultType?: TxType }>(), {
  defaultType: 'expense',
})
const emit = defineEmits<{
  close: []
  create: [payload: { name: string; color: string; type: TxType; icon: string }]
}>()

const PRESETS = ['#e0795b', '#3f9b6e', '#4a8fd4', '#d4a13f', '#9b6bd4', '#d45b8c', '#5bb0c4']

const name = ref('')
const color = ref(PRESETS[0])
const catType = ref<TxType>('expense')
const icon = ref<string>(DEFAULT_ICON)
/** 使用者手動挑過圖示後，就不再依名稱自動推薦 */
const iconPicked = ref(false)
const custom = ref(false)

function pick(c: string) {
  color.value = c
  custom.value = false
}
function onPalette(e: Event) {
  color.value = (e.target as HTMLInputElement).value
  custom.value = true
}
function pickIcon(k: string) {
  icon.value = k
  iconPicked.value = true
}

// 依名稱自動推薦圖示（使用者自己挑過就不覆蓋）
watch(name, (v) => {
  if (!iconPicked.value) icon.value = guessIcon(v)
})

watch(
  () => props.open,
  (v) => {
    if (v) {
      name.value = ''
      color.value = PRESETS[0]
      catType.value = props.defaultType
      icon.value = DEFAULT_ICON
      iconPicked.value = false
      custom.value = false
    }
  },
)

function create() {
  if (!name.value.trim()) return
  emit('create', {
    name: name.value.trim(),
    color: color.value,
    type: catType.value,
    icon: icon.value,
  })
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="card box">
        <h3>新增分類</h3>

        <!-- 即時預覽 -->
        <div class="prev">
          <span class="prev__ic" :style="{ color, background: withAlpha(color, 0.14) }">
            <CategoryIcon :name="icon" :size="20" />
          </span>
          <span class="prev__name" :style="{ color }">{{ name.trim() || '新分類' }}</span>
        </div>

        <div class="lb">
          <span>類型</span>
          <div class="seg">
            <button
              type="button"
              class="seg__btn"
              :class="{ 'is-on': catType === 'expense' }"
              @click="catType = 'expense'"
            >
              支出
            </button>
            <button
              type="button"
              class="seg__btn"
              :class="{ 'is-on': catType === 'income' }"
              @click="catType = 'income'"
            >
              收入
            </button>
          </div>
        </div>

        <label class="lb">
          <span>名稱</span>
          <input
            v-model="name"
            class="field"
            maxlength="12"
            placeholder="分類名稱"
            @keyup.enter="create"
          />
        </label>

        <div class="lb">
          <span>
            圖示
            <em class="lb__hint">輸入名稱會自動推薦，也可自己挑</em>
          </span>
          <div class="igrid">
            <button
              v-for="k in ICON_KEYS"
              :key="k"
              type="button"
              class="ic"
              :class="{ 'is-on': icon === k }"
              :style="icon === k ? { color, borderColor: color, background: withAlpha(color, 0.14) } : undefined"
              :title="CATEGORY_ICONS[k].label"
              :aria-label="CATEGORY_ICONS[k].label"
              @click="pickIcon(k)"
            >
              <CategoryIcon :name="k" :size="19" />
            </button>
          </div>
        </div>

        <div class="lb">
          <span>顏色</span>
          <div class="swatches">
            <button
              v-for="c in PRESETS"
              :key="c"
              type="button"
              class="sw"
              :class="{ 'is-on': !custom && color === c }"
              :style="{ background: c }"
              :title="c"
              @click="pick(c)"
            />
            <label
              class="sw sw--palette"
              :class="{ 'is-on': custom }"
              :style="{ background: custom ? color : '' }"
              title="調色盤"
            >
              <input type="color" :value="color" class="sw__input" @input="onPalette" />
              <span class="sw__plus">＋</span>
            </label>
          </div>
        </div>

        <div class="foot">
          <button class="btn btn--ghost" type="button" @click="emit('close')">取消</button>
          <button class="btn btn--primary" type="button" :disabled="!name.trim()" @click="create">
            新增
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(27, 26, 24, 0.34);
  display: grid;
  place-items: center;
  padding: 20px;
}
.box {
  width: 100%;
  max-width: 356px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.box h3 {
  font-size: 16px;
}
.prev {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 12px;
  background: var(--surface-3);
}
.prev__ic {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: none;
}
.prev__name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.lb {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.lb > span {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.lb__hint {
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
  color: var(--text-3);
}
.seg {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 12px;
}
.seg__btn {
  flex: 1;
  height: 32px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-2);
}
.seg__btn.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.igrid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  max-height: 152px;
  overflow-y: auto;
  padding: 2px;
  border-radius: 12px;
  background: var(--surface-3);
}
.ic {
  display: grid;
  place-items: center;
  height: 40px;
  border-radius: 9px;
  border: 1px solid transparent;
  color: var(--text-2);
  background: transparent;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.ic:hover {
  background: var(--surface);
  color: var(--text);
}
.ic.is-on {
  border-width: 1px;
  border-style: solid;
  box-shadow: var(--shadow-1);
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.sw {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  border: 2px solid transparent;
  cursor: pointer;
  position: relative;
  padding: 0;
}
.sw.is-on {
  border-color: var(--text);
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--text);
}
.sw--palette {
  background: conic-gradient(red, orange, yellow, green, cyan, blue, violet, red);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.sw--palette.is-on {
  border-color: var(--text);
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--text);
}
.sw__plus {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.sw__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: 0;
  padding: 0;
}
.foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 2px;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
