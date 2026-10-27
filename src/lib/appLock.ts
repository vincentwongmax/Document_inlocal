/**
 * 0.1.83：應用鎖（Face ID／PIN 碼）—— 核心邏輯。
 *
 * ⚠⚠ 這是「畫面上鎖」，**不是資料加密**：記帳資料仍然以明文放在 localStorage／IndexedDB，
 *   懂 devtools 的人可以繞過。它的目的只有一個：手機被別人拿到、打開 App 時先擋一層。
 *
 * 設計（依使用者 2026-10-27 的選擇）：
 *   - PIN 碼 **4–8 位數字**（長度自選）
 *   - **切回前台超過 1 分鐘**才重新上鎖（短暫切出去再回來不用重解）
 *   - Face ID 模式**一律保留 PIN 備用**（Face ID 失敗可以改用 PIN）
 *   - 忘記 PIN → 用設定時產生的**恢復碼**解鎖（沒有「一鍵重置」）
 *   - Face ID 只在 iPhone／iPad 的 PWA 提供；桌面與其他裝置只有 PIN
 *
 * Face ID 走 WebAuthn（`navigator.credentials`）呼叫系統的平台驗證器，
 * iOS 上就是 Face ID／Touch ID。憑證留在這台裝置，localStorage 只存 credential id，
 * 不連任何伺服器。
 */
import { computed, reactive, ref } from 'vue'
import { isStandalone } from './pwa'

/** localStorage 鍵（App 層級；切錢包不影響） */
const KEY = 'mop-ledger.lock.v1'

/** 切回前台超過這個時間才重新上鎖（使用者選的：1 分鐘） */
export const RELOCK_MS = 60_000

export type LockMode = 'faceid' | 'pin'

export interface LockConfig {
  enabled: boolean
  mode: LockMode
  /** PBKDF2-SHA256 的 PIN 雜湊（base64） */
  pinHash: string
  pinSalt: string
  /** PIN 長度（4–8）——鎖屏用幾顆點、打到第幾位才自動送出 */
  pinLen: number
  /** Face ID 的 WebAuthn credential rawId（base64）；沒啟用 Face ID 時是 null */
  credId: string | null
  recoveryHash: string
  recoverySalt: string
  updatedAt: number
}

/* ── 反應式狀態 ──────────────────────────────────────────── */

const state = reactive<{ cfg: LockConfig | null; unlocked: boolean }>({
  cfg: null,
  unlocked: false,
})

/** 目前設定（null＝沒設過／已關閉） */
export const lock = state
/** 有沒有啟用鎖 */
export const lockEnabled = computed(() => !!state.cfg?.enabled)
/** 現在是不是鎖著——`App.vue` 用它決定要不要蓋上鎖屏 */
export const isLocked = computed(() => !!state.cfg?.enabled && !state.unlocked)
/** 目前的解鎖方式 */
export const lockMode = computed<LockMode>(() => state.cfg?.mode ?? 'pin')
/** PIN 長度（鎖屏畫幾顆點） */
export const pinLength = computed(() => state.cfg?.pinLen ?? 4)

/* ── 平台判斷 ────────────────────────────────────────────── */

/** 是不是 iOS／iPadOS（含 iPad 的桌機模式：MacIntel ＋ 多點觸控） */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const touchPoints = navigator.maxTouchPoints ?? 0
  return /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && touchPoints > 1)
}

/** 這台裝置有沒有可用的「平台驗證器」（Face ID／Touch ID） */
export const platformAuthAvailable = ref(false)

/** 是不是 iPhone／iPad 的 PWA（Face ID 只在這邊提供） */
export const isIOSPwa = computed(() => isIOSDevice() && isStandalone.value)
/** Face ID 選項要不要出現 */
export const faceIdAvailable = computed(() => isIOSPwa.value && platformAuthAvailable.value)

/** 問瀏覽器平台驗證器可不可用（非同步；失敗就當不可用） */
export async function detectPlatformAuth(): Promise<boolean> {
  try {
    const P = window.PublicKeyCredential as
      | { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> }
      | undefined
    if (!P || typeof P.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      platformAuthAvailable.value = false
      return false
    }
    platformAuthAvailable.value = !!(await P.isUserVerifyingPlatformAuthenticatorAvailable())
  } catch {
    platformAuthAvailable.value = false
  }
  return platformAuthAvailable.value
}

/* ── 編碼／雜湊小工具 ────────────────────────────────────── */

