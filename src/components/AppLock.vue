<script setup lang="ts">
/**
 * 0.1.83：應用鎖的鎖屏。
 *
 * 蓋在整個 App 上面（`position: fixed; z-index: 2000`），不透明，
 * 所以鎖著的時候看不到、也點不到後面的任何內容。
 *
 * 三種畫面：
 *   - faceid：Face ID 模式（**畫面一出現就自動跳系統 Face ID**，下面那顆按鈕只是重試用；
 *     另保留「改用 PIN 碼」與「忘記 PIN」）
 *   - pin：數字鍵盤（PIN 長度已知 → 打到第 N 位就自動送出）
 *   - recovery：輸入恢復碼
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  autoFaceIdAllowed,
  detectPlatformAuth,
  isIOSDevice,
  lockMode,
  markUnlocked,
  pinLength,
  platformAuthAvailable,
  verifyFaceId,
  verifyPin,
  verifyRecovery,
} from '@/lib/appLock'

type Stage = 'faceid' | 'pin' | 'recovery'
const stage = ref<Stage>(lockMode.value === 'faceid' ? 'faceid' : 'pin')

const pin = ref('')
const recovery = ref('')
const busy = ref(false)
const err = ref('')
const shake = ref(false)

const dots = computed(() => Array.from({ length: pinLength.value }, (_, i) => i < pin.value.length))

function wiggle(msg: string) {
  err.value = msg
  shake.value = true
  window.setTimeout(() => {
    shake.value = false
  }, 420)
}

async function submitPin() {
  if (busy.value || pin.value.length !== pinLength.value) return
  busy.value = true
  const ok = await verifyPin(pin.value)
  busy.value = false
  if (ok) {
    markUnlocked()
    return
  }
  pin.value = ''
  wiggle('PIN 碼不正確')
}

function tap(d: string) {
  if (busy.value || pin.value.length >= pinLength.value) return
  err.value = ''
  pin.value += d
  if (pin.value.length === pinLength.value) void submitPin()
}

function backspace() {
  if (busy.value) return
  pin.value = pin.value.slice(0, -1)
  err.value = ''
}

/*
 * Face ID 驗證。
 *
 * 0.1.84：使用者要求「打開 App 就 Face ID，中間不要任何步驟」→ 改成**鎖屏一出現就自動呼叫**
 * （見下面 onMounted）。技術依據：
 *   - iOS 17.4 起 Apple 已**取消** WebAuthn 需要使用者手勢的限制（改成速率限制）
 *   - iOS 16～17.3 每次「頁面載入」仍允許**一次**不用手勢的 credentials.get()
 *     → 所以自動嘗試只做一次，失敗就交給下面那顆按鈕（手勢觸發，一定合法）
 *   - ⚠ SPA 內這個「免費額度」不會重置（只有整頁重新載入才會）→ 切勿重複自動嘗試
 *
 * ⚠ 有些環境（沒有驗證器）`credentials.get` 會一直不回來 → 加一個安全網，
 *   90 秒後把按鈕恢復成可按（真正的成功結果照樣會解鎖）。
 */
async function tryFaceId(fromAuto = false) {
  if (busy.value) return
  busy.value = true
  err.value = ''
  const safety = window.setTimeout(() => {
    busy.value = false
  }, 90_000)
  const r = await verifyFaceId()
  window.clearTimeout(safety)
  busy.value = false
  if (r.ok) {
    markUnlocked()
    return
  }
  // 自動嘗試失敗（舊版 iOS 不允許無手勢呼叫、或使用者按了取消）不要吵人：
  // 安靜地把畫面留給下面那顆按鈕，點一下就會重新跳系統 Face ID。
  if (!fromAuto) err.value = r.error ?? 'Face ID 沒有完成'
}

/** 按鈕點擊（明確傳 false；不能直接綁 tryFaceId，否則 MouseEvent 會被當成 true） */
function onFaceIdClick() {
  void tryFaceId(false)
}

let autoTimer = 0

