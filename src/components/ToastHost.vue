<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { items, dismiss } = useToast()
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in items" :key="t.id" class="toast" :class="`toast--${t.kind}`">
        <span class="toast__text">{{ t.text }}</span>
        <button v-if="t.action" class="toast__act" @click="t.action.run(); dismiss(t.id)">
          {{ t.action.label }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--nav-h) + var(--safe-b) + 14px);
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  max-width: 420px;
  width: fit-content;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #1b1a18;
  color: #fff;
  font-size: 13.5px;
  box-shadow: var(--shadow-3);
}
.toast--warn {
  background: #8d3c26;
}
.toast--info {
  background: #2f4a43;
}
.toast__act {
  color: #fff;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s,
    transform 0.18s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@media (min-width: 1024px) {
  .toasts {
    bottom: 22px;
  }
}
</style>
