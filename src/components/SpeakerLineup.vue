<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { t, type Cle } from '@/i18n'
import { telecharge } from '@/ui/capture'
import { ASPECTS, speakerExportDimensions, type AspectRatio, type SpeakerDraft, type SpeakerExportFormat } from '@/ui/speaker'
import type { SpeakerPhoto, SpeakerVariant } from '@/ui/speakerLibrary'
import {
  createSpeakerLineupDraft,
  createSpeakerLineupAnimationSnapshot,
  exportSpeakerLineup,
  loadSpeakerLineupAssets,
  releaseSpeakerLineupAssets,
  renderSpeakerLineup,
  speakerLineupFilename,
  type SpeakerLineupAssets
} from '@/ui/speakerLineupRender'
import { downloadSpeakerAnimation, SpeakerRenderError } from '@/ui/speakerRenderClient'

const props = defineProps<{
  variants: readonly SpeakerVariant[]
  photos: readonly SpeakerPhoto[]
  event: SpeakerDraft
  format: SpeakerExportFormat
  active: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ exporting: [value: boolean]; edit: [variantId: string] }>()
const SpeakerAnimationPreview = defineAsyncComponent(() => import('./SpeakerAnimationPreview.vue'))
const aspect = ref<AspectRatio>('1:1')
const draft = computed(() => ({
  ...createSpeakerLineupDraft(props.variants, props.event, t('speakers.lineupTitle')),
  aspect: aspect.value
}))
const animated = computed(() => props.format === 'mp4' || props.format === 'gif')
const dimensions = computed(() => speakerExportDimensions(aspect.value, props.format))
const assets = shallowRef<SpeakerLineupAssets>()
const loading = ref(false)
const assetError = ref(false)
const previewError = ref(false)
const exporting = ref(false)
const exportStatus = ref<'idle' | 'done' | 'error' | 'cancelled'>('idle')
const exportError = ref<Cle>('speakers.exportError')
const progress = ref(0)
const canvas = ref<HTMLCanvasElement>()
const preview = ref<HTMLElement>()
const previewWidth = ref(1000)
const missingTitles = computed(() => props.variants.filter((variant) => !variant.draft.talkTitle.trim()).length)
const missingNames = computed(() => props.variants.some((variant) => !variant.draft.name.trim()))
const ready = computed(() => props.variants.length > 0 && !!assets.value && !loading.value && !assetError.value && !previewError.value)
const locked = computed(() => exporting.value || !!props.busy)
const canvasLabel = computed(() => t('speakers.lineupPreviewAria', {
  event: [draft.value.event, draft.value.city].filter(Boolean).join(' · '),
  aspect: aspect.value
}))
const snapshotFactory = computed(() => {
  const capturedAssets = assets.value
  if (!capturedAssets) return undefined
  const capturedDraft = { ...draft.value, speakers: draft.value.speakers.map((speaker) => ({ ...speaker })) }
  return (width: number) => createSpeakerLineupAnimationSnapshot(capturedDraft, capturedAssets, width)
})
const assetSources = computed(() => JSON.stringify({
  photos: props.variants.map((variant) => [variant.photoId, props.photos.find((photo) => photo.id === variant.photoId)?.src]),
  botsVisible: draft.value.botsVisible
}))

let disposed = false
let assetRequest = 0
let frame = 0
let resizeObserver: ResizeObserver | undefined
let assetController: AbortController | undefined
let renderController: AbortController | undefined

function discardAssets() {
  if (assets.value) releaseSpeakerLineupAssets(assets.value)
  assets.value = undefined
}

async function loadAssets() {
  const request = ++assetRequest
  assetController?.abort()
  const controller = new AbortController()
  assetController = controller
  discardAssets()
  assetError.value = false
  previewError.value = false
  loading.value = props.variants.length > 0
  if (!props.variants.length) return
  const variants = props.variants.map((variant) => ({ ...variant, draft: { ...variant.draft } }))
  const photos = props.photos.map((photo) => ({ ...photo }))
  try {
    const loaded = await loadSpeakerLineupAssets(variants, photos, draft.value.botsVisible, controller.signal)
    if (disposed || request !== assetRequest || controller.signal.aborted) {
      releaseSpeakerLineupAssets(loaded)
      return
    }
    assets.value = loaded
    scheduleRender()
  } catch {
    if (!disposed && request === assetRequest && !controller.signal.aborted) assetError.value = true
  } finally {
    if (!disposed && request === assetRequest) loading.value = false
    if (assetController === controller) assetController = undefined
  }
}