onMounted(() => {
  // 只有 Face ID 模式才自動跳系統面板（PIN 模式沒有東西可自動）
  if (stage.value !== 'faceid') return
  // 剛按完「立即上鎖」→ 不要一鎖就自動解開
  if (!autoFaceIdAllowed()) return

  const run = async () => {
    if (document.visibilityState !== 'visible') return
    /*
     * iOS 一定拿得到平台驗證器（Face ID 憑證就是在這裡註冊的），所以**不 await**，
     * 讓 credentials.get() 前面不要多一個非同步步驟（Safari 對這點很挑）。
     * 其他平台（桌機／Android）先確認有沒有平台驗證器，沒有就別自動跳——
     * 否則會留下一個永遠轉圈的「驗證中…」。
     */
    if (!isIOSDevice() && !platformAuthAvailable.value) {
      if (!(await detectPlatformAuth())) return
    }
    // 讓鎖屏先畫出來，再跳系統面板（使用者看得到「已鎖定」再看到 Face ID）
    autoTimer = window.setTimeout(() => void tryFaceId(true), 160)
  }

  if (document.visibilityState === 'visible') void run()
  else document.addEventListener('visibilitychange', run, { once: true })
})

onBeforeUnmount(() => {
  window.clearTimeout(autoTimer)
})

async function submitRecovery() {
  if (busy.value || !recovery.value.trim()) return
  busy.value = true
  const ok = await verifyRecovery(recovery.value)
  busy.value = false
  if (ok) {
    markUnlocked()
    return
  }
  recovery.value = ''
  wiggle('恢復碼不正確')
}

function toPin() {
  stage.value = 'pin'
  pin.value = ''
  err.value = ''
}

function toFaceId() {
  stage.value = 'faceid'
  err.value = ''
}

function toRecovery() {
  stage.value = 'recovery'
  recovery.value = ''
  err.value = ''
}
</script>

