<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { t, type Cle } from '@/i18n'
import { telecharge } from '@/ui/capture'
import {
  ASPECTS,
  createSpeakerDraft,
  speakerFilename,
  speakerExportDimensions,
  type SpeakerExportFormat,
  type SpeakerDraft
} from '@/ui/speaker'
import { exportSpeaker, loadSpeakerBots, renderSpeaker } from '@/ui/speakerRender'
import { BUILTIN_PHOTOS, SAVE_DELAY_MS, makeSpeakerVariant, readSpeakerLibrary, writeSpeakerLibrary, type SpeakerPhoto } from '@/ui/speakerLibrary'
import { encodeSpeakerPhoto } from '@/ui/speakerPhoto'
import { downloadSpeakerAnimation, SpeakerRenderError } from '@/ui/speakerRenderClient'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const SpeakerAnimationPreview = defineAsyncComponent(() => import('./SpeakerAnimationPreview.vue'))
const SpeakerLineup = defineAsyncComponent(() => import('./SpeakerLineup.vue'))

const MAX_PHOTO_BYTES = 20 * 1024 * 1024
const restored = readSpeakerLibrary()
const library = reactive(restored.library)
const activeVariant = computed(() => library.variants.find((variant) => variant.id === library.activeId)!)
const draft = reactive({ ...activeVariant.value.draft })
const format = ref<SpeakerExportFormat>(activeVariant.value.format)
const animated = computed(() => format.value === 'mp4' || format.value === 'gif')
const saveStatus = ref<'saving' | 'saved' | 'error'>(restored.error ? 'error' : 'saved')
const readError = ref(restored.error)
const confirmingRemoval = ref(false)
const canvas = ref<HTMLCanvasElement>()
const preview = ref<HTMLElement>()
const photoInput = ref<HTMLInputElement>()
const nameInput = ref<HTMLInputElement>()
const portrait = shallowRef<HTMLImageElement>()
const bots = shallowRef<HTMLImageElement[]>()
const photoSource = ref('')
const photoName = ref('')
const photoLoading = ref(false)
const botsLoading = ref(false)
const exporting = ref(false)
const artwork = ref<'individual' | 'lineup'>('individual')
const lineupVisited = ref(false)
const lineupExporting = ref(false)
const exportBusy = computed(() => exporting.value || lineupExporting.value)
const lineupEvent = computed(() => library.variants[0]?.draft ?? draft)
const exportKind = ref<'single' | 'batch'>('single')
const batchProgress = ref({ completed: 0, total: 0, name: '', aspect: '', format: '' })
const batchInvalidSpeaker = ref(0)
const nameTouched = ref(false)
const photoError = ref<Cle | null>(null)
const botsError = ref<Cle | null>(null)
const previewError = ref<Cle | null>(null)
const exportStatus = ref<'idle' | 'done' | 'error' | 'cancelled'>('idle')
const exportError = ref<Cle>('speakers.exportError')
const renderProgress = ref(0)
const renderingAnimation = ref(false)
const dimensions = computed(() => speakerExportDimensions(draft.aspect, format.value))
const assets = computed(() => portrait.value && bots.value
  ? { portrait: portrait.value, bots: bots.value }
  : null)
const nameInvalid = computed(() => !draft.name.trim())
const ready = computed(() => !!assets.value && !photoLoading.value && !botsLoading.value && !previewError.value)
const canvasLabel = computed(() => t('speakers.previewAria', {
  name: draft.name,
  event: [draft.event, draft.city].filter(Boolean).join(' · '),
  aspect: draft.aspect,
  talkTitle: draft.talkTitle.trim() ? ` · ${draft.talkTitle.trim()}` : ''
}))
const eventFields = ['event', 'city', 'date', 'time', 'venue', 'url'] as const
const portraitControls = [
  { key: 'photoX', label: 'speakers.horizontal', min: -30, max: 30 },
  { key: 'photoY', label: 'speakers.vertical', min: -30, max: 30 },
  { key: 'photoScale', label: 'speakers.size', min: 70, max: 150 },
  { key: 'fade', label: 'speakers.fade', min: 0, max: 100 }
] as const

let saveTimer: ReturnType<typeof setTimeout> | undefined
let dirty = false
let switchingVariant = false
let disposed = false
let photoRequest = 0
let resizeObserver: ResizeObserver | undefined
let frame = 0
const previewWidth = ref(1000)
let renderController: AbortController | undefined
const objectUrls = new Set<string>()

function revoke(url: string) {
  if (!objectUrls.delete(url)) return
  URL.revokeObjectURL(url)
}

function flushSave() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  if (!dirty) return
  if (writeSpeakerLibrary(library)) {
    dirty = false
    readError.value = false
    saveStatus.value = 'saved'
  } else saveStatus.value = 'error'
}

