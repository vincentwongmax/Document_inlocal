import { ref } from 'vue'
import { IMG_MIME, fileFromImageEl, filesFromMarkup, pastedFile } from '@/lib/clipboard'

/**
 * 「貼上圖片」的共用例行（記帳頁的收據圖片區塊與記錄明細共用同一份）。
 *
 * 情境：從 WeChat／相簿／Messenger 複製一張圖，回到 App 貼上。
 *
 * 三條路並行，因為沒有任何一條在 iOS 上單獨可靠：
 *
 *  ① 剪貼簿裡真的有「圖片檔」（`dt.files`／`dt.items`）
 *     → 直接用，最乾淨。桌機與 Android 主要走這條。
 *
 *  ② **讓瀏覽器自己貼進來，再從 DOM 把 `<img>` 讀出來**（iOS 的主力）
 *     → WebKit 常常只給 `text/html`，而且裡面的 src 是 `applewebdata://`
 *       這類只有它自己認得的網址 —— 我們 `fetch()` 抓不到，但瀏覽器貼進 DOM 的圖
 *       一定載得起來。所以這裡**刻意不** preventDefault：讓系統把圖插進那塊
 *       可編輯的接收面，我們再去 DOM 裡把圖讀出來，最後把內容清乾淨。
 *
 *  ③ 自己解析 `text/html` 裡的 `blob:`／`data:` 網址（備援）
 *     → 有些瀏覽器根本不會把圖插進 DOM，這時至少還有原本那條路。
 *
 * 為什麼接收面要是一塊看不見的 `contenteditable`：
 *   iOS 的 WebKit 只在「可編輯元素取得焦點」時才發 `paste` 事件，
 *   所以要在磚上鋪一層可編輯面，點磚＝把焦點放上去，接著長按選「貼上」。
 *   （`navigator.clipboard.read()` 只是加分項，Safari 支援反覆，不能只靠它。）
 */
export interface PasteImagesOptions {
  /** 接收貼上的那塊可編輯面（點磚時會把焦點放在它上面） */
  target: () => HTMLElement | null
  /** 整顆磚（iOS 有時會把貼上改派到磚身上，兩個都要找） */
  tile?: () => HTMLElement | null
  /** 真的收到圖了 */
  onFiles: (files: File[]) => void
  /** 三條路都沒有圖（通常＝剪貼簿裡不是圖片） */
  onNothing?: () => void
}

