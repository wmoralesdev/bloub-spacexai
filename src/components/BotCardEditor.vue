<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Customizer from '@/components/Customizer.vue'
import BloubBot from '@/components/BloubBot.vue'
import { COLOR_BY_ID, SHAPE_BY_ID, type ColorId, type ShapeId } from '@/bot/skins'
import { EXPRESSION_BY_ID, type ExpressionId } from '@/bot/expressions'
import { POSE_FIGE } from '@/bot/figes'
import { t, type Cle } from '@/i18n'
import { cle } from '@/ui/stockage'
import { telecharge } from '@/ui/capture'
import { BOT_CARD_SIZE, BOT_CARD_PRINT_SIZE_MM, CARD_LIMITS, MAX_BOT_CARDS, createBotCard, parseBotCards, botCardFilename, normalizeBotCardUrl, validBotCardPrintSize, type BotCard, type BotCardFormat, type BotCardSide } from '@/ui/botCard'
import { exportBotCard, renderBotCardSvg } from '@/ui/botCardRender'
import { exportBotCardsZip } from '@/ui/botCardBatch'
import { printExportErrorKey } from '@/ui/printExport'

const readError = ref(false)
function restore() {
  try {
    const raw = localStorage.getItem(cle('bot-cards'))
    const restored = parseBotCards(raw)
    if (raw && raw !== '[]' && !restored.length) readError.value = true
    return restored
  } catch {
    readError.value = true
    return []
  }
}

const cards = ref<BotCard[]>(restore())
const selectedId = ref(cards.value[0]?.id ?? '')
const card = computed(() => cards.value.find((item) => item.id === selectedId.value))
const nameInput = ref<HTMLInputElement>()
const linkInput = ref<HTMLInputElement>()
const nameTouched = ref(false)
const nameInvalid = computed(() => !!card.value && !card.value.name.trim())
const side = ref<BotCardSide>('back')
const linkTouched = ref(false)
const normalizedLink = computed(() => normalizeBotCardUrl(card.value?.url ?? ''))
const linkInvalid = computed(() => !!card.value?.url.trim() && !normalizedLink.value)
const backNeedsLink = computed(() => side.value === 'back' && !normalizedLink.value)
const confirmingDelete = ref(false)
const atLimit = computed(() => cards.value.length >= MAX_BOT_CARDS)
const saveStatus = ref<'saved' | 'saving' | 'error'>(readError.value ? 'error' : 'saved')
const exporting = ref<BotCardFormat | null>(null)
const exportStatus = ref<'idle' | 'done' | 'error'>('idle')
const exportErrorKey = ref<Cle>('botCards.exportError')
const batchExporting = ref<BotCardFormat | null>(null)
const batchErrorKey = ref<Cle>('botCards.batchError')
const printSizeCm = ref<number | string>(BOT_CARD_PRINT_SIZE_MM / 10)
const printSizeInput = ref<HTMLInputElement>()
const printSizeMm = computed(() => Number(printSizeCm.value) * 10)
const printSizeInvalid = computed(() => !validBotCardPrintSize(printSizeMm.value))
const exportBusy = computed(() => !!exporting.value || !!batchExporting.value)
const batchStatus = ref<'idle' | 'done' | 'error' | 'name' | 'link'>('idle')
const batchInvalidCard = ref(0)
const batchProgress = ref({ completed: 0, total: 0 })
const batchStatusKey = computed(() => ({
  idle: 'botCards.batchDownloaded', done: 'botCards.batchDownloaded', error: batchErrorKey.value,
  name: 'botCards.batchNameRequired', link: 'botCards.batchLinkRequired'
} as const)[batchStatus.value])
const previewSource = ref('')
const previewBusy = ref(false)
const previewError = ref(false)
let previewRequest = 0
let draftRevision = 0
let disposed = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let batchController: AbortController | undefined
let exportController: AbortController | undefined

// Les palettes restent celles du bot ; la couleur libre appartient a la carte.
const shape = computed<string>({
  get: () => card.value?.shape ?? 'cercle',
  set: (value) => { if (card.value && SHAPE_BY_ID.has(value)) card.value.shape = value as ShapeId }
})
const color = computed<string>({
  get: () => card.value?.color ?? 'vert',
  set: (value) => {
    if (!card.value || !COLOR_BY_ID.has(value)) return
    card.value.color = value as ColorId
    card.value.bodyColor = ''
  }
})
const expression = computed<string>({
  get: () => card.value?.expression ?? 'neutre',
  set: (value) => { if (card.value && EXPRESSION_BY_ID.has(value)) card.value.expression = value as ExpressionId }
})
const bodyColor = computed(() => card.value?.bodyColor || COLOR_BY_ID.get(color.value)!.hex)