function scheduleSave() {
  if (disposed) return
  dirty = true
  saveStatus.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, SAVE_DELAY_MS)
}

function syncVariant() {
  if (switchingVariant) return
  activeVariant.value.draft = { ...draft }
  activeVariant.value.format = format.value
  scheduleSave()
}

function prunePhotos() {
  library.photos = library.photos.filter((photo) =>
    BUILTIN_PHOTOS.some((builtin) => builtin.id === photo.id) || library.variants.some((variant) => variant.photoId === photo.id)
  )
}

function switchVariant(id: string) {
  const variant = library.variants.find((item) => item.id === id)
  if (!variant || (id === library.activeId && portrait.value)) return
  flushSave()
  switchingVariant = true
  library.activeId = id
  Object.assign(draft, variant.draft)
  format.value = variant.format
  switchingVariant = false
  confirmingRemoval.value = false
  nameTouched.value = false
  portrait.value = undefined
  photoSource.value = ''
  photoName.value = ''
  if (!exporting.value) exportStatus.value = 'idle'
  const photo = library.photos.find((item) => item.id === variant.photoId)!
  void loadPhoto(photo.src, photo.name, photo.id)
  scheduleSave()
}

function showArtwork(value: 'individual' | 'lineup') {
  if (exportBusy.value) return
  if (value === 'lineup') lineupVisited.value = true
  if (artwork.value !== value) exportStatus.value = 'idle'
  artwork.value = value
}

function editLineupSpeaker(id: string) {
  showArtwork('individual')
  switchVariant(id)
}

function lineupExportChanged(value: boolean) {
  lineupExporting.value = value
  if (value) exportStatus.value = 'idle'
}

function addVariant(duplicate = false) {
  if (library.variants.length >= 100) return
  const nextDraft = duplicate ? { ...draft } : {
    ...createSpeakerDraft(), name: '',
    ...Object.fromEntries(eventFields.map((key) => [key, draft[key]])), aspect: draft.aspect
  }
  const variant = makeSpeakerVariant(nextDraft, activeVariant.value.photoId, format.value)
  library.variants.push(variant)
  switchVariant(variant.id)
  if (!duplicate) nameInput.value?.focus()
}

function removeVariant() {
  if (library.variants.length <= 1) return
  const oldId = library.activeId
  const next = library.variants.find((variant) => variant.id !== oldId)!
  switchVariant(next.id)
  library.variants = library.variants.filter((variant) => variant.id !== oldId)
  prunePhotos()
  scheduleSave()
}

function selectPhoto(photo: SpeakerPhoto) {
  void loadPhoto(photo.src, photo.name, photo.id)
}

/** A failed replacement keeps the valid photo; a variant switch clears it first. */
async function loadPhoto(source: string, fileName = '', photoId?: string) {
  const request = ++photoRequest
  const variantId = library.activeId
  photoLoading.value = true
  photoError.value = null
  if (!exporting.value) exportStatus.value = 'idle'
  try {
    const image = new Image()
    image.src = source
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image')
    if (disposed || request !== photoRequest || variantId !== library.activeId) return
    const persistentSource = photoId ? source : encodeSpeakerPhoto(image)
    let persistentImage = image
    if (!photoId) {
      persistentImage = new Image()
      persistentImage.src = persistentSource
      await persistentImage.decode()
      if (disposed || request !== photoRequest || variantId !== library.activeId) return
      photoId = crypto.randomUUID()
      fileName = fileName.slice(0, 160)
      library.photos.push({ id: photoId, src: persistentSource, name: fileName })
    }
    portrait.value = persistentImage
    photoSource.value = persistentSource
    photoName.value = fileName
    if (activeVariant.value.photoId !== photoId) {
      activeVariant.value.photoId = photoId
      prunePhotos()
      scheduleSave()
    }
  } catch {
    if (!disposed && request === photoRequest) {
      photoError.value = photoId && BUILTIN_PHOTOS.some((photo) => photo.id === photoId) ? 'speakers.sampleError' : 'speakers.photoError'
    }
  } finally {
    revoke(source)
    if (!disposed && request === photoRequest) photoLoading.value = false
  }
}

function choosePhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/webp'].includes(file.type)) {
    photoError.value = 'speakers.photoTypeError'
    return
  }
  if (file.size > MAX_PHOTO_BYTES) {
    photoError.value = 'speakers.photoSizeError'
    return
  }
  const url = URL.createObjectURL(file)
  objectUrls.add(url)
  void loadPhoto(url, file.name)
}

