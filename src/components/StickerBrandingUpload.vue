<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { t } from '@/i18n'
import { parseStickerSheetBranding, type StickerSheetBranding } from '@/ui/stickerSheetBranding'

const branding = defineModel<StickerSheetBranding | null>({ required: true })
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const loading = ref(false)
const failed = ref(false)
let revision = 0
const source = computed(() => branding.value
  ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(branding.value.svg)}`
  : '')

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const request = ++revision
  loading.value = true
  failed.value = false
  try {
    if (file.size > 256 * 1024) throw new Error('invalidBranding')
    const svg = await file.text()
    const parsed = parseStickerSheetBranding(svg, file.name)
    if (request === revision) branding.value = parsed
  } catch {
    if (request === revision) failed.value = true
  } finally {
    if (request === revision) loading.value = false
  }
}

function remove() {
  revision++
  branding.value = null
  loading.value = false
  failed.value = false
}

onBeforeUnmount(() => { revision++ })
</script>

<template>
  <section class="mt-5 w-full rounded-xl border border-[var(--line)] p-3" :aria-label="t('stickerSheet.brandingTitle')" :aria-busy="loading">
    <div class="flex flex-wrap items-center gap-3">
      <img v-if="source" :src="source" :alt="branding!.name" class="size-12 shrink-0 rounded-lg bg-white p-1 object-contain" />
      <div class="min-w-0 flex-1">
        <h2 class="text-balance text-sm font-medium">{{ t('stickerSheet.brandingTitle') }}</h2>
        <p v-if="branding" class="mt-0.5 truncate text-xs text-[var(--muted)]" :title="branding.name">{{ branding.name }}</p>
        <p v-else class="mt-0.5 text-pretty text-xs text-[var(--muted)]">{{ t('stickerSheet.brandingHelp') }}</p>
      </div>
      <input ref="fileInput" type="file" accept=".svg,image/svg+xml" class="hidden" :aria-label="t('stickerSheet.uploadBranding')" @change="upload" />
      <button type="button" class="min-h-10 cursor-pointer rounded-lg border border-[var(--line)] px-3 text-sm" @click="fileInput?.click()">
        {{ t(branding ? 'stickerSheet.replaceBranding' : 'stickerSheet.uploadBranding') }}
      </button>
      <button v-if="branding || loading" type="button" class="min-h-10 cursor-pointer px-2 text-sm underline underline-offset-4" @click="remove">
        {{ t('stickerSheet.removeBranding') }}
      </button>
    </div>
    <p v-if="failed" role="alert" class="mt-2 text-pretty text-sm text-red-700">{{ t('stickerSheet.brandingError') }}</p>
    <p v-else-if="loading" role="status" class="mt-2 text-sm text-[var(--muted)]">{{ t('stickerSheet.brandingLoading') }}</p>
  </section>
</template>