function flushSave() {
  clearTimeout(saveTimer)
  if (!dirty) return
  try {
    localStorage.setItem(cle('bot-cards'), JSON.stringify(cards.value))
    dirty = false
    readError.value = false
    saveStatus.value = 'saved'
  } catch {
    saveStatus.value = 'error'
  }
}

function scheduleSave() {
  dirty = true
  saveStatus.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 400)
}

async function addCard(duplicate = false) {
  if (atLimit.value) return
  const item = createBotCard(cards.value)
  if (duplicate && card.value) Object.assign(item, { ...card.value, id: item.id })
  cards.value.push(item)
  selectCard(item.id)
  await nextTick()
  nameInput.value?.focus()
}

function selectCard(id: string) {
  selectedId.value = id
  nameTouched.value = false
  linkTouched.value = false
  confirmingDelete.value = false
  exportStatus.value = 'idle'
}

function removeCard() {
  const index = cards.value.findIndex((item) => item.id === selectedId.value)
  if (index < 0) return
  cards.value.splice(index, 1)
  selectCard(cards.value[Math.min(index, cards.value.length - 1)]?.id ?? '')
}

async function updatePreview() {
  const request = ++previewRequest
  previewError.value = false
  if (!card.value) {
    previewSource.value = ''
    previewBusy.value = false
    return
  }
  previewBusy.value = true
  try {
    const markup = await renderBotCardSvg({ ...card.value }, side.value)
    if (disposed || request !== previewRequest) return
    previewSource.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  } catch {
    if (disposed || request !== previewRequest) return
    previewSource.value = ''
    previewError.value = true
  } finally {
    if (!disposed && request === previewRequest) previewBusy.value = false
  }
}

async function download(format: BotCardFormat) {
  if (!card.value || exportBusy.value) return
  if (format === 'pdf' && printSizeInvalid.value) {
    printSizeInput.value?.focus()
    return
  }
  nameTouched.value = true
  if (nameInvalid.value) {
    nameInput.value?.focus()
    return
  }
  if (backNeedsLink.value) {
    linkTouched.value = true
    linkInput.value?.focus()
    return
  }
  // Une modification pendant l'encodage ne doit pas renommer l'image precedente.
  const snapshot = { ...card.value }
  const selectedSide = side.value
  const printOptions = { sizeMm: printSizeMm.value }
  const controller = new AbortController()
  exportController = controller
  const revision = draftRevision
  exporting.value = format
  exportStatus.value = 'idle'
  try {
    const blob = format === 'pdf'
      ? await exportBotCard(snapshot, format, selectedSide, printOptions, controller.signal)
      : await exportBotCard(snapshot, format, selectedSide)
    if (disposed || controller.signal.aborted) return
    telecharge(blob, botCardFilename(snapshot, format, selectedSide))
    if (revision === draftRevision) exportStatus.value = 'done'
  } catch (error) {
    if (!disposed && !controller.signal.aborted && revision === draftRevision) {
      exportErrorKey.value = format === 'pdf' ? printExportErrorKey(error) : 'botCards.exportError'
      exportStatus.value = 'error'
    }
  } finally {
    exporting.value = null
    exportController = undefined
  }
}