async function loadBots() {
  if (botsLoading.value) return
  botsLoading.value = true
  botsError.value = null
  try {
    const images = await loadSpeakerBots()
    if (!disposed) bots.value = images
  } catch {
    if (!disposed) botsError.value = 'speakers.artworkError'
  } finally {
    if (!disposed) botsLoading.value = false
  }
}

function scheduleRender() {
  if (disposed || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!canvas.value || !assets.value) return
    try {
      renderSpeaker(canvas.value, draft, assets.value, previewWidth.value)
      previewError.value = null
    } catch {
      previewError.value = 'speakers.previewError'
    }
  })
}

function resetComposition() {
  const defaults = createSpeakerDraft()
  for (const key of ['photoX', 'photoY', 'photoScale', 'fade', 'botsScale', 'botsVisible'] as const) {
    // Assignment through separate branches keeps the boolean distinct from the numeric controls.
    if (key === 'botsVisible') draft[key] = defaults[key]
    else draft[key] = defaults[key]
  }
}

async function download() {
  nameTouched.value = true
  if (nameInvalid.value) {
    nameInput.value?.focus()
    return
  }
  if (exportBusy.value || !ready.value || !assets.value) return
  exportKind.value = 'single'
  exporting.value = true
  exportStatus.value = 'idle'
  // Snapshot both the image and form so an edit during encoding cannot rename another artwork.
  const snapshot: SpeakerDraft = { ...draft }
  const snapshotFormat = format.value
  const snapshotAssets = assets.value
  renderProgress.value = 0
  renderingAnimation.value = snapshotFormat === 'mp4' || snapshotFormat === 'gif'
  const controller = new AbortController()
  renderController = controller
  try {
    let blob: Blob
    if (snapshotFormat === 'mp4' || snapshotFormat === 'gif') {
      const { createSpeakerAnimationSnapshot } = await import('@/ui/speakerAnimation')
      const size = speakerExportDimensions(snapshot.aspect, snapshotFormat)
      const composition = await createSpeakerAnimationSnapshot(snapshot, snapshotAssets, size.width)
      controller.signal.throwIfAborted()
      blob = await downloadSpeakerAnimation(composition, snapshotFormat, controller.signal, (value) => { renderProgress.value = value })
    } else blob = await exportSpeaker(snapshot, snapshotAssets, snapshotFormat)
    if (disposed) return
    telecharge(blob, speakerFilename(snapshot, snapshotFormat))
    exportStatus.value = 'done'
  } catch (error) {
    if (!disposed) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) exportStatus.value = 'cancelled'
      else {
        exportError.value = error instanceof SpeakerRenderError && error.code === 'unavailable' ? 'speakers.renderUnavailable'
          : error instanceof SpeakerRenderError && error.code === 'busy' ? 'speakers.renderBusy' : 'speakers.exportError'
        exportStatus.value = 'error'
      }
    }
  } finally {
    renderController = undefined
    if (!disposed) exporting.value = false
  }
}

async function downloadAll() {
  if (exportBusy.value || photoLoading.value || !library.variants.length) return
  exportKind.value = 'batch'
  const invalidIndex = library.variants.findIndex((variant) => !variant.draft.name.trim())
  if (invalidIndex >= 0) {
    showArtwork('individual')
    switchVariant(library.variants[invalidIndex]!.id)
    nameTouched.value = true
    nameInput.value?.focus()
    batchInvalidSpeaker.value = invalidIndex + 1
    exportError.value = 'speakers.batchNameRequired'
    exportStatus.value = 'error'
    return
  }
  // Figer toute la collection avant le chargement asynchrone de l'exporteur.
  const variants = library.variants.map((variant) => ({ ...variant, draft: { ...variant.draft } }))
  const photos = library.photos.map((photo) => ({ ...photo }))
  const snapshotFormat = format.value
  const formats: SpeakerExportFormat[] = [snapshotFormat]
  const lineupTitle = t('speakers.lineupTitle')
  const controller = new AbortController()
  renderController = controller
  exporting.value = true
  renderingAnimation.value = false
  exportStatus.value = 'idle'
  renderProgress.value = 0
  batchProgress.value = { completed: 0, total: (variants.length + 1) * ASPECTS.length * formats.length, name: '', aspect: '', format: '' }
  try {
    const { exportSpeakersZip } = await import('@/ui/speakerBatch')
    controller.signal.throwIfAborted()
    const blob = await exportSpeakersZip(variants, photos, formats, (progress) => {
      if (disposed || controller.signal.aborted) return
      batchProgress.value = { ...progress, format: progress.format.toUpperCase() }
      renderProgress.value = progress.percent
    }, controller.signal, lineupTitle)
    controller.signal.throwIfAborted()
    if (disposed) return
    telecharge(blob, `grok-bot-all-speakers-${snapshotFormat}.zip`)
    exportStatus.value = 'done'
  } catch (error) {
    if (!disposed) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) exportStatus.value = 'cancelled'
      else {
        exportError.value = error instanceof SpeakerRenderError && error.code === 'unavailable' ? 'speakers.renderUnavailable'
          : error instanceof SpeakerRenderError && error.code === 'busy' ? 'speakers.renderBusy' : 'speakers.batchError'
        exportStatus.value = 'error'
      }
    }
  } finally {
    renderController = undefined
    if (!disposed) exporting.value = false
  }
}

