<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Category, TxType } from '@/types'
import { ICON_KEYS, CATEGORY_ICONS, DEFAULT_ICON, guessIcon, iconForCategory } from '@/lib/icons'
import { withAlpha } from '@/lib/color'
import { flattenCategories } from '@/lib/tree'
import CategoryIcon from './CategoryIcon.vue'
import CategorySelect from './CategorySelect.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 可選的分類（由外部給，通常為未封存的支出＋收入） */
    categories: Category[]
    defaultType?: TxType
    /** 每個分類被幾筆記錄使用，用來在刪除前提醒 */
    usage?: Record<string, number>
  }>(),
  { defaultType: 'expense', usage: () => ({}) },
)
const emit = defineEmits<{
  close: []
  create: [payload: { name: string; color: string; type: TxType; icon: string; parentId: string | null }]
  save: [
    payload: {
      id: string
      name: string
      color: string
      type: TxType
      icon: string
      parentId: string | null
    },
  ]
  remove: [id: string]
}>()

const NEW = '' // 下拉的「新增分類」佔位值
/** 剛打開、什麼都還沒選的狀態：只露出「選擇分類」與「類型」 */
const PICK = '__pick__'
const TOP = '__top__' // 「所屬分類」下拉代表「頂層大類」的佔位值
const PRESETS = ['#e0795b', '#3f9b6e', '#4a8fd4', '#d4a13f', '#9b6bd4', '#d45b8c', '#5bb0c4']

const pickedId = ref(PICK)
const name = ref('')
const color = ref(PRESETS[0])
const catType = ref<TxType>('expense')
const icon = ref<string>(DEFAULT_ICON)
/** 上層分類；TOP 代表「沒有上層＝頂層大類」 */
const parentSel = ref(TOP)
/** 使用者手動挑過圖示後，就不再依名稱自動推薦 */
const iconPicked = ref(false)
const custom = ref(false)
const askRemove = ref(false)

const parentId = computed(() => {
  const v = parentSel.value
  return !v || v === TOP ? null : v
})
const byId = computed(() => new Map(props.categories.map((c) => [c.id, c])))

/** 「餐飲 › 早餐」這種完整路徑名稱，下拉才看得出層級 */
function pathName(c: Category): string {
  const chain: string[] = []
  const seen = new Set<string>()
  let cur: Category | undefined = c
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur.name)
    cur = cur.parentId ? byId.value.get(cur.parentId) : undefined
  }
  return chain.join(' › ')
}

/**
 * 兩個下拉共用的排序：依大類依次排，子分類緊接在自己的大類後面
 * （餐飲、餐飲 › 午餐、餐飲 › 晚餐、旅行、旅行 › 中國…），
 * 而不是照「建立先後」把子分類全擠到清單最後。
 */
const treeOrder = computed(() => flattenCategories(props.categories))

/** 選擇要修改／刪除的分類：名稱換成完整路徑 */
const pickOptions = computed<Category[]>(() =>
  treeOrder.value.map((c) => ({ ...c, name: pathName(c) })),
)

/** 可以當上層的分類：排除自己與自己的所有後代，否則會形成環 */
const parentOptions = computed<Category[]>(() => {
  const banned = new Set<string>()
  if (isEdit.value && editing.value) {
    banned.add(editing.value.id)
    const walk = (id: string) => {
      for (const c of props.categories) {
        if (c.parentId === id) {
          banned.add(c.id)
          walk(c.id)
        }
      }
    }
    walk(editing.value.id)
  }
  // 先排好樹狀順序再濾掉不能選的；被濾掉的一定是「自己＋自己的後代」整段，
  // 不會留下孤零零的子分類
  return treeOrder.value
    .filter((c) => !banned.has(c.id))
    .map((c) => ({ ...c, name: pathName(c) }))
})

/**
 * 使用者做過決定了沒。
 * 剛打開時只露出「選擇分類」與「類型」，其餘欄位等選完再出現 ——
 * 不然一開就是一大張表，看不出「要先選要新增還是要改」。
 */
const decided = computed(() => pickedId.value !== PICK)

/** 目前正在編輯的分類；null 表示「新增」模式（或還沒選） */
const editing = computed(() =>
  pickedId.value && pickedId.value !== PICK
    ? (props.categories.find((c) => c.id === pickedId.value) ?? null)
    : null,
)
const isEdit = computed(() => !!editing.value)
const usedCount = computed(() => (isEdit.value ? props.usage[pickedId.value] ?? 0 : 0))

