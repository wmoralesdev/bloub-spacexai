<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { EtatExport } from '@/ui/export'

export type FormatZip = 'png' | 'svg'

/**
 * Barre d'export de la collection figee : PNG ou SVG, chacun un zip.
 * Presentational, comme `ExportBar` — c'est `App.vue` qui possede la liste.
 */
const props = defineProps<{
  etat: EtatExport
  disabled?: boolean
}>()
const emit = defineEmits<{ exporter: [format: FormatZip] }>()

const occupe = computed(() => props.etat === 'occupe')
const confirme = computed(() => props.etat === 'exporte')

function libelle(format: FormatZip) {
  if (props.etat === 'exporte') return t('export.done')
  if (props.etat === 'erreur') return t('export.failed')
  return format === 'png' ? t('export.zip') : t('export.zipSvg')
}

function lance(format: FormatZip) {
  emit('exporter', format)
}
</script>

<template>
  <div
    class="flex overflow-hidden rounded-xl bg-[var(--ink)] text-[var(--paper)] shadow-sm"
    :class="(occupe || disabled) && 'opacity-60'"
  >
    <button
      type="button"
      class="flex cursor-pointer items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition hover:bg-white/10 disabled:cursor-default"
      :disabled="occupe || disabled"
      @click="lance('png')"
    >
      <svg
        v-if="confirme"
        width="17"
        height="17"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <g fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.5 12.5L10.5 14.5L15.5 9.5" />
        </g>
      </svg>
      <svg v-else width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
        <g
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
        >
          <path
            d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15"
          />
          <path d="M12 3V16M8 11.625L12 16L16 11.625" />
        </g>
      </svg>
      {{ libelle('png') }}
    </button>
    <div class="w-px self-stretch bg-current opacity-25"></div>
    <button
      type="button"
      class="flex cursor-pointer items-center px-3.5 py-2.5 text-sm font-medium transition hover:bg-white/10 disabled:cursor-default"
      :disabled="occupe || disabled"
      @click="lance('svg')"
    >
      {{ libelle('svg') }}
    </button>
  </div>
</template>
