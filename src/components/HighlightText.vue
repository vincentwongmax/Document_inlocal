<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ text: string; query?: string }>(), { query: '' })

interface Seg {
  t: string
  hit: boolean
}

/**
 * 把文字切成「未命中 / 命中」交錯的片段，命中片段由 <mark> 包起來。
 * 刻意不用 RegExp：使用者輸入 `(`、`*`、`\` 等字元時不必跳脫，也不會有 ReDoS 風險。
 * 比對不分大小寫，但輸出保留原文大小寫。
 */
const segs = computed<Seg[]>(() => {
  const needle = props.query.trim().toLowerCase()
  if (!needle) return [{ t: props.text, hit: false }]

  const hay = props.text.toLowerCase()
  const out: Seg[] = []
  let i = 0
  while (i < props.text.length) {
    const at = hay.indexOf(needle, i)
    if (at < 0) {
      out.push({ t: props.text.slice(i), hit: false })
      break
    }
    if (at > i) out.push({ t: props.text.slice(i, at), hit: false })
    out.push({ t: props.text.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return out
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-multiple-template-root -- 刻意輸出片段，不額外包標籤 -->
  <template v-for="(s, i) in segs" :key="i"><mark v-if="s.hit" class="hl">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template>
</template>

<style scoped>
.hl {
  padding: 0 1px;
  border-radius: 3px;
  /* 換行時每個片段各自保有底色與圓角 */
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  background: var(--hl);
  color: var(--text);
  font-weight: 650;
}
</style>
