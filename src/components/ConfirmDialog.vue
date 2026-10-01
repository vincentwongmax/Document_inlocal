<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean
    title: string
    message?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    /** 第二個動作（例如「只匯入記錄」） */
    altText?: string
  }>(),
  { confirmText: '確定', cancelText: '取消', danger: false, message: '', altText: '' },
)
const emit = defineEmits<{ confirm: []; cancel: []; alt: [] }>()
</script>

<template>
  <Transition name="cd">
    <div v-if="open" class="mask" @click.self="emit('cancel')">
      <div class="box card" role="alertdialog" aria-modal="true">
        <h3>{{ title }}</h3>
        <p v-if="message" class="muted">{{ message }}</p>
        <div class="acts">
          <button class="btn" @click="emit('cancel')">{{ cancelText }}</button>
          <button v-if="altText" class="btn" @click="emit('alt')">{{ altText }}</button>
          <button class="btn" :class="danger ? 'btn--danger' : 'btn--primary'" @click="emit('confirm')">
            {{ confirmText }}
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
  z-index: 100;
  background: rgba(27, 26, 24, 0.34);
  display: grid;
  place-items: center;
  padding: 20px;
}
.box {
  width: 100%;
  max-width: 380px;
  padding: 20px;
  box-shadow: var(--shadow-3);
}
.box h3 {
  font-size: 16.5px;
  margin-bottom: 6px;
}
.box p {
  margin: 0 0 16px;
  font-size: 13.5px;
  line-height: 1.6;
}
.acts {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.cd-enter-active,
.cd-leave-active {
  transition: opacity 0.16s;
}
.cd-enter-from,
.cd-leave-to {
  opacity: 0;
}
</style>