function scheduleRender() {
  if (disposed || frame || !props.active) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!props.active || !canvas.value || !assets.value) return
    try {
      renderSpeakerLineup(canvas.value, draft.value, assets.value, dimensions.value.width)
      previewError.value = false
    } catch {
      previewError.value = true
    }
  })
}

async function download() {
  if (locked.value || !ready.value || missingNames.value) return
  // Garder les textes et les portraits du clic jusqu'a la fin de cet export.
  const variants = props.variants.map((variant) => ({ ...variant, draft: { ...variant.draft } }))
  const photos = props.photos.map((photo) => ({ ...photo }))
  const snapshot = { ...draft.value, speakers: draft.value.speakers.map((speaker) => ({ ...speaker })) }
  const format = props.format
  const controller = new AbortController()
  renderController = controller
  exporting.value = true
  emit('exporting', true)
  exportStatus.value = 'idle'
  progress.value = 0
  let snapshotAssets: SpeakerLineupAssets | undefined
  try {
    snapshotAssets = await loadSpeakerLineupAssets(variants, photos, snapshot.botsVisible, controller.signal)
    controller.signal.throwIfAborted()
    let blob: Blob
    if (format === 'mp4' || format === 'gif') {
      const size = speakerExportDimensions(snapshot.aspect, format)
      const composition = await createSpeakerLineupAnimationSnapshot(snapshot, snapshotAssets, size.width)
      controller.signal.throwIfAborted()
      blob = await downloadSpeakerAnimation(composition, format, controller.signal, (value) => {
        if (!disposed) progress.value = value
      })
    } else blob = await exportSpeakerLineup(snapshot, snapshotAssets, format)
    controller.signal.throwIfAborted()
    if (disposed) return
    telecharge(blob, speakerLineupFilename(snapshot.aspect, format))
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
    if (snapshotAssets) releaseSpeakerLineupAssets(snapshotAssets)
    if (renderController === controller) renderController = undefined
    exporting.value = false
    emit('exporting', false)
  }
}

watch(assetSources, () => { void loadAssets() })
watch([draft, dimensions], () => {
  if (!exporting.value) exportStatus.value = 'idle'
  scheduleRender()
}, { deep: true })
watch(() => props.format, () => { if (!exporting.value) exportStatus.value = 'idle' })
watch(() => props.busy, (busy) => { if (busy) exportStatus.value = 'idle' })
watch(() => props.active, (active) => { if (active) scheduleRender() })

onMounted(() => {
  void loadAssets()
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width <= 0) return
    previewWidth.value = Math.round(Math.min(1600, Math.max(480, entry.contentRect.width * Math.min(devicePixelRatio || 1, 2))))
  })
  if (preview.value) resizeObserver.observe(preview.value)
})

onBeforeUnmount(() => {
  disposed = true
  assetRequest++
  assetController?.abort()
  renderController?.abort()
  resizeObserver?.disconnect()
  cancelAnimationFrame(frame)
  discardAssets()
})
</script>