watch(draft, () => {
  if (!exporting.value) exportStatus.value = 'idle'
  scheduleRender()
}, { deep: true })
watch([draft, format], syncVariant, { deep: true, flush: 'sync' })
watch(assets, scheduleRender)
watch(format, () => { if (!exporting.value) exportStatus.value = 'idle' })

function flushWhenHidden() {
  if (document.visibilityState === 'hidden') flushSave()
}

onMounted(() => {
  const photo = library.photos.find((item) => item.id === activeVariant.value.photoId)!
  void loadPhoto(photo.src, photo.name, photo.id)
  if (!restored.error) scheduleSave()
  window.addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', flushWhenHidden)
  void loadBots()
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width <= 0) return
    previewWidth.value = Math.round(Math.min(1600, Math.max(480, entry.contentRect.width * Math.min(devicePixelRatio || 1, 2))))
    scheduleRender()
  })
  if (preview.value) resizeObserver.observe(preview.value)
})

onBeforeUnmount(() => {
  flushSave()
  window.removeEventListener('pagehide', flushSave)
  document.removeEventListener('visibilitychange', flushWhenHidden)
  disposed = true
  renderController?.abort()
  photoRequest++
  resizeObserver?.disconnect()
  cancelAnimationFrame(frame)
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
})
</script>

