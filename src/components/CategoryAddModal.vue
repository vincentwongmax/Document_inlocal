<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TxType } from '@/types'

const props = defineProps<{ open: boolean; type: TxType }>()
const emit = defineEmits<{ close: []; create: [payload: { name: string; color: string }] }>()

const PRESETS = ['#e0795b', '#3f9b6e', '#4a8fd4', '#d4a13f', '#9b6bd4', '#d45b8c', '#5bb0c4']
const name = ref('')
const color = ref(PRESETS[0])
const custom = ref(false)

function pick(c: string) {
  color.value = c
  custom.value = false
}
function onPalette(e: Event) {
  color.value = (e.target as HTMLInputElement).value
  custom.value = true
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      name.value = ''
      color.value = PRESETS[0]
      custom.value = false
    }
  },
)

function create() {
  if (!name.value.trim()) return
  emit('create', { name: name.value.trim(), color: color.value })
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="card box">
        <h3>{{ type === 'expense' ? '新增支出分類' : '新增收入分類' }}</h3>

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
          <button class="btn btn--primary" type="button" :disabled="!name.trim()" @click="create">新增</button>
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
  max-width: 340px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.box h3 {
  font-size: 16px;
}
.lb {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.lb > span {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
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