<template>
  <div class="lock" role="dialog" aria-modal="true" aria-label="應用鎖">
    <div class="lock__inner" :class="{ 'is-shake': shake }">
      <div class="lock__brand">
        <span class="lock__mark" aria-hidden="true">記</span>
        <span class="lock__name">記帳本</span>
      </div>

      <!-- Face ID -->
      <template v-if="stage === 'faceid'">
        <p class="lock__hint">{{ busy ? '正在用 Face ID 辨識…' : '已鎖定' }}</p>
        <button class="lock__face" type="button" :disabled="busy" @click="onFaceIdClick">
          <svg class="lock__faceicon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5A2.5 2.5 0 0 1 18.5 21H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"
            />
            <path d="M9 9.6v1.6M15 9.6v1.6M9.4 14.8c.7.7 1.7 1.1 2.6 1.1s1.9-.4 2.6-1.1" />
          </svg>
          <span>{{ busy ? '驗證中…' : '用 Face ID 解鎖' }}</span>
        </button>
        <p class="lock__err" role="alert">{{ err }}</p>
        <div class="lock__links">
          <button type="button" class="lock__link" @click="toPin">改用 PIN 碼</button>
          <span class="lock__dotsep" aria-hidden="true">·</span>
          <button type="button" class="lock__link" @click="toRecovery">忘記 PIN</button>
        </div>
      </template>

      <!-- PIN -->
      <template v-else-if="stage === 'pin'">
        <p class="lock__hint">輸入 PIN 碼</p>
        <div class="lock__dots" :aria-label="`已輸入 ${pin.length} 位，共 ${pinLength} 位`">
          <span v-for="(on, i) in dots" :key="i" class="lock__dot" :class="{ 'is-on': on }" />
        </div>
        <p class="lock__err" role="alert">{{ err }}</p>
        <div class="lock__pad">
          <button
            v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
            :key="d"
            type="button"
            class="lock__key"
            @click="tap(d)"
          >
            {{ d }}
          </button>
          <button
            type="button"
            class="lock__key lock__key--fn"
            :disabled="!pin || busy"
            aria-label="刪除"
            @click="backspace"
          >
            ⌫
          </button>
          <button type="button" class="lock__key" @click="tap('0')">0</button>
          <span class="lock__key lock__key--ghost" aria-hidden="true" />
        </div>
        <div class="lock__links">
          <button v-if="lockMode === 'faceid'" type="button" class="lock__link" @click="toFaceId">
            用 Face ID
          </button>
          <span v-if="lockMode === 'faceid'" class="lock__dotsep" aria-hidden="true">·</span>
          <button type="button" class="lock__link" @click="toRecovery">忘記 PIN</button>
        </div>
      </template>

      <!-- 恢復碼 -->
      <template v-else>
        <p class="lock__hint">輸入恢復碼</p>
        <input
          v-model="recovery"
          class="lock__rc"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="13"
          placeholder="ABCDE-FGHJK"
          aria-label="恢復碼"
          @keydown.enter.prevent="submitRecovery"
        />
        <p class="lock__err" role="alert">{{ err }}</p>
        <button
          class="lock__btn"
          type="button"
          :disabled="busy || !recovery.trim()"
          @click="submitRecovery"
        >
          {{ busy ? '驗證中…' : '解鎖' }}
        </button>
        <div class="lock__links">
          <button type="button" class="lock__link" @click="toPin">返回輸入 PIN</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lock {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 22px
    calc(24px + env(safe-area-inset-bottom, 0px));
  background: var(--bg);
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
}
.lock__inner {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 13px;
}
.lock__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.lock__mark {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: var(--text);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 21px;
  font-weight: 650;
}
.lock__name {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.lock__hint {
  margin: 0;
  font-size: 13.5px;
  color: var(--text-2);
}
.lock__face {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 268px;
  padding: 20px 16px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
  color: var(--accent);
  font-size: 15px;
  font-weight: 650;
  cursor: pointer;
  transition: transform 0.06s;
}
.lock__face:active {
  transform: scale(0.985);
}
.lock__face:disabled {
  opacity: 0.6;
}
.lock__faceicon {
  width: 40px;
  height: 40px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.lock__dots {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  min-height: 14px;
}
.lock__dot {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1.6px solid var(--line-strong);
  transition:
    background 0.12s,
    border-color 0.12s;
}
.lock__dot.is-on {
  background: var(--accent);
  border-color: var(--accent);
}
.lock__err {
  margin: 0;
  min-height: 17px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--expense);
  text-align: center;
}
.lock__pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  width: 100%;
  max-width: 268px;
}
.lock__key {
  height: 58px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  font-family: var(--font-num);
  font-size: 23px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.lock__key:active {
  background: var(--surface-3);
}
.lock__key--fn {
  font-size: 18px;
  color: var(--text-2);
}
.lock__key--fn:disabled {
  opacity: 0.4;
}
.lock__key--ghost {
  border: 0;
  background: transparent;
  pointer-events: none;
}
.lock__links {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.lock__link {
  padding: 4px 2px;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.lock__dotsep {
  color: var(--text-3);
}
.lock__rc {
  width: 100%;
  max-width: 268px;
  height: 50px;
  padding: 0 14px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--surface);
  font-family: var(--font-num);
  /* ⚠ ≥16px：iOS 聚焦到字太小的輸入框會把整頁放大 */
  font-size: 17px;
  letter-spacing: 2px;
  text-align: center;
  text-transform: uppercase;
}
.lock__rc:focus {
  outline: none;
  border-color: var(--accent);
}
.lock__btn {
  width: 100%;
  max-width: 268px;
  height: 48px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-size: 15px;
  font-weight: 650;
  cursor: pointer;
}
.lock__btn:disabled {
  opacity: 0.45;
}
.is-shake {
  animation: lockShake 0.4s;
}
@keyframes lockShake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-7px);
  }
  40% {
    transform: translateX(7px);
  }
  60% {
    transform: translateX(-5px);
  }
  80% {
    transform: translateX(5px);
  }
}
</style>