async function downloadAll(format: BotCardFormat) {
  if (!cards.value.length || exportBusy.value) return
  if (format === 'pdf' && printSizeInvalid.value) {
    printSizeInput.value?.focus()
    return
  }
  const snapshot = cards.value.map((item) => ({ ...item }))
  const printOptions = { sizeMm: printSizeMm.value }
  const invalidIndex = snapshot.findIndex((item) => !item.name.trim() || !normalizeBotCardUrl(item.url))
  if (invalidIndex >= 0) {
    const invalid = snapshot[invalidIndex]!
    selectCard(invalid.id)
    batchInvalidCard.value = invalidIndex + 1
    if (!invalid.name.trim()) {
      nameTouched.value = true
      batchStatus.value = 'name'
    } else {
      side.value = 'back'
      linkTouched.value = true
      batchStatus.value = 'link'
    }
    await nextTick()
    if (disposed) return
    if (batchStatus.value === 'name') nameInput.value?.focus()
    else linkInput.value?.focus()
    return
  }
  const controller = new AbortController()
  batchController = controller
  batchExporting.value = format
  batchStatus.value = 'idle'
  batchProgress.value = { completed: 0, total: snapshot.length * 2 }
  try {
    const blob = await exportBotCardsZip(snapshot, format, (completed, total) => {
      if (!disposed && !controller.signal.aborted) batchProgress.value = { completed, total }
    }, controller.signal, format === 'pdf' ? printOptions : undefined)
    if (disposed || controller.signal.aborted) return
    telecharge(blob, `bot-cards-${format === 'pdf' ? 'cmyk-pdf' : format}.zip`)
    batchStatus.value = 'done'
  } catch (error) {
    if (!disposed && !controller.signal.aborted) {
      batchErrorKey.value = format === 'pdf' ? printExportErrorKey(error) : 'botCards.batchError'
      batchStatus.value = 'error'
    }
  } finally {
    batchExporting.value = null
    batchController = undefined
  }
}

watch(cards, () => {
  scheduleSave()
  if (!batchExporting.value) batchStatus.value = 'idle'
}, { deep: true, flush: 'sync' })
watch([card, side], () => { draftRevision++; exportStatus.value = 'idle'; void updatePreview() }, { deep: true, immediate: true })
watch(printSizeCm, () => {
  draftRevision++
  exportStatus.value = 'idle'
  if (!batchExporting.value) batchStatus.value = 'idle'
})
function pagehide() {
  exportController?.abort()
  batchController?.abort()
  flushSave()
}
window.addEventListener('pagehide', pagehide)
onBeforeUnmount(() => {
  disposed = true
  exportController?.abort()
  batchController?.abort()
  previewRequest++
  flushSave()
  window.removeEventListener('pagehide', pagehide)
})
</script>

