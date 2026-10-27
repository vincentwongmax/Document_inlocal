<script setup lang="ts">
/**
 * 0.1.83：設定頁的「應用鎖」區塊。
 *
 * 所有需要「目前 PIN」的操作（變更 PIN、開關 Face ID、重產恢復碼、關閉應用鎖）
 * 都會先驗一次目前的 PIN——避免有人拿到「已經解鎖的手機」就順手把鎖拆掉／換成自己的 Face ID。
 * 流程一律走 SweetAlert（與全站其他彈窗一致），不在頁面上塞一堆輸入框。
 */
import { ref } from 'vue'
import { confirmDialog, notify, askPinDialog, showRecoveryCodeDialog } from '@/lib/alerts'
import {
  attachFaceId,
  detachFaceId,
  disableLock,
  faceIdAvailable,
  lockEnabled,
  lockMode,
  lockNow,
  markUnlocked,
  modeLabel,
  registerFaceId,
  resetRecoveryCode,
  setPin,
  verifyPin,
} from '@/lib/appLock'

const busy = ref(false)

/** 驗目前的 PIN；回傳 true＝通過 */
async function requirePin(title = '輸入目前的 PIN 碼'): Promise<boolean> {
  const pin = await askPinDialog({ title, confirmText: '確定' })
  if (!pin) return false
  const ok = await verifyPin(pin)
  if (!ok) notify('PIN 碼不正確', 'error')
  return ok
}

/** 問兩次新 PIN（4–8 位數字）；回傳 null＝取消或兩次不一致 */
async function askNewPin(): Promise<string | null> {
  const a = await askPinDialog({
    title: '設定 PIN 碼',
    message: '4–8 位數字。之後在鎖屏用它解鎖。',
    confirmText: '下一步',
  })
  if (!a) return null
  const b = await askPinDialog({
    title: '再輸入一次',
    message: '確認剛才的 PIN 碼。',
    confirmText: '確定',
  })
  if (!b) return null
  if (a !== b) {
    notify('兩次輸入的 PIN 碼不一樣，請重新設定', 'error')
    return null
  }
  return a
}

async function enable() {
  if (busy.value) return
  busy.value = true
  try {
    const pin = await askNewPin()
    if (!pin) return
    await setPin(pin)
    const code = await resetRecoveryCode()
    await showRecoveryCodeDialog(code)
    markUnlocked()

    if (faceIdAvailable.value) {
      const r = await confirmDialog({
        title: '同時啟用 Face ID？',
        message: '這台 iPhone／iPad 可以用 Face ID 解鎖。之後 Face ID 失敗時仍可改用 PIN 碼。',
        confirmText: '啟用 Face ID',
        cancelText: '只用 PIN',
      })
      if (r === 'confirm') {
        const reg = await registerFaceId()
        if (reg.ok && reg.credId) {
          attachFaceId(reg.credId)
          notify('已啟用應用鎖（Face ID ＋ PIN 碼）', 'ok')
          return
        }
        notify(reg.error ?? 'Face ID 沒有完成，已保留 PIN 碼解鎖', 'warn')
      }
    }
    notify('已啟用應用鎖', 'ok')
  } catch (e) {
    notify(e instanceof Error ? e.message : '啟用失敗，請再試一次', 'error')
  } finally {
    busy.value = false
  }
}

async function changePin() {
  if (busy.value) return
  busy.value = true
  try {
    if (!(await requirePin('變更 PIN 碼前，請輸入目前的 PIN 碼'))) return
    const pin = await askNewPin()
    if (!pin) return
    await setPin(pin)
    notify('已更新 PIN 碼', 'ok')
  } catch (e) {
    notify(e instanceof Error ? e.message : '更新失敗，請再試一次', 'error')
  } finally {
    busy.value = false
  }
}

