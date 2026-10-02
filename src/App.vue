<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRecordsStore } from '@/stores/records'
import { useSettingsStore } from '@/stores/settings'
import { fmtMoney } from '@/lib/currency'
import ToastHost from '@/components/ToastHost.vue'
import { needRefresh, offlineReady, updateSW } from '@/lib/pwa'

const route = useRoute()
const records = useRecordsStore()
const settings = useSettingsStore()

const nav = [
  { to: '/', label: '記帳', icon: 'pen' },
  { to: '/records', label: '記錄', icon: 'list' },
  { to: '/stats', label: '統計', icon: 'chart' },
  { to: '/settings', label: '設定', icon: 'gear' },
]

const balance = computed(() => records.totalIncome - records.totalExpense)
const base = computed(() => settings.baseCurrency)

/* 首次離線就緒時提示一次 */
const showOfflineHint = ref(false)
watch(offlineReady, (v) => {
  if (v) showOfflineHint.value = true
})
</script>

<template>
    <div class="shell">
      <!-- 離線就緒 / 版本更新提示 -->
      <Transition name="banner">
        <div v-if="needRefresh || showOfflineHint" class="banner">
          <span class="tiny">
            {{ needRefresh ? '已有新版本' : '已可離線使用' }}
          </span>
          <button v-if="needRefresh" class="banner__btn tiny" @click="updateSW(true)">更新</button>
          <button v-else class="banner__btn tiny" @click="showOfflineHint = false">知道了</button>
        </div>
      </Transition>

      <!-- 側欄（電腦） -->
    <aside class="side">
      <div class="brand">
        <span class="brand__mark">記</span>
        <span class="brand__name">記帳本</span>
      </div>

      <nav class="side__nav">
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="side__link" active-class="is-active">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
            <path v-if="n.icon === 'pen'" d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
            <path v-if="n.icon === 'pen'" d="M14.5 6.5 17.5 9.5" />
            <path v-else-if="n.icon === 'list'" d="M8 6h12M8 12h12M8 18h12" />
            <path v-else-if="n.icon === 'list'" d="M4 6h.01M4 12h.01M4 18h.01" />
            <path v-else-if="n.icon === 'chart'" d="M5 20V11M12 20V5M19 20v-6" />
            <g v-else>
              <circle cx="12" cy="12" r="3" />
              <path
                d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.6l1.9-1.1M17.9 8.6l1.9-1.1"
              />
            </g>
          </svg>
          <span>{{ n.label }}</span>
        </RouterLink>
      </nav>

      <div class="side__foot">
        <div class="side__bal">
          <span class="tiny muted">本月結餘</span>
          <strong class="num" :class="balance < 0 ? 'is-neg' : ''">{{ fmtMoney(balance, base) }}</strong>
        </div>
      </div>
    </aside>

    <!-- 主內容 -->
    <main class="main">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :key="route.path" />
      </RouterView>
    </main>

    <!-- 底部導航（手機／平板） -->
    <nav class="tabbar">
      <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="tabbar__item" active-class="is-active">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="n.icon === 'pen'" d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path v-if="n.icon === 'pen'" d="M14.5 6.5 17.5 9.5" />
          <path v-else-if="n.icon === 'list'" d="M8 6h12M8 12h12M8 18h12" />
          <path v-else-if="n.icon === 'list'" d="M4 6h.01M4 12h.01M4 18h.01" />
          <path v-else-if="n.icon === 'chart'" d="M5 20V11M12 20V5M19 20v-6" />
          <g v-else>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.6l1.9-1.1M17.9 8.6l1.9-1.1" />
          </g>
        </svg>
        <span>{{ n.label }}</span>
      </RouterLink>
    </nav>

    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  min-height: 100dvh;
}

.banner {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 95;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-radius: 999px;
  background: #1b1a18;
  color: #fff;
  box-shadow: var(--shadow-2);
}
.banner__btn {
  color: #fff;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.banner-enter-active,
.banner-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}

/* ── 側欄 ── */
.side {
  display: none;
}

/* ── 主內容 ── */
.main {
  min-height: 100dvh;
}

/* ── 底部導航 ── */
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  height: calc(var(--nav-h) + var(--safe-b));
  padding-bottom: var(--safe-b);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: saturate(1.1) blur(8px);
  border-top: 1px solid var(--line);
}
.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--text-3);
  font-size: 11.5px;
  font-weight: 550;
  text-decoration: none;
}
.tabbar__item.is-active {
  color: var(--accent);
}
.ic {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.is-neg {
  color: var(--expense);
}

@media (min-width: 1024px) {
  .shell {
    display: grid;
    grid-template-columns: 232px 1fr;
  }
  .side {
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100dvh;
    padding: 26px 18px 20px;
    background: var(--surface-2);
    border-right: 1px solid var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 26px;
  }
  .brand__mark {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--text);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 15px;
    font-weight: 650;
  }
  .brand__name {
    font-size: 16px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .side__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .side__link {
    display: flex;
    align-items: center;
    gap: 11px;
    height: 40px;
    padding: 0 11px;
    border-radius: var(--r-md);
    color: var(--text-2);
    font-size: 14.5px;
    font-weight: 550;
    text-decoration: none;
  }
  .side__link:hover {
    background: var(--surface-3);
  }
  .side__link.is-active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .side__foot {
    margin-top: auto;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
  }
  .side__bal {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .side__bal strong {
    font-size: 19px;
  }
  .tabbar {
    display: none;
  }
  .main {
    min-height: 100dvh;
  }
}

@media (min-width: 1400px) {
  .shell {
    grid-template-columns: 248px 1fr;
  }
}
</style>