const enc = new TextEncoder()

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randBytes(n: number): Uint8Array {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return a
}

/**
 * PBKDF2-SHA256。
 * ⚠ `crypto.subtle` 只在安全來源（HTTPS／localhost）才有——本 App 兩個都符合。
 */
const PBKDF2_ITERATIONS = 120_000

async function derive(secret: string, salt: Uint8Array): Promise<string> {
  if (!crypto?.subtle) throw new Error('這個瀏覽器不支援安全雜湊（需要 HTTPS）')
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  )
  return toB64(new Uint8Array(bits))
}

/* ── PIN ─────────────────────────────────────────────────── */

/** 檢查 PIN 格式；回傳錯誤訊息（null＝OK） */
export function pinError(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'PIN 碼只能是數字'
  if (pin.length < 4 || pin.length > 8) return 'PIN 碼要 4–8 位'
  return null
}

/** 比對 PIN */
export async function verifyPin(pin: string): Promise<boolean> {
  const c = state.cfg
  if (!c?.pinHash) return false
  try {
    return (await derive(pin, fromB64(c.pinSalt))) === c.pinHash
  } catch {
    return false
  }
}

/* ── 恢復碼 ──────────────────────────────────────────────── */

/** 去掉容易看錯的 I／O／0／1 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const RECOVERY_LENGTH = 10

/** 產生一組新的恢復碼（顯示成 `ABCDE-FGHJK`） */
export function newRecoveryCode(): string {
  const bytes = randBytes(RECOVERY_LENGTH)
  let s = ''
  for (const b of bytes) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

/** 恢復碼正規化（忽略大小寫、空白、連字號） */
export function normRecovery(code: string): string {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** 檢查恢復碼格式；回傳錯誤訊息（null＝OK） */
export function recoveryError(code: string): string | null {
  if (normRecovery(code).length !== RECOVERY_LENGTH) return '恢復碼格式不正確'
  return null
}

/** 比對恢復碼 */
export async function verifyRecovery(code: string): Promise<boolean> {
  const c = state.cfg
  if (!c?.recoveryHash || !c.recoverySalt) return false
  try {
    return (await derive(normRecovery(code), fromB64(c.recoverySalt))) === c.recoveryHash
  } catch {
    return false
  }
}

/* ── 讀寫設定 ────────────────────────────────────────────── */

function load(): LockConfig | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<LockConfig>
    if (!c || c.enabled !== true || !c.pinHash || !c.pinSalt || !c.pinLen) return null
    return {
      enabled: true,
      mode: c.mode === 'faceid' ? 'faceid' : 'pin',
      pinHash: c.pinHash,
      pinSalt: c.pinSalt,
      pinLen: c.pinLen,
      credId: typeof c.credId === 'string' && c.credId ? c.credId : null,
      recoveryHash: c.recoveryHash ?? '',
      recoverySalt: c.recoverySalt ?? '',
      updatedAt: c.updatedAt ?? 0,
    }
  } catch {
    return null
  }
}

function save(c: LockConfig | null): void {
  try {
    if (!c) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* 隱私模式等 → 記不住就記不住，不影響其他功能 */
  }
  state.cfg = c
}

/* ── 上鎖／解鎖 ──────────────────────────────────────────── */

/** 解鎖（只記在記憶體：重新載入頁面或重開 App 一律重新上鎖） */
export function markUnlocked(): void {
  state.unlocked = true
}

/** 立刻上鎖 */
export function lockNow(): void {
  state.unlocked = false
}

/** 關閉應用鎖（清除設定，記帳資料不動） */
export function disableLock(): void {
  save(null)
  state.unlocked = true
}

/** 儲存／變更 PIN（`extra` 可以順便改模式或 Face ID 憑證） */
export async function setPin(pin: string, extra: Partial<LockConfig> = {}): Promise<void> {
  const err = pinError(pin)
  if (err) throw new Error(err)
  const salt = randBytes(16)
  const base: LockConfig = state.cfg ?? {
    enabled: true,
    mode: 'pin',
    pinHash: '',
    pinSalt: '',
    pinLen: pin.length,
    credId: null,
    recoveryHash: '',
    recoverySalt: '',
    updatedAt: 0,
  }
  save({
    ...base,
    ...extra,
    enabled: true,
    pinHash: await derive(pin, salt),
    pinSalt: toB64(salt),
    pinLen: pin.length,
    updatedAt: Date.now(),
  })
}

