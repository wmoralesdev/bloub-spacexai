<script setup lang="ts">
import BloubBot from '@/components/BloubBot.vue'
import { POSE_FIGE, type Fige } from '@/bot/figes'
import { t } from '@/i18n'

withDefaults(defineProps<{
  items: Fige[]
  selectedId: string | null
  sheetSelectedIds?: string[]
  hasBranding?: boolean
  shape: string
  color: string
  expression: string
}>(), { sheetSelectedIds: () => [], hasBranding: false })

const emit = defineEmits<{
  choisir: [id: string]
  retirer: [id: string]
  sheetToggle: [id: string]
  sheetSelectAll: []
  sheetClear: []
  createSheet: []
}>()

function champs(item: Fige) {
  return {
    shape: t(`shapes.${item.shape}`),
    expression: t(`expressions.${item.expression}`),
    color: t(`colors.${item.color}`)
  }
}
</script>

<template>
  <!--
    Collection de portraits figes. Chaque bot porte `frozenAt` : une vignette
    animee ferait tourner autant de boucles rAF que de cases.
  -->
  <div
    class="figes-grille flex w-full flex-col items-center overflow-y-auto self-stretch lg:max-h-[calc(100dvh_-_3rem_-_var(--timeline))] lg:pb-20"
  >
    <!--
      L'apercu du triple courant reste, meme apres un ajout : sinon changer
      de forme ou d'expression n'a plus de preview, seulement la collection.
    -->
    <BloubBot
      :size="items.length ? 200 : 280"
      :shape="shape"
      :color="color"
      :expression="expression"
      :frozen-at="POSE_FIGE"
    />
    <p
      v-if="!items.length"
      class="mt-4 max-w-xs text-center text-sm text-[var(--muted)]"
    >
      {{ t('figes.empty') }}
    </p>

    <slot name="branding" />

    <div v-if="items.length || hasBranding" class="mt-5 flex w-full flex-wrap items-center gap-3 text-sm">
      <span class="tabular-nums text-[var(--muted)]" role="status">
        {{ t('stickerSheet.selectedCount', { count: sheetSelectedIds.length }) }}
      </span>
      <button type="button" class="cursor-pointer underline underline-offset-4 disabled:cursor-default disabled:opacity-40" :disabled="sheetSelectedIds.length === items.length" @click="emit('sheetSelectAll')">
        {{ t('stickerSheet.selectAll') }}
      </button>
      <button type="button" class="cursor-pointer underline underline-offset-4 disabled:cursor-default disabled:opacity-40" :disabled="!sheetSelectedIds.length" @click="emit('sheetClear')">
        {{ t('stickerSheet.clearSelection') }}
      </button>
      <button type="button" class="ml-auto cursor-pointer rounded-xl bg-[var(--ink)] px-4 py-2.5 font-medium text-[var(--paper)] disabled:cursor-default disabled:opacity-40" :disabled="!sheetSelectedIds.length && !hasBranding" @click="emit('createSheet')">
        {{ t('stickerSheet.createSheet') }}
      </button>
    </div>

    <ul
      v-if="items.length"
      class="mt-4 grid w-full grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3"
    >
      <li v-for="item in items" :key="item.id" class="relative">
        <label class="absolute top-1.5 left-1.5 z-10 flex size-8 cursor-pointer items-center justify-center rounded-lg bg-[var(--paper)]">
          <input
            type="checkbox"
            class="size-4 cursor-pointer accent-[var(--ink)]"
            :checked="sheetSelectedIds.includes(item.id)"
            :aria-label="t('stickerSheet.includeAria', champs(item))"
            @change="emit('sheetToggle', item.id)"
          />
        </label>
        <button
          type="button"
          class="flex w-full cursor-pointer flex-col items-center rounded-xl border-2 p-2 transition"
          :class="
            item.id === selectedId
              ? 'border-[var(--ink)]'
              : 'border-transparent hover:border-[var(--line)]'
          "
          :aria-label="t('figes.selectAria', champs(item))"
          :aria-pressed="item.id === selectedId"
          @click="emit('choisir', item.id)"
        >
          <BloubBot
            :size="120"
            :shape="item.shape"
            :color="item.color"
            :expression="item.expression"
            :frozen-at="POSE_FIGE"
          />
          <span class="mt-1 text-center text-xs leading-tight text-[var(--muted)]">
            {{ t(`shapes.${item.shape}`) }}
            ·
            {{ t(`expressions.${item.expression}`) }}
          </span>
        </button>
        <button
          type="button"
          class="absolute top-1.5 right-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[var(--paper)] text-[var(--muted)] shadow-sm ring-1 ring-[var(--line)] transition hover:text-[var(--ink)]"
          :aria-label="t('figes.removeAria', champs(item))"
          @click="emit('retirer', item.id)"
        >
          <!-- solar:close-circle-linear, trace recopie -->
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.5"
              d="M16 8L8 16M8 8l8 8"
            />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>
