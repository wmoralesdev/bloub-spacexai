<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { Fige } from '@/bot/figes'
import { t, type Cle } from '@/i18n'
import { telecharge } from '@/ui/capture'
import { ecris, lis } from '@/ui/stockage'
import {
  createStickerSheetLayout,
  DEFAULT_STICKER_SHEET_SETTINGS,
  STICKER_SHEET_PRESETS,
  parseStickerSheetSettings,
  resolveStickerBrandingPlacement,
  validateStickerSheetSettings,
  type StickerBrandingPlacement,
  type StickerSheetSettings,
  type StickerSheetPreset
} from '@/ui/stickerSheet'
import { renderStickerSheet, stickerSheetZip, stickerSheetPrintZip, type StickerSheetRender } from '@/ui/stickerSheetRender'
import { printExportErrorKey } from '@/ui/printExport'
import type { StickerSheetBranding } from '@/ui/stickerSheetBranding'
import { useModalDialog } from '@/ui/useModalDialog'

const props = defineProps<{ items: Fige[]; branding?: StickerSheetBranding | null }>()
const open = defineModel<boolean>('open', { required: true })
const boite = useTemplateRef<HTMLDialogElement>('boite')
useModalDialog(open, boite)
// This component is loaded on demand, so its initial model can already be true.
onMounted(() => {
  if (open.value && boite.value && !boite.value.open) boite.value.showModal()
})

const settings = ref<StickerSheetSettings>(
  parseStickerSheetSettings(lis('sticker-sheet')) ?? { ...DEFAULT_STICKER_SHEET_SETTINGS }
)
const previewMode = ref<'art' | 'cut' | 'overlay'>('art')
const result = shallowRef<StickerSheetRender | null>(null)
const loading = ref(false)
const exporting = ref(false)
const renderError = ref<Cle | null>(null)
const exportError = ref(false)
const printError = ref<Cle | null>(null)
const exportFormat = ref<'svg' | 'pdf'>('svg')
let exportController: AbortController | undefined
const downloaded = ref(false)
const retry = ref(0)
let revision = 0
let contentKey = ''
const previewSheet = useTemplateRef<HTMLDivElement>('previewSheet')
const drag = ref<{ pointerId: number; clientX: number; clientY: number; dx: number; dy: number; width: number; height: number; placement: StickerBrandingPlacement } | null>(null)

const errorKeys: Record<string, Cle> = {
  invalidDimensions: 'stickerSheet.invalidDimensions',
  invalidSize: 'stickerSheet.invalidSize',
  invalidBorder: 'stickerSheet.invalidBorder',
  invalidSpacing: 'stickerSheet.invalidSpacing',
  invalidMargin: 'stickerSheet.invalidMargin',
  invalidColor: 'stickerSheet.invalidColor',
  invalidPreset: 'stickerSheet.invalidPreset',
  invalidBrandingPlacement: 'stickerSheet.invalidBrandingPlacement',
  noCapacity: 'stickerSheet.noCapacity'
}
const activeSettings = computed(() => {
  if (props.branding) return settings.value
  const { brandingPlacement: _placement, ...base } = settings.value
  return base
})
const validation = computed(() => validateStickerSheetSettings(activeSettings.value))
const validationMessage = computed(() => validation.value ? t(errorKeys[validation.value] ?? 'stickerSheet.invalidDimensions') : '')
const totalCount = computed(() => props.items.length + (props.branding ? 1 : 0))
// Invalid logo edits must not hide the last valid defaults needed to correct them.
const layout = computed(() => {
  const { brandingPlacement: _placement, ...base } = settings.value
  return validateStickerSheetSettings(base) ? null : createStickerSheetLayout(base, totalCount.value)
})
const brandingPlacement = computed(() => settings.value.brandingPlacement ?? (layout.value ? resolveStickerBrandingPlacement(layout.value) : null))
const displayedStickerSize = computed(() => settings.value.autoFit && layout.value
  ? Number((layout.value.settings.stickerSizeMm / 10).toFixed(3))
  : settings.value.stickerSizeMm / 10)