<template>
  <section class="bot-card-editor min-h-full px-5 pt-24 pb-10 lg:h-full lg:overflow-y-auto lg:py-10 lg:pr-10 lg:pl-28" aria-labelledby="bot-cards-title">
    <div class="mx-auto max-w-6xl">
      <header class="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="bot-cards-title" class="text-2xl font-semibold tracking-tight">{{ t('botCards.title') }}</h2>
          <p class="mt-2 max-w-lg text-sm leading-relaxed text-[var(--muted)]">{{ t('botCards.description') }}</p>
        </div>
        <button v-if="cards.length" type="button" class="card-button card-button-primary" :disabled="atLimit" @click="addCard()">
          <span aria-hidden="true" class="text-lg leading-none">+</span>{{ t('botCards.newCard') }}
        </button>
      </header>

      <div v-if="saveStatus === 'error'" role="alert" class="mb-5 text-sm text-[var(--card-error)]">
        <p>{{ t(readError ? 'botCards.readError' : 'botCards.saveError') }}</p>
        <button v-if="dirty" type="button" class="card-button underline underline-offset-4" @click="flushSave">{{ t('botCards.retrySave') }}</button>
      </div>

      <div v-if="!card" class="card-empty flex min-h-[60dvh] flex-col items-center justify-center text-center">
        <BloubBot shape="galet" color="violet" expression="neutre" :size="110" :frozen-at="POSE_FIGE" :follow="false" />
        <h3 class="mt-5 text-xl font-medium tracking-tight">{{ t('botCards.emptyTitle') }}</h3>
        <p class="mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted)]">{{ t('botCards.emptyDescription') }}</p>
        <button type="button" class="card-button card-button-primary mt-6" @click="addCard()"><span aria-hidden="true" class="text-lg leading-none">+</span>{{ t('botCards.newCard') }}</button>
      </div>

      <div v-else class="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div class="min-w-0 lg:sticky lg:top-0">
          <div class="card-preview mx-auto">
            <div class="mb-3 flex items-center justify-between gap-3">
              <span class="text-xs font-medium text-[var(--muted)]">{{ t('botCards.side') }}</span>
              <div role="group" :aria-label="t('botCards.side')" class="card-side-control flex rounded-xl border border-[var(--line)] p-1">
                <button v-for="face in (['front', 'back'] as const)" :key="face" type="button" class="card-button" :class="side === face ? 'card-button-primary' : 'text-[var(--muted)]'" :aria-pressed="side === face" @click="side = face">{{ t(`botCards.${face}`) }}</button>
              </div>
            </div>
            <div class="aspect-square overflow-hidden border border-[var(--line)] bg-white" :aria-busy="previewBusy">
              <img v-if="previewSource" :src="previewSource" :alt="t('botCards.previewSideAria', { name: card.name || t('botCards.untitled'), side: t(`botCards.${side}`) })" :width="BOT_CARD_SIZE" :height="BOT_CARD_SIZE" class="block h-full w-full" />
              <p v-else-if="previewError" role="alert" class="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--card-error)]">{{ t('botCards.previewError') }}</p>
            </div>
            <div class="mt-3 flex flex-wrap justify-between gap-2 text-xs text-[var(--muted)]">
              <span>{{ t(`botCards.${side}`) }} · {{ t('botCards.previewNote') }}</span><span>{{ t('botCards.squareExport') }}</span>
            </div>
            <p v-if="backNeedsLink" class="mt-3 text-xs leading-relaxed text-[var(--muted)]">{{ t('botCards.linkRequired') }}</p>
            <div class="mt-5 grid grid-cols-2 gap-3">
              <button type="button" class="card-button card-button-primary" :disabled="exportBusy || nameInvalid || backNeedsLink" @click="download('png')">{{ t(exporting === 'png' ? 'botCards.exporting' : 'botCards.downloadPng') }}</button>
              <button type="button" class="card-button card-button-outline" :disabled="exportBusy || nameInvalid || backNeedsLink" @click="download('svg')">{{ t(exporting === 'svg' ? 'botCards.exporting' : 'botCards.downloadSvg') }}</button>
            </div>
            <div class="mt-5 border-t border-[var(--line)] pt-4">
              <div class="grid items-end gap-3 sm:grid-cols-2">
                <div class="grid gap-2">
                  <label for="bot-card-print-size" class="text-xs font-medium">{{ t('botCards.printSize') }}</label>
                  <input id="bot-card-print-size" ref="printSizeInput" v-model.number="printSizeCm" type="number" min="1" max="30" step="0.1" inputmode="decimal" class="card-input" :aria-invalid="printSizeInvalid" :aria-describedby="printSizeInvalid ? 'bot-card-print-help bot-card-print-error' : 'bot-card-print-help'" />
                </div>
                <button type="button" class="card-button card-button-outline" :disabled="exportBusy || nameInvalid || backNeedsLink || printSizeInvalid" @click="download('pdf')">{{ t(exporting === 'pdf' ? 'botCards.exporting' : 'botCards.downloadPdf') }}</button>
              </div>
              <p id="bot-card-print-help" class="mt-2 text-xs leading-relaxed text-[var(--muted)]">{{ t('botCards.printHelp') }}</p>
              <p v-if="printSizeInvalid" id="bot-card-print-error" role="alert" class="mt-2 text-xs text-[var(--card-error)]">{{ t('botCards.invalidPrintSize') }}</p>
            </div>
            <p v-if="exportStatus !== 'idle'" :role="exportStatus === 'error' ? 'alert' : 'status'" class="mt-3 text-sm" :class="exportStatus === 'error' ? 'text-[var(--card-error)]' : 'text-[var(--muted)]'">{{ t(exportStatus === 'done' ? 'botCards.downloaded' : exportErrorKey) }}</p>
          </div>
        </div>

        <form class="min-w-0" novalidate @submit.prevent="download('png')">
          <section class="mb-5 border-b border-[var(--line)] pb-4">
            <label for="bot-card-selected" class="mb-2 block text-sm font-semibold">{{ t('botCards.savedCards') }} <span class="ml-1 font-normal text-[var(--muted)]">{{ cards.length }}</span></label>
            <select id="bot-card-selected" :value="selectedId" class="card-input" @change="selectCard(($event.target as HTMLSelectElement).value)">
              <option v-for="(item, index) in cards" :key="item.id" :value="item.id">{{ index + 1 }}. {{ item.name.trim() || t('botCards.untitled') }}</option>
            </select>
            <div class="flex items-center justify-between gap-3 text-xs">
              <button type="button" class="card-button px-0!" :disabled="atLimit" @click="addCard(true)">{{ t('botCards.duplicate') }}</button>
              <button type="button" class="card-button px-0! text-[var(--muted)]" @click="confirmingDelete = !confirmingDelete">{{ t('botCards.deleteCard') }}</button>
            </div>
            <div v-if="confirmingDelete" class="mb-3 border-t border-[var(--line)] pt-3 text-sm">
              <p>{{ t('botCards.deleteConfirm') }}</p>
              <div class="flex gap-4">
                <button type="button" class="card-button px-0! text-[var(--card-error)]" @click="removeCard">{{ t('botCards.confirmDelete') }}</button>
                <button type="button" class="card-button px-0!" @click="confirmingDelete = false">{{ t('botCards.cancel') }}</button>
              </div>
            </div>
            <p v-if="atLimit" class="mb-2 text-xs text-[var(--muted)]">{{ t('botCards.limitReached', { n: MAX_BOT_CARDS }) }}</p>
            <p v-if="saveStatus !== 'error'" role="status" class="text-xs text-[var(--muted)]">{{ t(saveStatus === 'saving' ? 'botCards.saving' : 'botCards.savedLocally') }}</p>
            <div class="mt-4" :aria-busy="!!batchExporting">
              <p class="text-xs leading-relaxed text-[var(--muted)]">{{ t('botCards.batchHelp') }}</p>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button type="button" class="card-button card-button-outline" :disabled="exportBusy" @click="downloadAll('png')">{{ t('botCards.downloadAllPng') }}</button>
                <button type="button" class="card-button card-button-outline" :disabled="exportBusy" @click="downloadAll('svg')">{{ t('botCards.downloadAllSvg') }}</button>
                <button type="button" class="card-button card-button-outline col-span-2" :disabled="exportBusy || printSizeInvalid" :aria-describedby="printSizeInvalid ? 'bot-card-print-error' : 'bot-card-print-help'" @click="downloadAll('pdf')">{{ t('botCards.downloadAllPdf') }}</button>
              </div>
              <p v-if="batchExporting" role="status" class="mt-3 text-xs text-[var(--muted)] tabular-nums">{{ t('botCards.batchProgress', { completed: batchProgress.completed, total: batchProgress.total }) }}</p>
              <p v-else-if="batchStatus !== 'idle'" :role="batchStatus === 'done' ? 'status' : 'alert'" class="mt-3 text-xs leading-relaxed" :class="batchStatus === 'done' ? 'text-[var(--muted)]' : 'text-[var(--card-error)]'">{{ t(batchStatusKey, { n: batchInvalidCard }) }}</p>
            </div>
          </section>

          <div class="mb-5 grid gap-2">
            <label for="bot-card-event-name" class="text-xs font-medium">{{ t('botCards.eventName') }}</label>
            <textarea id="bot-card-event-name" v-model="card.eventName" rows="2" :maxlength="CARD_LIMITS.eventName" autocomplete="off" class="card-input resize-y" :placeholder="t('botCards.eventNamePlaceholder')" aria-describedby="bot-card-event-name-help" />
            <p id="bot-card-event-name-help" class="text-xs leading-relaxed text-[var(--muted)]">{{ t('botCards.eventNameHelp') }}</p>
          </div>

          <div class="mb-5 grid gap-2">
            <label for="bot-card-link" class="text-xs font-medium">{{ t('botCards.link') }}</label>
            <input id="bot-card-link" ref="linkInput" v-model="card.url" type="url" :maxlength="CARD_LIMITS.url" inputmode="url" autocomplete="off" autocapitalize="none" :spellcheck="false" class="card-input" :placeholder="t('botCards.linkPlaceholder')" :aria-invalid="linkInvalid || (linkTouched && backNeedsLink)" :aria-describedby="linkInvalid || (linkTouched && backNeedsLink) ? 'bot-card-link-error' : 'bot-card-link-help'" @blur="linkTouched = true" />
            <p id="bot-card-link-help" class="text-xs leading-relaxed text-[var(--muted)]">{{ t('botCards.linkHelp') }}</p>
            <p v-if="linkInvalid || (linkTouched && backNeedsLink)" id="bot-card-link-error" role="alert" class="text-xs text-[var(--card-error)]">{{ t(linkInvalid ? 'botCards.linkInvalid' : 'botCards.linkRequired') }}</p>
          </div>

          <div class="mb-4 grid gap-2">
            <label for="bot-card-name" class="text-xs font-medium">{{ t('botCards.name') }}</label>
            <input id="bot-card-name" ref="nameInput" v-model="card.name" type="text" required :maxlength="CARD_LIMITS.name" autocomplete="off" class="card-input" :placeholder="t('botCards.namePlaceholder')" :aria-invalid="nameTouched && nameInvalid" :aria-describedby="nameTouched && nameInvalid ? 'bot-card-name-error' : undefined" @blur="nameTouched = true" />
            <p v-if="nameTouched && nameInvalid" id="bot-card-name-error" role="alert" class="text-xs text-[var(--card-error)]">{{ t('botCards.nameRequired') }}</p>
          </div>
          <div class="mb-4 grid gap-2">
            <label for="bot-card-handle" class="text-xs font-medium">{{ t('botCards.handle') }}</label>
            <input id="bot-card-handle" v-model="card.handle" type="text" :maxlength="CARD_LIMITS.handle" autocomplete="off" autocapitalize="none" :spellcheck="false" class="card-input" :placeholder="t('botCards.handlePlaceholder')" />
          </div>
          <div class="mb-5 grid gap-2">
            <label for="bot-card-description" class="text-xs font-medium">{{ t('botCards.body') }}</label>
            <textarea id="bot-card-description" v-model="card.description" rows="5" :maxlength="CARD_LIMITS.description" class="card-input resize-y" :placeholder="t('botCards.bodyPlaceholder')" aria-describedby="bot-card-description-count" />
            <p id="bot-card-description-count" class="text-right text-xs text-[var(--muted)] tabular-nums">{{ card.description.length }} / {{ CARD_LIMITS.description }}</p>
          </div>

          <details class="card-details border-t border-[var(--line)]">
            <summary class="card-button flex min-h-16 items-center justify-between px-0! text-sm font-semibold">
              {{ t('botCards.customizeBot') }}
              <svg class="card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
            </summary>
            <Customizer v-model:shape="shape" v-model:color="color" v-model:expression="expression" />
            <div class="mt-5 flex min-h-11 items-center justify-between gap-3">
              <label for="bot-card-color" class="text-sm font-medium">{{ t('botCards.customColor') }}</label>
              <div class="flex items-center gap-2">
                <span class="text-xs text-[var(--muted)] uppercase">{{ bodyColor }}</span>
                <input id="bot-card-color" type="color" :value="bodyColor" class="h-11 w-11 cursor-pointer rounded-lg border border-[var(--line)] bg-white p-1" @input="card.bodyColor = ($event.target as HTMLInputElement).value" />
              </div>
            </div>
            <button v-if="card.bodyColor" type="button" class="card-button px-0! text-xs text-[var(--muted)] underline underline-offset-4" @click="card.bodyColor = ''">{{ t('botCards.usePalette') }}</button>
          </details>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bot-card-editor { --card-error: #a52721; }
.card-preview { width: 100%; max-width: 680px; }
.card-button { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 500; transition: background-color 160ms ease, opacity 160ms ease; }
.card-button:hover:not(:disabled) { opacity: 0.78; }
.card-button:disabled { cursor: not-allowed; opacity: 0.4; }
.card-button-primary { color: var(--paper); background: var(--ink); }
.card-button-outline { border: 1px solid var(--line); background: white; }
.card-input { width: 100%; min-width: 0; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; color: var(--ink); background: white; font-size: 16px; line-height: 1.5; }
.card-input:hover { border-color: var(--muted); }
.card-input[aria-invalid='true'] { border-color: var(--card-error); }
.card-button:focus-visible, .card-input:focus-visible, .card-details :deep(button:focus-visible), input[type='color']:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.card-details > summary { list-style: none; }
.card-details > summary::-webkit-details-marker { display: none; }
.card-chevron { transition: transform 160ms ease; }
.card-details[open] .card-chevron { transform: rotate(180deg); }
@media (width >= 64rem) {
  .card-preview { max-width: min(680px, max(300px, calc(100dvh - 360px))); }
  .card-input { font-size: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .card-button, .card-chevron { transition: none; }
}
</style>
