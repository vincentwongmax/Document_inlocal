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
 *
 * 0.1.51：query 以空白切成多個詞（跟記錄頁搜尋的 AND 條件同步），
 * **任一個詞命中的字元都上黃底**。做法改成「先算出每個字元是否命中」的遮罩，
 * 再合併成連續片段——這樣詞與詞重疊時也不會出現重複或錯位的標記。
 */
const segs = computed<Seg[]>(() => {
  const terms = props.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return [{ t: props.text, hit: false }]

  const hay = props.text.toLowerCase()
  const hit = new Array<boolean>(props.text.length).fill(false)
  for (const needle of terms) {
    let from = 0
    for (;;) {
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      for (let k = at; k < at + needle.length; k++) hit[k] = true
      from = at + needle.length
    }
  }
  if (!hit.includes(true)) return [{ t: props.text, hit: false }]

  const out: Seg[] = []
  let start = 0
  for (let i = 1; i <= props.text.length; i++) {
    if (i === props.text.length || hit[i] !== hit[start]) {
      out.push({ t: props.text.slice(start, i), hit: hit[start] })
      start = i
    }
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