const canDownload = computed(() => open.value && totalCount.value > 0 && !!layout.value?.fits && !!result.value && !result.value.brandingOutOfBounds && !result.value.brandingOverlaps && !validation.value && !renderError.value && !loading.value && !exporting.value && !drag.value)
const previewOffset = computed(() => {
  if (drag.value) return { x: drag.value.dx, y: drag.value.dy }
  const rendered = result.value?.branding?.placement
  const pending = brandingPlacement.value
  // Keep the released logo in place while its row and cut lines are recalculated.
  if (loading.value && rendered && pending && pending.sizeMm === rendered.sizeMm &&
      Number.isFinite(pending.centerXMm) && Number.isFinite(pending.centerYMm)) {
    return { x: pending.centerXMm - rendered.centerXMm, y: pending.centerYMm - rendered.centerYMm }
  }
  return { x: 0, y: 0 }
})
const brandingTargetStyle = computed(() => {
  const bounds = result.value?.branding?.bounds
  if (!bounds) return {}
  return {
    left: `${(bounds.x + previewOffset.value.x) / settings.value.widthMm * 100}%`,
    top: `${(bounds.y + previewOffset.value.y) / settings.value.heightMm * 100}%`,
    width: `${bounds.width / settings.value.widthMm * 100}%`,
    height: `${bounds.height / settings.value.heightMm * 100}%`
  }
})
const previewSource = computed(() => {
  if (!result.value) return ''
  let svg = result.value[previewMode.value]
  if (previewOffset.value.x || previewOffset.value.y) {
    const { x: dx, y: dy } = previewOffset.value
    const pattern = new RegExp(`(data-sticker-index="${props.items.length}" transform=")translate\\(([^ ]+) ([^)]+)\\)`, 'g')
    svg = svg.replace(pattern, (_match, prefix: string, x: string, y: string) => `${prefix}translate(${Number(x) + dx} ${Number(y) + dy})`)
  }
  // Keep the physical 0.1 mm line in downloads, but make it legible on a small screen.
  const preview = previewMode.value === 'art' ? svg : svg.replaceAll(
    'stroke="#ff00a8" stroke-width="0.1"',
    'stroke="#ff00a8" stroke-width="1" vector-effect="non-scaling-stroke"'
  )
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview)}`
})

watch(settings, (value) => {
  if (!validateStickerSheetSettings(activeSettings.value)) ecris('sticker-sheet', JSON.stringify(value))
})

watch(
  () => JSON.stringify([open.value, props.items, props.branding, settings.value, retry.value]),
  (_key, _oldKey, onCleanup) => {
    const request = ++revision
    exportController?.abort()
    const { brandingPlacement: _placement, ...base } = settings.value
    const nextContentKey = JSON.stringify([open.value, props.items, props.branding, base, retry.value])
    if (nextContentKey !== contentKey) result.value = null
    contentKey = nextContentKey
    drag.value = null
    renderError.value = null
    exportError.value = false
    printError.value = null
    downloaded.value = false
    loading.value = false
    if (!open.value || !totalCount.value || validation.value) return

    const items = props.items.map((item) => ({ ...item }))
    const branding = props.branding ? { ...props.branding } : null
    const snapshot: StickerSheetSettings = { ...activeSettings.value }
    if (snapshot.brandingPlacement) snapshot.brandingPlacement = { ...snapshot.brandingPlacement }
    loading.value = true
    // Coalesce rapid numeric edits before capturing the SVG bots.
    const timer = setTimeout(async () => {
      try {
        const rendered = await renderStickerSheet(items, snapshot, branding)
        if (request === revision) result.value = rendered
      } catch (error) {
        if (request === revision) {
          result.value = null
          renderError.value = error instanceof Error && error.message === 'invalidBrandingGeometry'
            ? 'stickerSheet.invalidBrandingGeometry'
            : error instanceof Error && error.message === 'invalidGeometry'
              ? 'stickerSheet.invalidGeometry'
              : 'stickerSheet.renderError'
        }
      } finally {
        if (request === revision) loading.value = false
      }
    }, 120)
    onCleanup(() => clearTimeout(timer))
  },
  { immediate: true, flush: 'sync' }
)
watch(exportFormat, () => {
  exportController?.abort()
  downloaded.value = false
  exportError.value = false
  printError.value = null
})
onBeforeUnmount(() => { revision++; exportController?.abort() })

type NumericSetting = {
  [Key in keyof StickerSheetSettings]: StickerSheetSettings[Key] extends number ? Key : never
}[keyof StickerSheetSettings] & string

function updateBranding(key: keyof StickerBrandingPlacement, event: Event) {
  if (!brandingPlacement.value) return
  settings.value = { ...settings.value, brandingPlacement: { ...brandingPlacement.value, [key]: (event.target as HTMLInputElement).valueAsNumber * 10 } }
}

function resetBranding() {
  const { brandingPlacement: _placement, ...base } = settings.value
  settings.value = base
}

function startBrandingDrag(event: PointerEvent) {
  if (event.button !== 0 || loading.value || validation.value || !result.value?.branding || !previewSheet.value) return
  const rect = previewSheet.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  event.preventDefault()
  const target = event.currentTarget as HTMLButtonElement
  target.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  drag.value = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, dx: 0, dy: 0, width: rect.width, height: rect.height, placement: { ...result.value.branding.placement } }
}

function moveBrandingDrag(event: PointerEvent) {
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  drag.value = {
    ...drag.value,
    dx: (event.clientX - drag.value.clientX) / drag.value.width * settings.value.widthMm,
    dy: (event.clientY - drag.value.clientY) / drag.value.height * settings.value.heightMm
  }
}

function finishBrandingDrag(event: PointerEvent, cancelled = false) {
  if (!drag.value || drag.value.pointerId !== event.pointerId) return
  const { placement, dx, dy } = drag.value
  drag.value = null
  if (!cancelled && (dx || dy)) {
    settings.value = { ...settings.value, brandingPlacement: { ...placement, centerXMm: placement.centerXMm + dx, centerYMm: placement.centerYMm + dy } }
  }
}

function moveBrandingWithKeyboard(event: KeyboardEvent) {
  const placement = brandingPlacement.value
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
  if (!direction || !placement || validation.value) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : 1
  settings.value = { ...settings.value, brandingPlacement: { ...placement, centerXMm: placement.centerXMm + direction[0]! * step, centerYMm: placement.centerYMm + direction[1]! * step } }
}

const centimetres = (value: number) => Number.isFinite(value) ? Number((value / 10).toFixed(3)) : ''

function update(key: NumericSetting, event: Event, unit = 1) {
  if ((key === 'widthMm' || key === 'heightMm') && settings.value.preset !== 'custom') return
  if (key === 'stickerSizeMm' && settings.value.autoFit) return
  settings.value = { ...settings.value, [key]: (event.target as HTMLInputElement).valueAsNumber * unit }
}

const presetLabels: Record<StickerSheetPreset, Cle> = {
  a4: 'stickerSheet.presetA4',
  letter: 'stickerSheet.presetLetter',
  'half-letter': 'stickerSheet.presetHalfLetter',
  'quarter-letter': 'stickerSheet.presetQuarterLetter',
  custom: 'stickerSheet.presetCustom'
}

function preset(value: StickerSheetPreset) {
  if (value === 'custom') {
    settings.value = { ...settings.value, preset: value }
    return
  }
  const [widthMm, heightMm] = STICKER_SHEET_PRESETS[value]
  const portrait = settings.value.widthMm < settings.value.heightMm
  settings.value = {
    ...settings.value,
    preset: value,
    widthMm: portrait ? heightMm : widthMm,
    heightMm: portrait ? widthMm : heightMm
  }
}

function updateColor(event: Event) {
  settings.value = { ...settings.value, backgroundColor: (event.target as HTMLInputElement).value.trim() }
}

function updateAutoFit(event: Event) {
  settings.value = { ...settings.value, autoFit: (event.target as HTMLInputElement).checked }
}

function swapOrientation() {
  settings.value = { ...settings.value, widthMm: settings.value.heightMm, heightMm: settings.value.widthMm }
}

async function download() {
  if (!canDownload.value || !result.value) return
  const snapshot = result.value
  const request = revision
  const format = exportFormat.value
  const controller = new AbortController()
  exportController = controller
  exporting.value = true
  exportError.value = false
  printError.value = null
  downloaded.value = false
  try {
    await nextTick()
    // Do not download a sheet replaced or closed while the button was updating.
    if (request !== revision || !open.value) return
    const blob = format === 'pdf' ? await stickerSheetPrintZip(snapshot, controller.signal) : stickerSheetZip(snapshot)
    if (controller.signal.aborted || request !== revision || !open.value || format !== exportFormat.value) return
    telecharge(blob, format === 'pdf' ? 'bloub-sticker-sheet-cmyk.zip' : 'bloub-sticker-sheet.zip')
    downloaded.value = true
  } catch (error) {
    if (!controller.signal.aborted && request === revision && open.value) {
      if (format === 'pdf') printError.value = printExportErrorKey(error)
      else exportError.value = true
    }
  } finally {
    exporting.value = false
    if (exportController === controller) exportController = undefined
  }
}
</script>

<template>
  <dialog
    ref="boite"
    class="sticker-sheet-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 text-[var(--ink)] shadow-xl sm:p-6"
    aria-labelledby="sticker-sheet-title"
    aria-describedby="sticker-sheet-description"
    @close="open = false"
    @cancel.prevent="open = false"
  >
    <form class="flex flex-col gap-5" novalidate @submit.prevent="download">
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 id="sticker-sheet-title" class="text-balance text-lg font-semibold">{{ t('stickerSheet.title') }}</h2>
          <p id="sticker-sheet-description" class="mt-1 text-pretty text-sm text-[var(--muted)]">{{ t('stickerSheet.description') }}</p>
        </div>
        <button type="button" class="sheet-button shrink-0" @click="open = false">{{ t('stickerSheet.close') }}</button>
      </header>

      <div class="grid min-w-0 gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div class="flex min-w-0 flex-col gap-5">
          <fieldset class="flex flex-col gap-3">
            <legend class="mb-2 text-sm font-semibold">{{ t('stickerSheet.sheetSize') }}</legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="(label, choice) in presetLabels" :key="choice" class="cursor-pointer">
                <input
                  type="radio"
                  name="sticker-sheet-preset"
                  :value="choice"
                  :checked="settings.preset === choice"
                  :autofocus="settings.preset === choice"
                  class="peer sr-only"
                  @change="preset(choice)"
                />
                <span class="flex min-h-10 items-center rounded-full border border-black/15 px-4 py-2 text-sm peer-checked:border-[var(--ink)] peer-checked:bg-[var(--ink)] peer-checked:text-[var(--paper)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ink)]">{{ t(label) }}</span>
              </label>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <label class="sheet-label" for="sticker-sheet-width">
                {{ t('stickerSheet.width') }}
                <input id="sticker-sheet-width" :value="Number((settings.widthMm / 10).toFixed(6))" type="number" step="0.01" min="0.01" :readonly="settings.preset !== 'custom'" class="read-only:bg-black/5 read-only:text-[var(--muted)]" :aria-invalid="validation === 'invalidDimensions'" @input="update('widthMm', $event, 10)" />
              </label>
              <label class="sheet-label" for="sticker-sheet-height">
                {{ t('stickerSheet.height') }}
                <input id="sticker-sheet-height" :value="Number((settings.heightMm / 10).toFixed(6))" type="number" step="0.01" min="0.01" :readonly="settings.preset !== 'custom'" class="read-only:bg-black/5 read-only:text-[var(--muted)]" :aria-invalid="validation === 'invalidDimensions'" @input="update('heightMm', $event, 10)" />
              </label>
            </div>
            <button type="button" class="sheet-button self-start" @click="swapOrientation">{{ t('stickerSheet.swapOrientation') }}</button>
          </fieldset>

          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm font-medium">{{ t('stickerSheet.backgroundColor') }}</legend>
            <div class="flex items-center gap-3">
              <input
                id="sticker-sheet-background-color"
                type="color"
                :value="/^#[0-9a-f]{6}$/i.test(settings.backgroundColor) ? settings.backgroundColor : '#ffffff'"
                :aria-label="t('stickerSheet.backgroundColor')"
                class="size-10 shrink-0 cursor-pointer rounded-lg border border-black/15 bg-white p-1"
                @input="updateColor"
              />
              <label class="sheet-label min-w-0 grow" for="sticker-sheet-background-hex">
                <span class="sr-only">{{ t('stickerSheet.backgroundColorHex') }}</span>
                <input
                  id="sticker-sheet-background-hex"
                  :value="settings.backgroundColor"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  :aria-invalid="validation === 'invalidColor'"
                  :aria-describedby="validation === 'invalidColor' ? 'sticker-sheet-validation' : undefined"
                  @input="updateColor"
                />
              </label>
            </div>
          </fieldset>

          <label class="flex cursor-pointer items-start gap-3 text-sm" for="sticker-sheet-auto-fit">
            <input id="sticker-sheet-auto-fit" type="checkbox" :checked="settings.autoFit" class="mt-1 accent-[var(--ink)]" aria-describedby="sticker-sheet-auto-fit-help" @change="updateAutoFit" />
            <span class="flex min-w-0 flex-col gap-1">
              <span class="font-medium">{{ t('stickerSheet.autoFit') }}</span>
              <span id="sticker-sheet-auto-fit-help" class="text-pretty text-xs text-[var(--muted)]">{{ t('stickerSheet.autoFitHelp') }}</span>
            </span>
          </label>
          <label class="sheet-label" for="sticker-sheet-size">
            {{ t('stickerSheet.stickerSize') }}
            <input id="sticker-sheet-size" :value="displayedStickerSize" type="number" step="0.1" min="0.1" :readonly="settings.autoFit" class="read-only:bg-black/5 read-only:text-[var(--muted)]" aria-describedby="sticker-sheet-size-help" :aria-invalid="validation === 'invalidSize'" @input="update('stickerSizeMm', $event, 10)" />
            <span id="sticker-sheet-size-help" class="text-pretty text-xs font-normal text-[var(--muted)]">{{ t('stickerSheet.stickerSizeHelp') }}</span>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="sheet-label" for="sticker-sheet-border">
              {{ t('stickerSheet.border') }}
              <input id="sticker-sheet-border" :value="settings.borderMm" type="number" step="0.1" min="0" :aria-invalid="validation === 'invalidBorder'" @input="update('borderMm', $event)" />
            </label>
            <label class="sheet-label" for="sticker-sheet-gap">
              {{ t('stickerSheet.gap') }}
              <input id="sticker-sheet-gap" :value="settings.gapMm" type="number" step="0.1" min="0.1" :aria-invalid="validation === 'invalidSpacing'" @input="update('gapMm', $event)" />
            </label>
          </div>
          <label class="sheet-label" for="sticker-sheet-margin">
            {{ t('stickerSheet.margin') }}
            <input id="sticker-sheet-margin" :value="settings.marginMm" type="number" step="0.1" min="0" :aria-invalid="validation === 'invalidMargin'" @input="update('marginMm', $event)" />
          </label>
          <div aria-live="polite" class="text-pretty text-sm tabular-nums">
            <p v-if="layout">{{ t('stickerSheet.capacity', { count: totalCount, capacity: layout.capacity }) }}</p>
            <p v-else-if="validation === 'noCapacity'">{{ t('stickerSheet.capacity', { count: totalCount, capacity: 0 }) }}</p>
            <p v-if="validationMessage && validation !== 'invalidBrandingPlacement'" id="sticker-sheet-validation" role="alert" class="mt-2 text-red-700">{{ validationMessage }}</p>
            <p v-else-if="totalCount && layout && !layout.capacity" role="alert" class="mt-2 text-red-700">{{ t('stickerSheet.noCapacity') }}</p>
            <p v-else-if="totalCount && layout && !layout.fits" role="alert" class="mt-2 text-red-700">{{ t('stickerSheet.overflow') }}</p>
            <p v-else-if="!totalCount" class="mt-2 text-[var(--muted)]">{{ t('stickerSheet.empty') }}</p>
          </div>
        </div>

        <section class="flex min-w-0 flex-col gap-3 md:sticky md:top-0 md:self-start" :aria-label="t('stickerSheet.preview')" :aria-busy="loading">
          <fieldset v-if="branding && brandingPlacement" class="min-w-0 rounded-xl border border-black/15 p-3 sm:p-4">
            <legend class="px-1 text-sm font-semibold">{{ t('stickerSheet.brandingAdjust') }}</legend>
            <div class="mb-3 flex items-center justify-between gap-3">
              <p class="min-w-0 truncate text-xs text-[var(--muted)]" :title="branding.name">{{ branding.name }}</p>
              <button type="button" class="sheet-button shrink-0" @click="resetBranding">{{ t('stickerSheet.brandingReset') }}</button>
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label class="sheet-label" for="sticker-sheet-branding-size">
                {{ t('stickerSheet.brandingSize') }}
                <input id="sticker-sheet-branding-size" type="number" step="0.1" min="0.1" :value="centimetres(brandingPlacement.sizeMm)" :aria-invalid="validation === 'invalidBrandingPlacement'" aria-describedby="sticker-sheet-branding-size-help" @input="updateBranding('sizeMm', $event)" />
              </label>
              <label class="sheet-label" for="sticker-sheet-branding-x">
                {{ t('stickerSheet.brandingX') }}
                <input id="sticker-sheet-branding-x" type="number" step="0.1" :value="centimetres(brandingPlacement.centerXMm)" :aria-invalid="validation === 'invalidBrandingPlacement'" aria-describedby="sticker-sheet-branding-position-help" @input="updateBranding('centerXMm', $event)" />
              </label>
              <label class="sheet-label" for="sticker-sheet-branding-y">
                {{ t('stickerSheet.brandingY') }}
                <input id="sticker-sheet-branding-y" type="number" step="0.1" :value="centimetres(brandingPlacement.centerYMm)" :aria-invalid="validation === 'invalidBrandingPlacement'" aria-describedby="sticker-sheet-branding-position-help" @input="updateBranding('centerYMm', $event)" />
              </label>
            </div>
            <p id="sticker-sheet-branding-size-help" class="mt-2 text-pretty text-xs text-[var(--muted)]">{{ t('stickerSheet.brandingSizeHelp') }}</p>
            <p id="sticker-sheet-branding-position-help" class="mt-1 text-pretty text-xs text-[var(--muted)]">{{ t('stickerSheet.brandingPositionHelp') }}</p>
            <p v-if="validation === 'invalidBrandingPlacement'" role="alert" class="mt-2 text-pretty text-sm text-red-700">{{ validationMessage }}</p>
            <p v-else-if="result?.brandingOutOfBounds && !loading" role="alert" class="mt-2 text-pretty text-sm text-red-700">{{ t('stickerSheet.brandingOutside') }}</p>
            <p v-else-if="result?.brandingOverlaps && !loading" role="alert" class="mt-2 text-pretty text-sm text-red-700">{{ t('stickerSheet.brandingNoSpace') }}</p>
          </fieldset>
          <fieldset class="flex flex-wrap gap-4 text-sm">
            <legend class="sr-only">{{ t('stickerSheet.preview') }}</legend>
            <label v-for="mode in (['art', 'cut', 'overlay'] as const)" :key="mode" class="flex cursor-pointer items-center gap-2">
              <input v-model="previewMode" type="radio" name="sticker-sheet-preview" :value="mode" class="accent-[var(--ink)]" />
              {{ t(`stickerSheet.${mode}`) }}
            </label>
          </fieldset>
          <div class="flex min-h-48 min-w-0 items-center justify-center rounded-xl bg-black/5 p-3 sm:p-4">
            <div v-if="previewSource" ref="previewSheet" class="relative min-w-0 overflow-hidden" :style="{ width: `min(100%, ${60 * settings.widthMm / settings.heightMm}dvh)`, aspectRatio: `${settings.widthMm} / ${settings.heightMm}` }">
              <img :src="previewSource" :alt="t('stickerSheet.previewAria', { mode: t(`stickerSheet.${previewMode}`) })" class="sheet-preview block w-full bg-white" draggable="false" />
              <button
                v-if="branding && result?.branding"
                type="button"
                class="sheet-branding-target"
                :class="{ 'is-dragging': drag, 'is-loading': loading }"
                :style="brandingTargetStyle"
                :aria-label="t('stickerSheet.brandingDrag')"
                :aria-disabled="!!validation"
                aria-describedby="sticker-sheet-branding-position-help"
                @pointerdown="startBrandingDrag"
                @pointermove="moveBrandingDrag"
                @pointerup="finishBrandingDrag"
                @pointercancel="finishBrandingDrag($event, true)"
                @lostpointercapture="finishBrandingDrag($event, true)"
                @keydown="moveBrandingWithKeyboard"
              ></button>
            </div>
            <div v-else-if="loading" role="status" class="flex w-full flex-col items-center gap-3">
              <div aria-hidden="true" class="aspect-[297/210] w-full rounded bg-white"></div>
              <p class="text-sm text-[var(--muted)]">{{ t('stickerSheet.loading') }}</p>
            </div>
            <div v-else-if="renderError" class="flex flex-col items-center gap-3 text-center">
              <p role="alert" class="text-pretty text-sm text-red-700">{{ t(renderError) }}</p>
              <button type="button" class="sheet-button" @click="retry++">{{ t('stickerSheet.retry') }}</button>
            </div>
            <p v-else class="text-pretty text-sm text-[var(--muted)]">{{ validationMessage || t('stickerSheet.empty') }}</p>
          </div>
        </section>
      </div>

      <footer class="flex flex-wrap items-center justify-end gap-3 border-t border-black/10 pt-4">
        <fieldset class="mr-auto flex min-w-0 flex-col gap-2 text-sm" aria-describedby="sticker-sheet-print-help">
          <legend class="mb-2 font-medium">{{ t('printExport.format') }}</legend>
          <div class="flex flex-wrap gap-4">
            <label class="flex cursor-pointer items-center gap-2"><input v-model="exportFormat" type="radio" name="sticker-sheet-export-format" value="svg" class="accent-[var(--ink)]" />{{ t('printExport.rgb') }}</label>
            <label class="flex cursor-pointer items-center gap-2"><input v-model="exportFormat" type="radio" name="sticker-sheet-export-format" value="pdf" class="accent-[var(--ink)]" />{{ t('printExport.cmyk') }}</label>
          </div>
          <p v-if="exportFormat === 'pdf'" id="sticker-sheet-print-help" class="max-w-md text-pretty text-xs text-[var(--muted)]">{{ t('printExport.help') }}</p>
        </fieldset>
        <p v-if="printError" role="alert" class="text-pretty text-sm text-red-700">{{ t(printError) }}</p>
        <p v-else-if="exportError" role="alert" class="text-pretty text-sm text-red-700">{{ t('stickerSheet.exportError') }}</p>
        <p v-else-if="downloaded" role="status" class="text-sm text-[var(--muted)]">{{ t('stickerSheet.downloaded') }}</p>
        <button type="submit" :disabled="!canDownload" class="min-h-10 cursor-pointer rounded-lg bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper)] hover:opacity-90 disabled:cursor-default disabled:opacity-40">
          {{ exporting ? t('stickerSheet.downloading') : t('stickerSheet.download') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.sticker-sheet-dialog::backdrop {
  background: rgb(10 12 20 / 0.4);
}

.sheet-label {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.sheet-label input {
  min-width: 0;
  width: 100%;
  min-height: 2.5rem;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.5rem;
  padding: 0.5rem 0.625rem;
  font-variant-numeric: tabular-nums;
}

.sheet-label input[aria-invalid='true'] {
  border-color: #b91c1c;
}

.sheet-button {
  min-height: 2.5rem;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.sheet-button:hover {
  background: rgb(0 0 0 / 0.05);
}

.sheet-branding-target {
  position: absolute;
  border: 1px dashed var(--ink);
  border-radius: 0.25rem;
  cursor: grab;
  touch-action: none;
  outline-offset: 3px;
}

.sheet-branding-target:hover,
.sheet-branding-target:focus-visible,
.sheet-branding-target.is-dragging {
  outline: 2px solid #2563eb;
}

.sheet-branding-target::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  min-width: 44px;
  min-height: 44px;
  transform: translate(-50%, -50%);
}

.sheet-branding-target.is-dragging {
  cursor: grabbing;
}

.sheet-branding-target.is-loading {
  cursor: wait;
}

.sheet-branding-target[aria-disabled='true'] {
  cursor: default;
}
</style>
