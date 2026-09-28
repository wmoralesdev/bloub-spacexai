<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '@/i18n'
import type { SpeakerDraft } from '@/ui/speaker'
import type { SpeakerAssets } from '@/ui/speakerRender'
import { createSpeakerAnimationSnapshot } from '@/ui/speakerAnimation'
import { createSpeakerComposition, type SpeakerAnimationSnapshot } from '@/shared/speakerAnimation'

const props = defineProps<{
  draft?: SpeakerDraft
  assets?: SpeakerAssets
  snapshotFactory?: (width: number) => Promise<SpeakerAnimationSnapshot>
  width: number
  active: boolean
  label: string
}>()
interface Player extends HTMLElement {
  play(): void
  pause(): void
}
const player = ref<Player>()
const host = ref<HTMLElement>()
const html = ref('')
const error = ref(false)
const loading = ref(true)
const loaded = ref(false)
const compositionVersion = ref(0)
const paused = ref(false)
const visible = ref(true)
const tabVisible = ref(document.visibilityState !== 'hidden')
const dimensions = ref({ width: 1000, height: 750 })
const canPlay = computed(() => props.active && visible.value && tabVisible.value && !paused.value && loaded.value)
let request = 0
let disposed = false
let awaitingReady = false
let timer: ReturnType<typeof setTimeout> | undefined
let readinessTimer: ReturnType<typeof setTimeout> | undefined
let observer: IntersectionObserver | undefined
let motion: MediaQueryList | undefined
let dependencies: Promise<{ gsap: string; runtime: string }> | undefined

function updatePlayback() {
  if (canPlay.value) player.value?.play()
  else player.value?.pause()
}

async function rebuild() {
  const current = ++request
  loading.value = true
  awaitingReady = false
  loaded.value = false
  error.value = false
  player.value?.pause()
  clearTimeout(readinessTimer)
  try {
    dependencies ??= Promise.all([
      import('@hyperframes/player'), import('gsap/dist/gsap.min.js?raw'), import('@hyperframes/core/runtime?raw')
    ]).then(([, gsap, runtime]) => ({ gsap: gsap.default, runtime: runtime.default })).catch((cause) => { dependencies = undefined; throw cause })
    const { gsap, runtime } = await dependencies
    if (disposed || current !== request) return
    const snapshot = props.snapshotFactory
      ? await props.snapshotFactory(props.width)
      : props.draft && props.assets
        ? await createSpeakerAnimationSnapshot({ ...props.draft }, props.assets, props.width)
        : undefined
    if (!snapshot) throw new Error('Speaker preview assets are unavailable')
    if (disposed || current !== request) return
    dimensions.value = { width: snapshot.width, height: snapshot.height }
    html.value = createSpeakerComposition(snapshot, gsap, runtime)
    compositionVersion.value++
    awaitingReady = true
    await nextTick()
    if (disposed || current !== request) return
    readinessTimer = setTimeout(() => { if (!loaded.value && current === request) failed() }, 15_000)
  } catch {
    if (!disposed && current === request) failed()
  }
}

function schedule() {
  request++
  awaitingReady = false
  loaded.value = false
  player.value?.pause()
  clearTimeout(readinessTimer)
  clearTimeout(timer)
  timer = setTimeout(() => { void rebuild() }, 180)
}

function ready(event: Event) {
  if (disposed || !awaitingReady || event.currentTarget !== player.value) return
  awaitingReady = false
  clearTimeout(readinessTimer)
  loaded.value = true
  loading.value = false
  updatePlayback()
}
function failed() {
  awaitingReady = false
  clearTimeout(readinessTimer)
  player.value?.pause()
  error.value = true
  loading.value = false
  loaded.value = false
}
function visibility() { tabVisible.value = document.visibilityState !== 'hidden' }
function reducedMotion() { if (motion?.matches) paused.value = true }

watch(() => [props.draft, props.assets, props.snapshotFactory, props.width], schedule, { deep: true })
watch(canPlay, updatePlayback)

onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  paused.value = motion.matches
  motion.addEventListener('change', reducedMotion)
  document.addEventListener('visibilitychange', visibility)
  observer = new IntersectionObserver(([entry]) => { visible.value = !!entry?.isIntersecting })
  if (host.value) observer.observe(host.value)
  void rebuild()
})
onBeforeUnmount(() => {
  disposed = true
  request++
  clearTimeout(timer)
  clearTimeout(readinessTimer)
  player.value?.pause()
  observer?.disconnect()
  motion?.removeEventListener('change', reducedMotion)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <div ref="host" class="absolute inset-0" :aria-label="label" :aria-busy="loading">
    <hyperframes-player v-if="html" :key="compositionVersion" ref="player" :srcdoc="html" :width="dimensions.width" :height="dimensions.height" loop muted class="block h-full w-full" @ready="ready" @error="failed" />
    <div v-if="loading || error" class="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-sm text-white" role="status">
      <div>
        <p>{{ t(error ? 'speakers.animationError' : 'speakers.animationLoading') }}</p>
        <button v-if="error" type="button" class="mt-3 min-h-11 cursor-pointer underline underline-offset-4" @click="rebuild">{{ t('speakers.retry') }}</button>
      </div>
    </div>
    <button v-if="loaded && !error" type="button" class="absolute right-3 bottom-3 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/80 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" :aria-label="t(paused ? 'speakers.playPreview' : 'speakers.pausePreview')" @click="paused = !paused">
      <svg v-if="paused" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
    </button>
  </div>
</template>