/** 編輯中的分類有幾個直接子分類：有就不能刪，得先處理子分類 */
const kidCount = computed(() =>
  editing.value ? props.categories.filter((c) => c.parentId === editing.value!.id).length : 0,
)
/** 掛在上層底下時，收支類型一律沿用上層，不給改 */
const typeLocked = computed(() => !!parentId.value)
const parentCat = computed(() => (parentId.value ? byId.value.get(parentId.value) : undefined))

/** 回到「新增」模式的空白表單（可指定要掛在哪個分類底下、以及預設收支） */
function resetNew(under: string | null = null, type: TxType = props.defaultType) {
  name.value = ''
  const p = under ? byId.value.get(under) : undefined
  color.value = p ? p.color : PRESETS[0]
  // 掛到上層底下時一律沿用上層；否則保留使用者剛剛在「類型」選的收支
  catType.value = p ? p.type : type
  icon.value = DEFAULT_ICON
  iconPicked.value = false
  custom.value = false
  parentSel.value = under ?? TOP
}

/** 把表單填成某個分類的現況 */
function fill(c: Category) {
  name.value = c.name
  color.value = c.color
  catType.value = c.type
  icon.value = c.icon || DEFAULT_ICON
  custom.value = !PRESETS.includes(c.color)
  parentSel.value = c.parentId ?? TOP
  // 編輯既有分類時，打字不該把使用者原本挑好的圖示換掉
  iconPicked.value = true
}

/**
 * 切換「要修改哪個分類」。
 * 刻意不用 watch(pickedId)：watch 是非同步的，addChild() 同步指定好上層之後
 * 監聽器才跑，會把上層又清回「無」，變成子分類掉到最上層。
 */
function choose(id: string) {
  pickedId.value = id
  const c = props.categories.find((x) => x.id === id)
  if (c) {
    fill(c)
    return
  }
  // 「新增分類」或回到未決定：沿用剛剛在「類型」選的收支，不要被重設回預設值
  resetNew(null, catType.value)
}

/** 在目前編輯的分類底下新增一層子分類（上層直接帶好） */
function addChild() {
  // 一定要先把上層記下來：choose(NEW) 之後 editing 就變 null 了
  const parent = editing.value?.id ?? null
  choose(NEW)
  resetNew(parent)
}

/** 目前編輯的分類底下已有的直接子分類 */
const kids = computed(() =>
  editing.value ? props.categories.filter((c) => c.parentId === editing.value!.id) : [],
)
/** 某個分類底下還有幾個子分類（清單上用 +N 提示還能再往下） */
function subCount(id: string): number {
  return props.categories.filter((c) => c.parentId === id).length
}

function pick(c: string) {
  color.value = c
  custom.value = false
}
function onPalette(e: Event) {
  color.value = (e.target as HTMLInputElement).value
  custom.value = true
}
function pickIcon(k: string) {
  icon.value = k
  iconPicked.value = true
}

// 依名稱自動推薦圖示（使用者自己挑過就不覆蓋）
watch(name, (v) => {
  if (!iconPicked.value) icon.value = guessIcon(v)
})

// 選了上層分類：類型與顏色直接沿用，整條路徑才會一致
watch(parentSel, (v) => {
  const p = v === TOP ? undefined : byId.value.get(v)
  if (!p) return
  catType.value = p.type
  color.value = p.color
  custom.value = !PRESETS.includes(p.color)
})

watch(
  () => props.open,
  (v) => {
    if (v) {
      // 每次打開都回到「還沒選」的狀態，類型回到預設讓使用者自己選
      catType.value = props.defaultType
      choose(PICK)
      askRemove.value = false
    }
  },
)

/** 標題跟著目前狀態走（還沒選的時候不要自稱「新增分類」） */
const title = computed(() =>
  !decided.value ? '新增或修改分類' : isEdit.value ? '修改分類' : '新增分類',
)

function submit() {
  if (!decided.value || !name.value.trim()) return
  const payload = {
    name: name.value.trim(),
    color: color.value,
    type: catType.value,
    icon: icon.value,
    parentId: parentId.value,
  }
  if (isEdit.value && editing.value) emit('save', { id: editing.value.id, ...payload })
  else emit('create', payload)
}