async function toggleFaceId() {
  if (busy.value) return
  busy.value = true
  try {
    if (lockMode.value === 'faceid') {
      if (!(await requirePin('關閉 Face ID 前，請輸入目前的 PIN 碼'))) return
      detachFaceId()
      notify('已關閉 Face ID，之後用 PIN 碼解鎖', 'ok')
      return
    }
    if (!faceIdAvailable.value) {
      notify('這台裝置不支援 Face ID（只有 iPhone／iPad 的 PWA 可用）', 'warn')
      return
    }
    if (!(await requirePin('啟用 Face ID 前，請輸入目前的 PIN 碼'))) return
    const r = await registerFaceId()
    if (r.ok && r.credId) {
      attachFaceId(r.credId)
      notify('已啟用 Face ID（PIN 碼仍可備用）', 'ok')
    } else {
      notify(r.error ?? 'Face ID 沒有完成', 'warn')
    }
  } finally {
    busy.value = false
  }
}

async function regenRecovery() {
  if (busy.value) return
  busy.value = true
  try {
    if (!(await requirePin('重新產生恢復碼前，請輸入目前的 PIN 碼'))) return
    const code = await resetRecoveryCode()
    await showRecoveryCodeDialog(code)
  } catch (e) {
    notify(e instanceof Error ? e.message : '產生失敗，請再試一次', 'error')
  } finally {
    busy.value = false
  }
}

async function disable() {
  if (busy.value) return
  busy.value = true
  try {
    if (!(await requirePin('關閉應用鎖前，請輸入目前的 PIN 碼'))) return
    const r = await confirmDialog({
      title: '關閉應用鎖？',
      message: '之後打開 App 就不會再要求解鎖。記帳資料不受影響。',
      confirmText: '關閉',
      danger: true,
    })
    if (r !== 'confirm') return
    disableLock()
    notify('已關閉應用鎖', 'ok')
  } finally {
    busy.value = false
  }
}

/** 立即上鎖（方便使用者當場測試） */
function onLockNow() {
  lockNow()
}
</script>

<template>
  <div class="panel">
    <div class="rows">
      <div class="row">
        <span>
          應用鎖
          <small class="tiny muted">
            開啟後，重新打開 App 或切回前台超過 1 分鐘要先解鎖
          </small>
        </span>
        <span class="tag" :class="lockEnabled ? 'tag--ok' : ''">
          {{ lockEnabled ? '已啟用' : '未啟用' }}
        </span>
      </div>
      <div v-if="lockEnabled" class="row">
        <span>解鎖方式</span>
        <span class="tag">{{ modeLabel(lockMode) }}</span>
      </div>
    </div>

    <div class="lk__acts">
      <template v-if="!lockEnabled">
        <button class="btn btn--primary" :disabled="busy" @click="enable">啟用應用鎖</button>
      </template>
      <template v-else>
        <button class="btn" :disabled="busy" @click="onLockNow">立即上鎖</button>
        <button class="btn" :disabled="busy" @click="changePin">變更 PIN 碼</button>
        <button v-if="faceIdAvailable" class="btn" :disabled="busy" @click="toggleFaceId">
          {{ lockMode === 'faceid' ? '關閉 Face ID' : '啟用 Face ID' }}
        </button>
        <button class="btn" :disabled="busy" @click="regenRecovery">重新產生恢復碼</button>
        <button class="btn btn--danger" :disabled="busy" @click="disable">關閉應用鎖</button>
      </template>
    </div>

    <p class="tiny muted lk__note">
      <template v-if="faceIdAvailable">
        Face ID 只在 iPhone／iPad 的 PWA 提供；Face ID 失敗時可以改用 PIN 碼。
      </template>
      <template v-else>
        這台裝置不支援 Face ID，只能用 PIN 碼（Face ID 只在 iPhone／iPad 的 PWA 提供）。
      </template>
      應用鎖是「畫面上鎖」，不是資料加密——資料仍然存在這台裝置上。
    </p>
  </div>
</template>

<style scoped>
.lk__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.lk__acts .btn {
  flex: 1 1 auto;
  min-width: 120px;
}
.lk__note {
  margin-top: 10px;
  line-height: 1.6;
}
</style>
