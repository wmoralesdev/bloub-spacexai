// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import type { Fige } from '@/bot/figes'
import { langue, t } from '@/i18n'
import StillGrid from './StillGrid.vue'

vi.mock('@/components/BloubBot.vue', () => ({
  default: { name: 'BloubBot', render: () => null }
}))

const ITEMS: Fige[] = [
  { id: 'f1', shape: 'cercle', color: 'encre', expression: 'neutre' },
  { id: 'f2', shape: 'goutte', color: 'violet', expression: 'hilare' }
]

interface GridProps {
  items: Fige[]
  selectedId: string | null
  shape: string
  color: string
  expression: string
  sheetSelectedIds?: string[]
  hasBranding?: boolean
}

let app: App | undefined
let host: HTMLDivElement

const events = {
  onChoisir: vi.fn(),
  onRetirer: vi.fn(),
  onSheetToggle: vi.fn(),
  onSheetSelectAll: vi.fn(),
  onSheetClear: vi.fn(),
  onCreateSheet: vi.fn()
}

async function mount(overrides: Partial<GridProps> = {}) {
  const props = reactive<GridProps>({
    items: ITEMS.map((item) => ({ ...item })),
    selectedId: 'f1',
    shape: 'cercle',
    color: 'encre',
    expression: 'neutre',
    ...overrides
  })
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(StillGrid, { ...props, ...events }) })
  app.mount(host)
  await nextTick()
  return props
}

function labels(item: Fige) {
  return {
    shape: t(`shapes.${item.shape}`),
    expression: t(`expressions.${item.expression}`),
    color: t(`colors.${item.color}`)
  }
}

function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find((el) =>
    el.getAttribute('aria-label') === label || el.textContent?.trim() === label
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

function checkbox(item: Fige) {
  const label = t('stickerSheet.includeAria', labels(item))
  const found = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find((el) => el.getAttribute('aria-label') === label)
  if (!found) throw new Error(`Missing checkbox: ${label}`)
  return found
}

beforeEach(() => {
  langue.value = 'en'
  vi.clearAllMocks()
})

afterEach(() => {
  app?.unmount()
  app = undefined
  host?.remove()
})

describe('sticker sheet selection in Stills', () => {
  it('allows a branding-only sheet without selecting a bot', async () => {
    const props = await mount({ items: [], hasBranding: true })
    expect(button(t('stickerSheet.createSheet')).disabled).toBe(false)
    button(t('stickerSheet.createSheet')).click()
    expect(events.onCreateSheet).toHaveBeenCalledExactlyOnceWith()

    props.hasBranding = false
    await nextTick()
    expect(host.textContent).not.toContain(t('stickerSheet.createSheet'))
  })

  it('starts unchecked even when a portrait is selected for editing', async () => {
    await mount()

    expect(checkbox(ITEMS[0]!).checked).toBe(false)
    expect(checkbox(ITEMS[1]!).checked).toBe(false)
    expect(button(t('figes.selectAria', labels(ITEMS[0]!))).getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain(t('stickerSheet.selectedCount', { count: 0 }))
    const create = button(t('stickerSheet.createSheet'))
    expect(create.disabled).toBe(true)
    create.click()
    expect(events.onCreateSheet).not.toHaveBeenCalled()
  })

  it('checks a portrait without editing or removing it', async () => {
    const props = await mount()
    const input = checkbox(ITEMS[1]!)
    expect(input.closest('button')).toBeNull()
    input.click()
    await nextTick()

    expect(events.onSheetToggle).toHaveBeenCalledExactlyOnceWith('f2')
    expect(events.onChoisir).not.toHaveBeenCalled()
    expect(events.onRetirer).not.toHaveBeenCalled()

    props.sheetSelectedIds = ['f2']
    await nextTick()
    expect(checkbox(ITEMS[1]!).checked).toBe(true)
    expect(checkbox(ITEMS[0]!).checked).toBe(false)
    expect(host.textContent).toContain(t('stickerSheet.selectedCount', { count: 1 }))
    expect(button(t('stickerSheet.createSheet')).disabled).toBe(false)

    checkbox(ITEMS[1]!).click()
    await nextTick()
    expect(events.onSheetToggle).toHaveBeenCalledTimes(2)
    expect(events.onSheetToggle).toHaveBeenLastCalledWith('f2')
    expect(events.onChoisir).not.toHaveBeenCalled()
  })

  it('edits a portrait without changing which stickers are checked', async () => {
    const props = await mount({ sheetSelectedIds: ['f1'] })
    button(t('figes.selectAria', labels(ITEMS[1]!))).click()
    await nextTick()

    expect(events.onChoisir).toHaveBeenCalledExactlyOnceWith('f2')
    expect(events.onSheetToggle).not.toHaveBeenCalled()
    props.selectedId = 'f2'
    await nextTick()
    expect(checkbox(ITEMS[0]!).checked).toBe(true)
    expect(checkbox(ITEMS[1]!).checked).toBe(false)
    expect(button(t('figes.selectAria', labels(ITEMS[1]!))).getAttribute('aria-pressed')).toBe('true')
  })

  it('emits separate select-all, clear and create actions', async () => {
    const props = await mount()
    button(t('stickerSheet.selectAll')).click()
    await nextTick()
    expect(events.onSheetSelectAll).toHaveBeenCalledExactlyOnceWith()

    props.sheetSelectedIds = ['f1', 'f2']
    await nextTick()
    expect(host.textContent).toContain(t('stickerSheet.selectedCount', { count: 2 }))
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((el) => el.checked)).toBe(true)
    button(t('stickerSheet.createSheet')).click()
    button(t('stickerSheet.clearSelection')).click()
    await nextTick()
    expect(events.onCreateSheet).toHaveBeenCalledExactlyOnceWith()
    expect(events.onSheetClear).toHaveBeenCalledExactlyOnceWith()
    expect(events.onChoisir).not.toHaveBeenCalled()
    expect(events.onSheetToggle).not.toHaveBeenCalled()

    props.sheetSelectedIds = []
    await nextTick()
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some((el) => el.checked)).toBe(false)
    expect(button(t('stickerSheet.createSheet')).disabled).toBe(true)
  })

  it('removes a portrait without toggling its sheet checkbox or editing it', async () => {
    await mount({ sheetSelectedIds: ['f1'] })
    button(t('figes.removeAria', labels(ITEMS[0]!))).click()
    await nextTick()

    expect(events.onRetirer).toHaveBeenCalledExactlyOnceWith('f1')
    expect(events.onSheetToggle).not.toHaveBeenCalled()
    expect(events.onChoisir).not.toHaveBeenCalled()
  })
})