<template>
  <div class="grid min-w-0 items-start gap-8 xl:gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
    <div class="min-w-0 lg:sticky lg:top-9">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <fieldset class="flex rounded-xl border border-[var(--line)] bg-white p-1" :disabled="locked">
          <legend class="sr-only">{{ t('speakers.aspectRatio') }}</legend>
          <label v-for="choice in ASPECTS" :key="choice.id" class="relative cursor-pointer">
            <input v-model="aspect" class="peer sr-only" type="radio" name="speaker-lineup-aspect" :value="choice.id" />
            <span class="flex min-h-11 min-w-16 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors peer-checked:bg-[var(--ink)] peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ink)] peer-disabled:opacity-45">{{ choice.id }}</span>
          </label>
        </fieldset>
        <span class="text-xs tabular-nums speaker-muted">{{ dimensions.width }} × {{ dimensions.height }} px</span>
      </div>

      <div ref="preview" class="speaker-stage relative overflow-hidden rounded-2xl bg-[#080808] shadow-[0_8px_30px_-18px_rgba(0,0,0,0.3)]" :style="{ aspectRatio: `${dimensions.width} / ${dimensions.height}`, '--speaker-aspect': dimensions.width / dimensions.height }" :aria-busy="loading">
        <canvas ref="canvas" class="block h-full w-full" :class="{ 'opacity-0': !assets || animated }" :aria-hidden="animated" role="img" :aria-label="canvasLabel">{{ canvasLabel }}</canvas>
        <SpeakerAnimationPreview v-if="animated && snapshotFactory" :snapshot-factory="snapshotFactory" :width="Math.min(previewWidth, dimensions.width)" :active="active" :label="canvasLabel" />
        <div v-if="!assets" class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white" role="status">
          <p>{{ t(!variants.length ? 'speakers.lineupEmpty' : assetError ? 'speakers.artworkError' : 'speakers.loading') }}</p>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" class="speaker-button flex min-h-13 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-5 text-sm font-medium text-white" :disabled="!ready || missingNames || locked" :aria-busy="exporting" @click="download">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
          {{ t(exporting ? 'speakers.exporting' : 'speakers.download') }}<span v-if="!exporting">· {{ format.toUpperCase() }}</span>
        </button>
        <button v-if="exporting" type="button" class="speaker-button min-h-11 px-3 text-sm underline underline-offset-4" @click="renderController?.abort()">{{ t('speakers.cancelExport') }}</button>
        <span class="ml-auto text-xs speaker-muted">{{ t(animated ? 'speakers.animatedNote' : 'speakers.previewNote') }}</span>
      </div>
      <div class="mt-3 min-h-5 text-xs speaker-muted" role="status">
        <span v-if="exportStatus === 'done'" class="font-medium text-[var(--ink)]">{{ t('speakers.downloaded') }}</span>
        <span v-else-if="exportStatus === 'cancelled'">{{ t('speakers.exportCancelled') }}</span>
        <span v-else-if="exporting && animated">{{ t('speakers.renderProgress', { progress }) }}</span>
        <span v-else-if="exporting">{{ t('speakers.exporting') }}</span>
        <span v-else>{{ t(format === 'mp4' ? 'speakers.mp4LoopNote' : format === 'gif' ? 'speakers.gifLoopNote' : 'speakers.exportQuality') }}</span>
      </div>
      <progress v-if="exporting && animated" class="mt-2 h-1 w-full accent-[var(--ink)]" :value="progress" max="100" :aria-label="t('speakers.renderProgress', { progress })" />
      <div v-if="exportStatus === 'error'" class="mt-2 flex flex-wrap items-center gap-3 text-sm speaker-error" role="alert">
        <p>{{ t(exportError) }}</p>
        <button type="button" class="speaker-button min-h-11 underline underline-offset-4" :disabled="!ready || missingNames || locked" @click="download">{{ t('speakers.retryExport') }}</button>
      </div>
      <div v-if="assetError || previewError" class="mt-3 flex flex-wrap items-center gap-3 text-sm speaker-error" role="alert">
        <span>{{ t(assetError ? 'speakers.artworkError' : 'speakers.previewError') }}</span>
        <button type="button" class="speaker-button min-h-11 underline underline-offset-4" :disabled="locked" @click="assetError ? loadAssets() : scheduleRender()">{{ t('speakers.retry') }}</button>
      </div>
    </div>

    <aside class="min-w-0" aria-labelledby="speaker-lineup-title">
      <h2 id="speaker-lineup-title" class="text-sm font-semibold">{{ t('speakers.lineupTitle') }}</h2>
      <p class="mt-2 text-sm leading-relaxed speaker-muted">{{ t('speakers.lineupDescription') }}</p>
      <p v-if="missingTitles" class="mt-3 text-xs leading-relaxed speaker-muted" role="status">{{ t('speakers.lineupMissingTitles', { count: missingTitles }) }}</p>
      <p v-if="missingNames" class="mt-3 text-sm speaker-error">{{ t('speakers.nameRequired') }}</p>
      <ol class="mt-5 divide-y divide-[var(--line)]">
        <li v-for="variant in variants" :key="variant.id" class="py-4 first:pt-0">
          <p class="text-sm font-semibold">{{ variant.draft.name.trim() || t('speakers.unnamedVariant') }}</p>
          <p v-if="variant.draft.talkTitle.trim()" class="mt-1 text-sm leading-relaxed speaker-muted">{{ variant.draft.talkTitle }}</p>
          <button type="button" class="speaker-button mt-1 min-h-11 text-left text-xs underline underline-offset-4" :disabled="locked" @click="emit('edit', variant.id)">{{ t('speakers.lineupEdit', { name: variant.draft.name.trim() || t('speakers.unnamedVariant') }) }}</button>
        </li>
      </ol>
    </aside>
  </div>
</template>

<style scoped>
.speaker-stage { width: 100%; margin-inline: auto; }
.speaker-muted { color: var(--speaker-muted, #656c7b); }
.speaker-error { color: var(--speaker-error, #a52721); }
.speaker-button { cursor: pointer; transition: opacity 160ms ease, transform 160ms ease; }
.speaker-button:not(:disabled):active { transform: scale(0.98); }
.speaker-button:disabled { cursor: not-allowed; opacity: 0.45; }
.speaker-button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .speaker-button { transition: none; } }
@media (width >= 64rem) {
  .speaker-stage { max-width: calc(max(280px, 100dvh - 330px) * var(--speaker-aspect)); }
}
</style>