export function usePasteImages(o: PasteImagesOptions) {
  /** 按過「貼上圖片」之後要維持強調，提示使用者「現在可以長按這裡」 */
  const armed = ref(false)
  /** 正在等瀏覽器把內容貼進來（這段時間不要去清接收面） */
  const collecting = ref(false)

  /** 同步判斷剪貼簿裡有沒有圖片**檔案**（① 那條路） */
  function imageFilesIn(dt: DataTransfer | null): File[] {
    if (!dt) return []
    const out: File[] = []
    for (const f of Array.from(dt.files ?? [])) if (IMG_MIME.test(f.type)) out.push(f)
    if (out.length) return out
    for (const it of Array.from(dt.items ?? [])) {
      if (it.kind === 'file' && IMG_MIME.test(it.type)) {
        const f = it.getAsFile()
        if (f) out.push(f)
      }
    }
    return out
  }

  /** 這個貼上是不是衝著我們這顆磚來的（iOS 會把事件改派到父層，所以要放寬認定） */
  function onTile(t: EventTarget | null): boolean {
    const el = o.target()
    if (!el) return false
    if (t === el) return true
    if (t instanceof Node && el.contains(t)) return true
    if (document.activeElement === el) return true
    const tile = o.tile?.()
    if (tile && t instanceof Node && tile.contains(t)) return true
    return false
  }

  /** paste 的統一入口（呼叫端掛在 document 的 capture 階段） */
  function onPaste(e: ClipboardEvent) {
    const dt = e.clipboardData

    // ① 有圖片檔 → 直接收（並擋掉預設行為，免得系統又把它插進 DOM 一次）
    const files = imageFilesIn(dt)
    if (files.length) {
      e.preventDefault()
      armed.value = false
      o.onFiles(files)
      return
    }

    // ②③ 沒有檔案：只有「貼在我們這顆磚上」才處理，其他地方（備註欄）要能正常貼文字
    if (!onTile(e.target)) return

    // ⚠ DataTransfer 過了這一輪就可能不能再讀，先把字串抓起來
    let html = ''
    let text = ''
    try {
      html = dt?.getData('text/html') ?? ''
      text = dt?.getData('text/plain') ?? ''
    } catch {
      /* 讀不到就當沒有，交給 DOM 那條路 */
    }

    collecting.value = true
    // ⚠ 刻意**不** preventDefault：讓系統把內容貼進那塊可編輯面，
    //   下一步（②）才有 `<img>` 可以撈。
    setTimeout(() => void harvest(html, text), 0)
  }

  /** ② 從 DOM 撈剛剛被貼進來的圖；撈不到就退回 ③ 自己解析字串 */
  async function harvest(html: string, text: string) {
    const target = o.target()
    const tile = o.tile?.()
    // 接收面通常是磚的子元素 → 兩個都找會重複，用 Set 去重
    const roots: HTMLElement[] = []
    if (target) roots.push(target)
    if (tile && tile !== target) roots.push(tile)

    const seen = new Set<HTMLImageElement>()
    for (const r of roots) for (const im of Array.from(r.querySelectorAll('img'))) seen.add(im)
    const imgs = [...seen]

    const files: File[] = []
    for (let i = 0; i < imgs.length; i++) {
      const f = await fileFromImageEl(imgs[i], files.length, imgs.length)
      if (f) files.push(f)
    }

    /** 收完圖就把現場清乾淨。
     *  ⚠⚠ 只能「移除 `<img>` ＋ 清掉文字節點」，**不可以**對整顆磚做 `textContent = ''`：
     *     那會連接收面自己（還有圖示、文字標籤）一起刪掉，磚從此再也收不到貼上。 */
    for (const r of roots) for (const im of Array.from(r.querySelectorAll('img'))) im.remove()
    if (target) {
      for (const n of Array.from(target.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) n.remove()
      }
    }
    collecting.value = false

    if (files.length) {
      armed.value = false
      o.onFiles(files)
      return
    }

    // ③ 備援：自己解析 text/html
    const fallback = await filesFromMarkup(html, text)
    if (fallback.length) {
      armed.value = false
      o.onFiles(fallback)
      return
    }
    o.onNothing?.()
  }

  /**
   * 點「貼上圖片」磚。
   * ⚠ 聚焦要**同步**做（不能等 await 之後才做）：iOS 只在使用者手勢的同步階段認焦點，
   *   而且不依賴剪貼簿 API 的成功與否——先站穩「長按可以貼」這條保證路徑，再試加分項。
   */
  function pasteFromClipboard() {
    armed.value = true
    o.target()?.focus()
    void readClipboardApi()
  }

  /** 加分項：支援的瀏覽器點一下就貼好（Safari 對它的支援反覆，失敗是常態） */
  async function readClipboardApi() {
    if (!navigator.clipboard?.read) return
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const it of items) {
        const type = it.types.find((t) => IMG_MIME.test(t))
        if (!type) continue
        files.push(pastedFile(await it.getType(type), files.length, items.length))
      }
      if (!files.length) return // 沒圖就靜默：長按那條路還是通的
      armed.value = false
      o.onFiles(files)
    } catch {
      /* 未授權／不支援 → 就這樣，使用者已經可以長按貼上了 */
    }
  }

  /** 有人真的在那層隱形面上打字就打掉（收圖期間除外） */
  function onInput(e: Event) {
    if (collecting.value) return
    const el = e.target as HTMLElement
    if (el.textContent) el.textContent = ''
  }

  return { armed, collecting, onPaste, onInput, pasteFromClipboard }
}
