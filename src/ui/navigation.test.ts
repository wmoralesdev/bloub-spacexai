// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { readTab, useTabView, VIEW_IDS } from './navigation'

let scope: EffectScope
function navigation() {
  scope = effectScope()
  return scope.run(() => useTabView())!
}
beforeEach(() => history.replaceState({ retained: true }, '', '/'))
afterEach(() => { scope?.stop(); vi.restoreAllMocks() })

describe('navigation par onglet', () => {
  it.each(VIEW_IDS)('ouvre directement %s sans ajouter une entree', (tab) => {
    history.replaceState(null, '', `/?tab=${tab}#etat=orbit&stop`)
    const push = vi.spyOn(history, 'pushState')
    expect(navigation().view.value).toBe(tab)
    expect(push).not.toHaveBeenCalled()
  })

  it.each(['', '?tab=', '?tab=unknown', '?tab=__proto__'])('ouvre la personnalisation pour %s meme avec un fragment de lecture', (search) => {
    expect(readTab(search)).toBeNull()
    history.replaceState(null, '', `/${search}#etat=orbit&stop`)
    expect(navigation().view.value).toBe('personnaliser')
  })

  it('ajoute une seule entree par selection en conservant chemin, parametres, fragment et history.state', () => {
    history.replaceState({ retained: true }, '', '/editor?campaign=meetup&tag=a&tag=b#etat=orbit&stop')
    const { view } = navigation()
    const push = vi.spyOn(history, 'pushState')
    view.value = 'speakers'
    view.value = 'speakers'
    expect(push).toHaveBeenCalledTimes(1)
    expect(location.pathname).toBe('/editor')
    expect(new URLSearchParams(location.search).getAll('tag')).toEqual(['a', 'b'])
    expect(new URLSearchParams(location.search).get('campaign')).toBe('meetup')
    expect(readTab(location.search)).toBe('speakers')
    expect(location.hash).toBe('#etat=orbit&stop')
    expect(history.state).toEqual({ retained: true })
  })

  it('restaure les entrees precedentes sans pousser de nouvelles entrees, meme sans tab', () => {
    const { view } = navigation()
    view.value = 'speakers'
    view.value = 'bot-cards'
    const push = vi.spyOn(history, 'pushState')
    for (const [url, expected] of [['/?tab=speakers#etat=orbit', 'speakers'], ['/#etat=orbit', 'personnaliser'], ['/?tab=#etat=orbit', 'personnaliser'], ['/?tab=bot-cards', 'bot-cards']] as const) {
      history.replaceState(null, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(view.value).toBe(expected)
    }
    expect(push).not.toHaveBeenCalled()
  })

  it('retire tab en revenant a la personnalisation sans perdre les autres parametres ni le fragment', () => {
    history.replaceState(null, '', '/?campaign=meetup&tab=speakers#etat=orbit&stop')
    const { view } = navigation()
    view.value = 'personnaliser'
    expect(location.search).toBe('?campaign=meetup')
    expect(location.hash).toBe('#etat=orbit&stop')
  })

  it('restaure un onglet explicite et detache son ecouteur au demontage', () => {
    const { view, restoreView } = navigation()
    history.replaceState(null, '', '/?tab=animations#etat=orbit&stop')
    const push = vi.spyOn(history, 'pushState')
    restoreView()
    expect(view.value).toBe('animations')
    expect(push).not.toHaveBeenCalled()
    scope.stop()
    history.replaceState(null, '', '/?tab=speakers')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(view.value).toBe('animations')
  })
})