<template>
  <section class="speaker-editor min-h-dvh px-4 pt-24 pb-10 text-[var(--ink)] sm:px-6 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-10 lg:pl-28 lg:pt-9" aria-labelledby="speakers-title">
    <div class="mx-auto max-w-[1400px]">
      <header class="mb-7 flex flex-wrap items-end justify-between gap-5 lg:mb-9">
        <div>
          <p class="mb-2 text-xs font-medium tracking-widest uppercase speaker-muted">Grok Bot</p>
          <h1 id="speakers-title" class="text-3xl font-semibold tracking-tight">{{ t('speakers.title') }}</h1>
          <p class="mt-2 max-w-xl text-sm leading-relaxed speaker-muted">{{ t('speakers.description') }}</p>
        </div>
        <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <fieldset class="flex rounded-xl border border-[var(--line)] bg-white p-1" :disabled="exportBusy">
            <legend class="sr-only">{{ t('speakers.exportFormat') }}</legend>
            <label v-for="choice in (['png', 'jpeg', 'mp4', 'gif'] as const)" :key="choice" class="relative cursor-pointer">
              <input v-model="format" class="peer sr-only" type="radio" name="speaker-format" :value="choice" />
              <span class="flex min-h-11 min-w-14 items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors peer-checked:bg-[var(--paper)] peer-checked:text-[var(--ink)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ink)] speaker-muted">{{ choice.toUpperCase() }}</span>
            </label>
          </fieldset>
          <button v-if="artwork === 'individual'" type="button" class="speaker-button flex min-h-13 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-5 text-sm font-medium text-white sm:flex-none" :disabled="!ready || nameInvalid || exportBusy" :aria-busy="exporting && exportKind === 'single'" @click="download">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
            {{ exporting && exportKind === 'single' ? t('speakers.exporting') : t('speakers.download') }}
          </button>
          <button type="button" class="speaker-button min-h-13 flex-1 rounded-xl border border-[var(--line)] bg-white px-4 text-sm font-medium sm:flex-none" :disabled="exportBusy || photoLoading || !library.variants.length" :aria-busy="exporting && exportKind === 'batch'" aria-describedby="speaker-batch-help" @click="downloadAll">
            {{ exporting && exportKind === 'batch' ? t('speakers.exporting') : t('speakers.downloadAll', { format: format.toUpperCase() }) }}
          </button>
          <button v-if="exporting && (renderingAnimation || exportKind === 'batch')" type="button" class="speaker-button min-h-11 px-3 text-sm underline underline-offset-4" @click="renderController?.abort()">{{ t('speakers.cancelExport') }}</button>
          <p id="speaker-batch-help" class="w-full text-xs speaker-muted sm:text-right">{{ t('speakers.batchHelp', { format: format.toUpperCase(), total: (library.variants.length + 1) * ASPECTS.length }) }}</p>
        </div>
      </header>

      <div class="mb-6 inline-flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-white p-1" role="group" :aria-label="t('speakers.artworkView')">
        <button v-for="view in (['individual', 'lineup'] as const)" :key="view" type="button" class="speaker-button min-h-11 rounded-lg px-4 text-sm font-medium" :class="artwork === view ? 'bg-[var(--ink)] text-white' : 'speaker-muted'" :aria-pressed="artwork === view" :disabled="exportBusy" @click="showArtwork(view)">{{ t(view === 'individual' ? 'speakers.individualArtwork' : 'speakers.lineupTitle') }}</button>
      </div>

      <SpeakerLineup v-if="lineupVisited" v-show="artwork === 'lineup'" :variants="library.variants" :photos="library.photos" :event="lineupEvent" :format="format" :active="props.active && artwork === 'lineup'" :busy="exporting" @exporting="lineupExportChanged" @edit="editLineupSpeaker" />

      <div v-if="artwork === 'lineup' && (exporting || exportStatus !== 'idle')" class="mt-4 text-sm speaker-muted">
        <template v-if="exporting">
          <p role="status" class="tabular-nums">{{ t('speakers.batchProgress', { completed: batchProgress.completed, total: batchProgress.total, progress: renderProgress }) }}</p>
          <p v-if="batchProgress.name" class="mt-1 text-xs">{{ batchProgress.name }} · {{ batchProgress.aspect }} · {{ batchProgress.format }}</p>
          <progress class="mt-2 h-1 w-full accent-[var(--ink)]" :value="renderProgress" max="100" :aria-label="t('speakers.renderProgress', { progress: renderProgress })" />
        </template>
        <p v-else-if="exportStatus === 'done'" role="status">{{ t('speakers.batchDownloaded') }}</p>
        <p v-else-if="exportStatus === 'cancelled'" role="status">{{ t('speakers.exportCancelled') }}</p>
        <div v-else-if="exportStatus === 'error'" role="alert" class="flex flex-wrap items-center gap-3 speaker-error">
          <p>{{ t(exportError, { n: batchInvalidSpeaker }) }}</p>
          <button type="button" class="speaker-button min-h-11 underline underline-offset-4" :disabled="exportBusy || photoLoading" @click="downloadAll">{{ t('speakers.retryExport') }}</button>
        </div>
      </div>

      <div v-show="artwork === 'individual'" class="grid min-w-0 items-start gap-8 xl:gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0 lg:sticky lg:top-9">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <fieldset class="flex rounded-xl border border-[var(--line)] bg-white p-1">
              <legend class="sr-only">{{ t('speakers.aspectRatio') }}</legend>
              <label v-for="aspect in ASPECTS" :key="aspect.id" class="relative cursor-pointer">
                <input v-model="draft.aspect" class="peer sr-only" type="radio" name="speaker-aspect" :value="aspect.id" />
                <span class="flex min-h-11 min-w-16 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors peer-checked:bg-[var(--ink)] peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ink)]">{{ aspect.id }}</span>
              </label>
            </fieldset>
            <span class="text-xs tabular-nums speaker-muted">{{ dimensions.width }} × {{ dimensions.height }} px</span>
          </div>

          <div ref="preview" class="speaker-stage relative overflow-hidden rounded-2xl bg-[#080808] shadow-[0_8px_30px_-18px_rgba(0,0,0,0.3)]" :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}`, '--speaker-aspect': dimensions.width / dimensions.height }" :aria-busy="!assets && (photoLoading || botsLoading)">
            <canvas ref="canvas" class="block h-full w-full" :class="{ 'opacity-0': !assets || animated }" :aria-hidden="animated" role="img" :aria-label="canvasLabel">{{ canvasLabel }}</canvas>
            <SpeakerAnimationPreview v-if="animated && assets" :draft="draft" :assets="assets" :width="Math.min(previewWidth, dimensions.width)" :active="props.active && artwork === 'individual'" :label="canvasLabel" />
            <div v-if="!assets" class="absolute inset-0 flex flex-col justify-between p-[7%]" aria-hidden="true">
              <div class="space-y-3"><div class="speaker-skeleton h-5 w-1/4 rounded bg-white/15" /><div class="speaker-skeleton h-4 w-1/2 rounded bg-white/10" /></div>
              <div class="flex items-end justify-between gap-6"><div class="w-1/2 space-y-3"><div class="speaker-skeleton h-4 w-1/3 rounded bg-white/10" /><div class="speaker-skeleton h-9 w-full rounded bg-white/15" /></div><div class="speaker-skeleton aspect-[3/4] w-1/3 rounded-t-[50%] bg-white/5" /></div>
            </div>
          </div>

          <div class="mt-4 flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs speaker-muted">
            <span>{{ t(animated ? 'speakers.animatedNote' : 'speakers.previewNote') }}</span>
            <span v-if="!assets && (photoLoading || botsLoading)" role="status">{{ t('speakers.loading') }}</span>
            <span v-else-if="exportStatus === 'done'" role="status" class="font-medium text-[var(--ink)]">{{ t(exportKind === 'batch' ? 'speakers.batchDownloaded' : 'speakers.downloaded') }}</span>
            <span v-else-if="exportStatus === 'cancelled'" role="status">{{ t('speakers.exportCancelled') }}</span>
            <span v-else-if="exporting && exportKind === 'batch'" role="status" class="tabular-nums">{{ t('speakers.batchProgress', { completed: batchProgress.completed, total: batchProgress.total, progress: renderProgress }) }}</span>
            <span v-else-if="exporting && renderingAnimation" role="status">{{ t('speakers.renderProgress', { progress: renderProgress }) }}</span>
            <span v-else>{{ t(format === 'mp4' ? 'speakers.mp4LoopNote' : format === 'gif' ? 'speakers.gifLoopNote' : 'speakers.exportQuality') }}</span>
          </div>
          <p v-if="exporting && exportKind === 'batch' && batchProgress.name" class="mt-2 text-xs speaker-muted">{{ batchProgress.name }} · {{ batchProgress.aspect }} · {{ batchProgress.format }}</p>
          <progress v-if="exporting && (renderingAnimation || exportKind === 'batch')" class="mt-2 h-1 w-full accent-[var(--ink)]" :value="renderProgress" max="100" :aria-label="t('speakers.renderProgress', { progress: renderProgress })" />
          <div v-if="exportStatus === 'error'" class="mt-2 flex flex-wrap items-center gap-3 text-sm speaker-error" role="alert">
            <p>{{ t(exportError, { n: batchInvalidSpeaker }) }}</p>
            <button type="button" class="speaker-button min-h-11 underline underline-offset-4" :disabled="exporting || (exportKind === 'batch' ? photoLoading : !ready || nameInvalid)" @click="exportKind === 'batch' ? downloadAll() : download()">{{ t('speakers.retryExport') }}</button>
          </div>
          <div v-if="botsError || previewError" class="mt-3 flex flex-wrap items-center gap-3 text-sm speaker-error" role="alert">
            <span>{{ t((botsError || previewError)!) }}</span>
            <button type="button" class="speaker-button min-h-11 underline underline-offset-4" @click="botsError ? loadBots() : scheduleRender()">{{ t('speakers.retry') }}</button>
          </div>
        </div>

        <form class="min-w-0" novalidate @submit.prevent="download">
          <section aria-labelledby="speaker-library-title" class="mb-6 border-b border-[var(--line)] pb-5">
            <h2 id="speaker-library-title" class="mb-3 text-sm font-semibold">{{ t('speakers.savedSpeakers') }}</h2>
            <label for="speaker-variant" class="sr-only">{{ t('speakers.variant') }}</label>
            <select id="speaker-variant" :value="library.activeId" class="speaker-input" @change="switchVariant(($event.target as HTMLSelectElement).value)">
              <option v-for="(variant, index) in library.variants" :key="variant.id" :value="variant.id">{{ index + 1 }}. {{ variant.draft.name.trim() || t('speakers.unnamedVariant') }}{{ variant.draft.talkTitle.trim() ? ` · ${variant.draft.talkTitle}` : '' }}</option>
            </select>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <button type="button" class="speaker-button min-h-11 font-medium" :disabled="library.variants.length >= 100" @click="addVariant()">{{ t('speakers.newVariant') }}</button>
              <button type="button" class="speaker-button min-h-11 font-medium" :disabled="library.variants.length >= 100 || photoLoading" @click="addVariant(true)">{{ t('speakers.duplicateVariant') }}</button>
              <button type="button" class="speaker-button ml-auto min-h-11 speaker-muted" :disabled="library.variants.length <= 1" @click="confirmingRemoval = !confirmingRemoval">{{ t('speakers.removeVariant') }}</button>
            </div>
            <div v-if="confirmingRemoval" class="mb-3 border-t border-[var(--line)] pt-3 text-xs">
              <p>{{ t('speakers.removeConfirm') }}</p>
              <div class="flex gap-4">
                <button type="button" class="speaker-button min-h-11 speaker-error" @click="removeVariant">{{ t('speakers.confirmRemove') }}</button>
                <button type="button" class="speaker-button min-h-11" @click="confirmingRemoval = false">{{ t('speakers.cancel') }}</button>
              </div>
            </div>
            <p v-if="saveStatus !== 'error'" role="status" class="text-xs speaker-muted">{{ t(saveStatus === 'saving' ? 'speakers.saving' : 'speakers.savedLocally') }}</p>
            <div v-else role="alert" class="text-xs leading-relaxed speaker-error">
              <p>{{ t(readError ? 'speakers.storageReadError' : 'speakers.saveError') }}</p>
              <button type="button" class="speaker-button min-h-11 underline underline-offset-4" @click="scheduleSave(); flushSave()">{{ t('speakers.retrySave') }}</button>
            </div>
          </section>
          <section aria-labelledby="speaker-photo-title" class="border-b border-[var(--line)] pb-6">
            <h2 id="speaker-photo-title" class="mb-4 text-sm font-semibold">{{ t('speakers.photo') }}</h2>
            <div class="flex items-center gap-4">
              <div class="flex h-20 w-20 shrink-0 items-end justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]" :aria-busy="photoLoading">
                <img v-if="photoSource" :src="photoSource" :alt="t('speakers.photoAlt')" class="h-full w-full object-contain object-bottom" />
                <span v-else class="speaker-skeleton h-14 w-11 rounded-t-full bg-white/75" aria-hidden="true" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ photoLoading ? t('speakers.photoLoading') : photoName }}</p>
                <button type="button" class="speaker-button mt-1 flex min-h-11 items-center gap-2 text-sm underline decoration-[var(--line)] underline-offset-4 hover:decoration-[var(--ink)]" @click="photoInput?.click()">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></svg>
                  {{ t('speakers.replacePhoto') }}
                </button>
              </div>
            </div>
            <input ref="photoInput" type="file" accept="image/png,image/webp" class="hidden" :aria-label="t('speakers.replacePhoto')" @change="choosePhoto" />
            <p id="speaker-photo-help" class="mt-3 text-xs leading-relaxed speaker-muted">{{ t('speakers.photoHelp') }}</p>
            <p v-if="photoError" class="mt-2 text-sm speaker-error" role="alert">{{ t(photoError) }}</p>
            <fieldset class="mt-4">
              <legend class="mb-2 text-xs font-medium">{{ t('speakers.availablePhotos') }}</legend>
              <div class="grid grid-cols-3 gap-2">
                <button v-for="photo in BUILTIN_PHOTOS" :key="photo.id" type="button" class="speaker-button min-w-0 overflow-hidden rounded-lg border p-2 text-left" :class="activeVariant.photoId === photo.id ? 'border-[var(--ink)] bg-white' : 'border-[var(--line)]'" :aria-pressed="activeVariant.photoId === photo.id" :aria-label="t('speakers.choosePhoto', { name: photo.name })" @click="selectPhoto(photo)">
                  <img :src="photo.src" alt="" class="mb-2 h-16 w-full object-contain object-bottom" />
                  <span class="block text-xs leading-snug">{{ photo.name }}</span>
                </button>
              </div>
            </fieldset>
          </section>

          <section aria-labelledby="speaker-details-title" class="space-y-4 border-b border-[var(--line)] py-6">
            <h2 id="speaker-details-title" class="text-sm font-semibold">{{ t('speakers.speakerDetails') }}</h2>
            <div class="grid gap-2">
              <label for="speaker-talk-title" class="text-xs font-medium">{{ t('speakers.talkTitle') }}</label>
              <textarea id="speaker-talk-title" v-model="draft.talkTitle" rows="3" maxlength="160" class="speaker-input min-h-24 resize-y" :placeholder="t('speakers.talkTitlePlaceholder')" />
            </div>
            <div class="grid gap-2">
              <label for="speaker-name" class="text-xs font-medium">{{ t('speakers.name') }}</label>
              <input id="speaker-name" maxlength="120" ref="nameInput" v-model="draft.name" type="text" autocomplete="off" required class="speaker-input" :aria-invalid="nameTouched && nameInvalid" :aria-describedby="nameTouched && nameInvalid ? 'speaker-name-error' : undefined" @blur="nameTouched = true" />
              <p v-if="nameTouched && nameInvalid" id="speaker-name-error" class="text-xs speaker-error" role="alert">{{ t('speakers.nameRequired') }}</p>
            </div>
            <div class="grid gap-2">
              <label for="speaker-label" class="text-xs font-medium">{{ t('speakers.label') }}</label>
              <input id="speaker-label" maxlength="60" v-model="draft.label" type="text" class="speaker-input" />
            </div>
            <div class="grid gap-2">
              <label for="speaker-role" class="text-xs font-medium">{{ t('speakers.role') }}</label>
              <input id="speaker-role" maxlength="240" v-model="draft.role" type="text" class="speaker-input" />
            </div>
          </section>

          <details class="speaker-details border-b border-[var(--line)]">
            <summary class="speaker-button flex min-h-16 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
              {{ t('speakers.eventDetails') }}
              <svg class="speaker-chevron shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
            </summary>
            <div class="space-y-4 pb-6">
              <div v-for="field in eventFields" :key="field" class="grid gap-2">
                <label :for="`speaker-${field}`" class="flex items-center justify-between gap-2 text-xs font-medium">
                  {{ t(`speakers.${field}`) }}
                  <span v-if="['time', 'venue', 'url'].includes(field)" class="font-normal speaker-muted">{{ t('speakers.optional') }}</span>
                </label>
                <input :id="`speaker-${field}`" :maxlength="field === 'url' ? 500 : field === 'venue' ? 240 : field === 'time' ? 80 : 120" v-model="draft[field]" type="text" :inputmode="field === 'url' ? 'url' : 'text'" class="speaker-input" />
              </div>
            </div>
          </details>

          <details class="speaker-details border-b border-[var(--line)]">
            <summary class="speaker-button flex min-h-16 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
              {{ t('speakers.composition') }}
              <svg class="speaker-chevron shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
            </summary>
            <div class="pb-5">
              <div class="mb-4 flex items-center justify-between gap-3">
                <p class="text-xs font-semibold">{{ t('speakers.portrait') }}</p>
                <button type="button" class="speaker-button min-h-11 text-xs underline underline-offset-4 speaker-muted" @click="resetComposition">{{ t('speakers.resetComposition') }}</button>
              </div>
              <div v-for="control in portraitControls" :key="control.key" class="mb-3 grid gap-1">
                <div class="flex items-center justify-between gap-3 text-xs">
                  <label :for="`speaker-${control.key}`">{{ t(control.label) }}</label>
                  <output :for="`speaker-${control.key}`" class="tabular-nums speaker-muted">{{ draft[control.key] }}%</output>
                </div>
                <input :id="`speaker-${control.key}`" v-model.number="draft[control.key]" type="range" :min="control.min" :max="control.max" step="1" class="speaker-range" />
              </div>
              <label class="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-[var(--line)] pt-4 text-xs font-semibold">
                {{ t('speakers.showBots') }}
                <input v-model="draft.botsVisible" type="checkbox" class="h-5 w-5 accent-[var(--ink)]" />
              </label>
              <div class="mt-4 grid gap-1" :class="{ 'opacity-45': !draft.botsVisible }">
                <div class="flex items-center justify-between gap-3 text-xs">
                  <label for="speaker-bots-scale">{{ t('speakers.botSize') }}</label>
                  <output for="speaker-bots-scale" class="tabular-nums speaker-muted">{{ draft.botsScale }}%</output>
                </div>
                <input id="speaker-bots-scale" v-model.number="draft.botsScale" type="range" min="60" max="130" step="1" class="speaker-range" :disabled="!draft.botsVisible" />
              </div>
            </div>
          </details>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.speaker-editor { --speaker-muted: #656c7b; --speaker-error: #a52721; }
.speaker-stage { width: 100%; margin-inline: auto; }
.speaker-muted { color: var(--speaker-muted); }
.speaker-error { color: var(--speaker-error); }
.speaker-button { cursor: pointer; transition: opacity 160ms ease, transform 160ms ease; }
.speaker-button:not(:disabled):active { transform: scale(0.98); }
.speaker-button:disabled { cursor: not-allowed; opacity: 0.45; }
.speaker-button:focus-visible, .speaker-input:focus-visible, .speaker-range:focus-visible, input[type='checkbox']:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.speaker-input { width: 100%; min-width: 0; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; background: white; padding: 10px 12px; color: var(--ink); font-size: 14px; line-height: 1.5; transition: border-color 160ms ease; }
.speaker-input:hover { border-color: var(--speaker-muted); }
.speaker-input[aria-invalid='true'] { border-color: var(--speaker-error); }
.speaker-range { width: 100%; height: 44px; accent-color: var(--ink); cursor: pointer; }
.speaker-range:disabled { cursor: not-allowed; }
.speaker-details > summary { list-style: none; }
.speaker-details > summary::-webkit-details-marker { display: none; }
.speaker-chevron { transition: transform 180ms ease; }
.speaker-details[open] > summary .speaker-chevron { transform: rotate(180deg); }
.speaker-skeleton { animation: speaker-loading 1.4s ease-in-out infinite alternate; }
@keyframes speaker-loading { from { opacity: 0.5; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .speaker-button, .speaker-input, .speaker-chevron { transition: none; }
  .speaker-skeleton { animation: none; }
}
@media (width < 40rem) { .speaker-input { font-size: 16px; } }
@media (width >= 64rem) {
  .speaker-stage { max-width: calc(max(280px, 100dvh - 290px) * var(--speaker-aspect)); }
}
</style>