/** 換一組恢復碼；回傳新碼（呼叫端負責顯示一次） */
export async function resetRecoveryCode(): Promise<string> {
  const c = state.cfg
  if (!c) throw new Error('尚未啟用應用鎖')
  const code = newRecoveryCode()
  const salt = randBytes(16)
  save({
    ...c,
    recoveryHash: await derive(normRecovery(code), salt),
    recoverySalt: toB64(salt),
    updatedAt: Date.now(),
  })
  return code
}

/** 設定 Face ID 憑證（同時把模式切成 faceid） */
export function attachFaceId(credId: string): void {
  const c = state.cfg
  if (!c) return
  save({ ...c, credId, mode: 'faceid', updatedAt: Date.now() })
}

/** 關閉 Face ID（退回 PIN 模式；PIN 與恢復碼不動） */
export function detachFaceId(): void {
  const c = state.cfg
  if (!c) return
  save({ ...c, credId: null, mode: 'pin', updatedAt: Date.now() })
}

/* ── Face ID（WebAuthn） ─────────────────────────────────── */

function credErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError') return '已取消，或 Face ID 沒有通過'
  if (name === 'NotSupportedError') return '此裝置不支援 Face ID'
  if (name === 'SecurityError') return '這個網址不允許使用 Face ID（需要 HTTPS）'
  if (name === 'InvalidStateError') return '這台裝置已經設定過 Face ID'
  return 'Face ID 沒有完成，請再試一次'
}

/** 註冊 Face ID（系統會跳 Face ID 確認） */
export async function registerFaceId(): Promise<{
  ok: boolean
  credId?: string
  error?: string
}> {
  try {
    const P = window.PublicKeyCredential
    if (!P) return { ok: false, error: '此裝置不支援 Face ID' }
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randBytes(32) as unknown as BufferSource,
        rp: { name: '記帳本', id: location.hostname },
        user: {
          id: randBytes(16) as unknown as BufferSource,
          name: 'mop-ledger',
          displayName: '記帳本',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 60_000,
        attestation: 'none',
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
          requireResidentKey: false,
        },
      },
    })) as PublicKeyCredential | null
    if (!cred) return { ok: false, error: '沒有完成 Face ID 設定' }
    return { ok: true, credId: toB64(new Uint8Array(cred.rawId)) }
  } catch (e) {
    return { ok: false, error: credErrorMessage(e) }
  }
}

/** 用 Face ID 驗證（系統會跳 Face ID 確認） */
export async function verifyFaceId(): Promise<{ ok: boolean; error?: string }> {
  const c = state.cfg
  if (!c?.credId) return { ok: false, error: '尚未設定 Face ID' }
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: randBytes(32) as unknown as BufferSource,
        allowCredentials: [
          { type: 'public-key', id: fromB64(c.credId) as unknown as BufferSource },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    return res ? { ok: true } : { ok: false, error: 'Face ID 沒有完成' }
  } catch (e) {
    return { ok: false, error: credErrorMessage(e) }
  }
}

/* ── 初始化 ──────────────────────────────────────────────── */

/** 上次離開前台的時間（用 `performance` 以外的 `Date.now()`，跨睡眠也正確） */
let hiddenAt = 0

function onVisibility(): void {
  if (!state.cfg?.enabled) return
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    return
  }
  if (document.visibilityState === 'visible') {
    // 只有「離開超過 1 分鐘」才重新上鎖；短暫切出去（例如看一則通知）不用重解
    if (hiddenAt && Date.now() - hiddenAt >= RELOCK_MS) state.unlocked = false
    hiddenAt = 0
  }
}

let inited = false

/**
 * 初始化：載入設定、接上前景／背景監聽、問平台驗證器。
 *
 * ⚠ `state.cfg` 是在**同步**阶段載入的 → 第一次畫面渲染就已經是「鎖著」，
 *   不會先閃一下內容再蓋上鎖屏。
 */
export function initAppLock(): void {
  if (inited) return
  inited = true
  state.cfg = load()
  state.unlocked = !state.cfg?.enabled
  document.addEventListener('visibilitychange', onVisibility)
  void detectPlatformAuth()
}

/** 解鎖方式的顯示文字 */
export function modeLabel(mode: LockMode): string {
  return mode === 'faceid' ? 'Face ID ＋ PIN 碼' : 'PIN 碼'
}