function confirmRemove() {
  if (!editing.value) return
  emit('remove', editing.value.id)
  askRemove.value = false
  // 刪完回到「還沒選」，讓使用者重新挑一個
  choose(PICK)
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="card box">
        <h3>{{ title }}</h3>

        <div class="lb">
          <span>
            選擇分類
            <em class="lb__hint">
              {{ decided ? '換一個就切過去修改或刪除' : '先選一個，或選「新增分類」建立新的' }}
            </em>
          </span>
          <CategorySelect
            :model-value="pickedId"
            :options="pickOptions"
            placeholder="請選擇分類"
            empty-label="新增分類"
            allow-empty
            show-type
            @update:model-value="choose"
          />
        </div>

        <!-- 類型留在外面：還沒決定要新增還是要改之前，這是唯一得先選的東西 -->
        <div class="lb">
          <span>
            類型
            <em v-if="typeLocked" class="lb__hint">
              子分類沿用上層「{{ parentCat?.name }}」的類型
            </em>
            <em v-else-if="!decided" class="lb__hint">新增的話，先挑是支出還是收入</em>
          </span>
          <div class="seg" :class="{ 'is-locked': typeLocked }">
            <button
              type="button"
              class="seg__btn"
              :class="{ 'is-on': catType === 'expense' }"
              :disabled="typeLocked"
              @click="catType = 'expense'"
            >
              支出
            </button>
            <button
              type="button"
              class="seg__btn"
              :class="{ 'is-on': catType === 'income' }"
              :disabled="typeLocked"
              @click="catType = 'income'"
            >
              收入
            </button>
          </div>
        </div>

        <!-- 選完之後才把其餘欄位露出來 -->
        <template v-if="decided">
          <div v-if="isEdit" class="lb">
            <span>
              子分類
              <em class="lb__hint">可以一層一層往下加（餐飲 › 早餐 › 飯）</em>
            </span>
            <!-- 已有的子分類：點一下就切過去編輯，不用回最上面重選 -->
            <div v-if="kids.length" class="kidlist">
              <button
                v-for="k in kids"
                :key="k.id"
                type="button"
                class="kid"
                @click="choose(k.id)"
              >
                <span class="kid__ic" :style="{ '--c': k.color, '--bg': withAlpha(k.color, 0.14) }">
                  <CategoryIcon :name="iconForCategory(k)" :size="13" :stroke="1.9" />
                </span>
                <span class="kid__name">{{ k.name }}</span>
                <span v-if="subCount(k.id)" class="kid__more">+{{ subCount(k.id) }}</span>
              </button>
            </div>
            <button class="btn btn--sm btn--ghost kidadd" type="button" @click="addChild">
              ＋ 在「{{ editing?.name }}」底下新增子分類
            </button>
          </div>

          <div class="lb">
            <span>
              所屬分類
              <em class="lb__hint">選了就變成它的子分類；選「無」是最上層大類</em>
            </span>
            <CategorySelect
              v-model="parentSel"
              :options="parentOptions"
              placeholder="無（最上層大類）"
              allow-empty
              show-type
            />
          </div>

          <!-- 即時預覽 -->
          <div class="prev">
            <span class="prev__ic" :style="{ color, background: withAlpha(color, 0.14) }">
              <CategoryIcon :name="icon" :size="20" />
            </span>
            <span class="prev__name" :style="{ color }">{{ name.trim() || '新分類' }}</span>
            <span v-if="isEdit && editing?.builtin" class="prev__tag">內建</span>
          </div>

          <label class="lb">
            <span>名稱</span>
            <input
              v-model="name"
              class="field"
              maxlength="12"
              placeholder="分類名稱"
              @keyup.enter="submit"
            />
          </label>

          <div class="lb">
            <span>
              圖示
              <em class="lb__hint">輸入名稱會自動推薦，也可自己挑</em>
            </span>
            <div class="igrid">
              <button
                v-for="k in ICON_KEYS"
                :key="k"
                type="button"
                class="ic"
                :class="{ 'is-on': icon === k }"
                :style="
                  icon === k ? { color, borderColor: color, background: withAlpha(color, 0.14) } : undefined
                "
                :title="CATEGORY_ICONS[k].label"
                :aria-label="CATEGORY_ICONS[k].label"
                @click="pickIcon(k)"
              >
                <CategoryIcon :name="k" :size="19" />
              </button>
            </div>
          </div>

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

          <p v-if="isEdit && kidCount" class="used">
            底下還有 {{ kidCount }} 個子分類，要刪掉這個分類請先處理它的子分類。
          </p>
          <p v-else-if="isEdit && usedCount" class="used">
            已被 {{ usedCount }} 筆記錄使用，修改後這些記錄會一起更新。
          </p>
        </template>

        <div class="foot">
          <button
            v-if="isEdit"
            class="btn btn--danger btn--sm foot__del"
            type="button"
            :disabled="kidCount > 0"
            :title="kidCount ? `還有 ${kidCount} 個子分類，請先刪除子分類` : '刪除這個分類'"
            @click="askRemove = true"
          >
            刪除
          </button>
          <button class="btn btn--ghost" type="button" @click="emit('close')">取消</button>
          <button
            v-if="decided"
            class="btn btn--primary"
            type="button"
            :disabled="!name.trim()"
            @click="submit"
          >
            {{ isEdit ? '儲存' : '新增' }}
          </button>
        </div>
      </div>

      <ConfirmDialog
        :open="askRemove"
        :title="`刪除「${editing?.name ?? ''}」？`"
        :message="
          usedCount
            ? `有 ${usedCount} 筆記錄使用這個分類，刪除後這些記錄仍會保留原本的分類名稱，但分類不再出現在選單裡。`
            : '刪除後這個分類不會再出現在選單裡。'
        "
        confirm-text="刪除"
        danger
        @confirm="confirmRemove"
        @cancel="askRemove = false"
      />
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
  max-width: 356px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.box h3 {
  font-size: 16px;
}
.prev {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 12px;
  background: var(--surface-3);
}
.prev__ic {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: none;
}
.prev__name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.prev__tag {
  margin-left: auto;
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--text-3);
  font-size: 11px;
  font-weight: 650;
}
.lb {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
/**
 * 標籤列 = 兩欄格線，不是 flex。
 * flex 之下「標籤」與「提示」都是可壓縮的彈性項目，提示一長就會把標籤壓到剩 3 個字
 * （「所屬分」／「類」斷成兩行，看起來像懸掛縮排）。改成格線後：
 *   第 1 欄 max-content → 標籤拿到自己剛好的寬度，永遠不會被壓縮或斷行
 *   第 2 欄 minmax(0, 1fr) → 提示吃掉剩下的寬度，並在自己的欄位內換行（左緣彼此對齊）
 * align-items: baseline 讓 12.5px 的標籤與 11px 的提示坐在同一條基線上。
 */
.lb > span {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: baseline;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-2);
}
.lb__hint {
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
  color: var(--text-3);
  /* 避免最後一行只剩一個字（例如提示差 1px 就放得下時） */
  text-wrap: pretty;
}
.seg {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--surface-3);
  border-radius: 12px;
}
.seg__btn {
  flex: 1;
  height: 32px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-2);
}
.seg__btn.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
/* 類型被上層鎖住：整組變淡但仍看得出目前值 */
.seg.is-locked {
  opacity: 0.62;
}
.seg__btn:disabled {
  cursor: not-allowed;
}
/* 「在 X 底下新增子分類」：整顆按鈕靠左、文字可縮 */
.kidadd {
  align-self: flex-start;
  max-width: 100%;
  text-align: left;
  white-space: normal;
  height: auto;
  padding: 7px 11px;
  line-height: 1.35;
}
/* 已有的子分類：點一下就切過去編輯 */
.kidlist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kid {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: 13px;
}
.kid:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.kid__ic {
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  border-radius: 6px;
  color: var(--c);
  background: var(--bg);
  flex: none;
}
.kid__name {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kid__more {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 650;
}
.igrid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  max-height: 152px;
  overflow-y: auto;
  padding: 2px;
  border-radius: 12px;
  background: var(--surface-3);
}
.ic {
  display: grid;
  place-items: center;
  height: 40px;
  border-radius: 9px;
  border: 1px solid transparent;
  color: var(--text-2);
  background: transparent;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.ic:hover {
  background: var(--surface);
  color: var(--text);
}
.ic.is-on {
  border-width: 1px;
  border-style: solid;
  box-shadow: var(--shadow-1);
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
/* 刪除前提醒：這個分類已經被多少筆記錄用到 */
.used {
  margin: 0;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--surface-3);
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 1.5;
}
.foot {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 2px;
}
.foot__del {
  margin-right: auto;
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
