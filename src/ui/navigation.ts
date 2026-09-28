import { onScopeDispose, ref, watch } from 'vue'

export const VIEW_IDS = ['personnaliser', 'figes', 'bot-cards', 'speakers', 'animations', 'reglages'] as const
export type ViewId = typeof VIEW_IDS[number]
export const DEFAULT_VIEW: ViewId = 'personnaliser'

/** Un onglet absent, vide ou inconnu ouvre la personnalisation. */
export function readTab(search: string): ViewId | null {
  const tab = new URLSearchParams(search).get('tab')
  return VIEW_IDS.find((id) => id === tab) ?? null
}

/** Un cran d'historique par changement d'onglet, aucun lors d'un retour navigateur. */
export function useTabView() {
  const view = ref<ViewId>(readTab(location.search) ?? DEFAULT_VIEW)
  let restoring = false
  const stop = watch(view, (tab) => {
    if (restoring || (readTab(location.search) ?? DEFAULT_VIEW) === tab) return
    const url = new URL(location.href)
    if (tab === DEFAULT_VIEW) url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    history.pushState(history.state, '', url)
  }, { flush: 'sync' })

  function restoreView() {
    restoring = true
    try {
      view.value = readTab(location.search) ?? DEFAULT_VIEW
    } finally {
      restoring = false
    }
  }

  window.addEventListener('popstate', restoreView)
  onScopeDispose(() => {
    stop()
    window.removeEventListener('popstate', restoreView)
  })
  return { view, restoreView }
}
