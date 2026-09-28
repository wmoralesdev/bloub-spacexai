import { describe, expect, it } from 'vitest'
import { BOT_CARD_SIZE, CARD_LIMITS, MAX_BOT_CARDS, botCardFilename, botCardHandle, createBotCard, parseBotCards, normalizeBotCardUrl } from './botCard'

describe('bot card data', () => {
  it('creates a blank square card with an independent identity', () => {
    const first = createBotCard()
    const second = createBotCard([first])
    expect(BOT_CARD_SIZE).toBe(2000)
    expect(first).toMatchObject({ name: '', eventName: '', handle: '', description: '', shape: 'cercle', color: 'vert', expression: 'neutre', bodyColor: '' })
    expect(second.id).not.toBe(first.id)
    expect(createBotCard([first, second, { ...first, id: 'card4' }]).id).toBe('card3')
  })

  it('round-trips personalized cards without sharing references', () => {
    const card = { ...createBotCard(), name: 'Home robots', eventName: 'Cursor Buildathon', handle: 'SawyerMerritt', description: 'Control your home robots.', shape: 'triangle' as const, color: 'brun' as const, expression: 'curieux' as const, bodyColor: '#A15D32' }
    expect(parseBotCards(JSON.stringify([card]))).toEqual([{ ...card, bodyColor: '#a15d32' }])
  })

  it('rejects broken data, duplicate identities, and unknown bot settings', () => {
    const card = createBotCard()
    for (const raw of [null, '', '{', '{}', 'null', '[null, false, 12]', ' '.repeat(1_000_001)]) {
      expect(parseBotCards(raw)).toEqual([])
    }
    expect(parseBotCards(JSON.stringify([
      card, card, { ...card, id: '' }, { ...card, id: 'x', name: 45 },
      { ...card, id: 'y', shape: 'triangle-danger' },
      { ...card, id: 'z', color: 'missing' },
      { ...card, id: 'q', expression: 'missing' }
    ]))).toEqual([card])
  })

  it('bounds the saved collection, text and untrusted custom colors', () => {
    const card = { ...createBotCard(), name: 'a'.repeat(100), eventName: 'e'.repeat(100), handle: 'b'.repeat(100), description: 'c'.repeat(1000), bodyColor: 'url(https://example.com)' }
    const loaded = parseBotCards(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ ...card, id: `c${i}` }))))
    expect(loaded).toHaveLength(MAX_BOT_CARDS)
    expect(loaded[0]!.name).toHaveLength(CARD_LIMITS.name)
    expect(loaded[0]!.eventName).toHaveLength(CARD_LIMITS.eventName)
    expect(loaded[0]!.handle).toHaveLength(CARD_LIMITS.handle)
    expect(loaded[0]!.description).toHaveLength(CARD_LIMITS.description)
    expect(loaded[0]!.bodyColor).toBe('')
  })

  it('keeps exactly one leading handle marker and leaves empty handles empty', () => {
    expect(botCardHandle(' SawyerMerritt ')).toBe('@SawyerMerritt')
    expect(botCardHandle('@@@lennysan')).toBe('@lennysan')
    expect(botCardHandle('@ @ lennysan')).toBe('@lennysan')
    expect(botCardHandle('  @  ')).toBe('')
    expect(botCardHandle('  ')).toBe('')
  })

  it('produces safe names for both image formats', () => {
    const card = { ...createBotCard(), name: 'Bót / café: <one>' }
    expect(botCardFilename(card, 'svg')).toBe('bot-card-bot-cafe-one.svg')
    expect(botCardFilename(createBotCard(), 'png')).toBe('bot-card-untitled.png')
    expect(botCardFilename({ ...card, name: '../'.repeat(100) }, 'svg')).toBe('bot-card-untitled.svg')
    expect(botCardFilename(card, 'png', 'front')).toBe('bot-card-bot-cafe-one-front.png')
    expect(botCardFilename(card, 'svg', 'back')).toBe('bot-card-bot-cafe-one.svg')
  })

  it('restores old cards without a URL and preserves independent links on new cards', () => {
    const { url: _, ...old } = createBotCard()
    const linked = { ...createBotCard(), id: 'card2', url: 'https://x.ai/bot/k0-KTE52S_yByrmgrzniJ' }
    expect(parseBotCards(JSON.stringify([old, linked])))
      .toEqual([{ ...old, url: '' }, linked])
    const oversized = { ...linked, url: 'x'.repeat(2000) }
    expect(parseBotCards(JSON.stringify([oversized]))[0]!.url).toHaveLength(CARD_LIMITS.url)
  })

  it('restores old cards with a blank event name and sanitizes saved event names', () => {
    const { eventName: _, ...old } = createBotCard()
    expect(parseBotCards(JSON.stringify([old]))).toEqual([{ ...old, eventName: '' }])
    expect(parseBotCards(JSON.stringify([{ ...old, eventName: 42 }]))[0]!.eventName).toBe('')
    expect(parseBotCards(JSON.stringify([{ ...old, eventName: 'Build\u0001athon' }]))[0]!.eventName).toBe('Buildathon')
  })

  it('encodes the intended web destination and refuses unusable QR links', () => {
    const example = 'https://x.ai/bot/k0-KTE52S_yByrmgrzniJ'
    expect(normalizeBotCardUrl(`  ${example}  `)).toBe(example)
    expect(normalizeBotCardUrl('https://example.com/café?bot=é&mode=1')).toBe('https://example.com/caf%C3%A9?bot=%C3%A9&mode=1')
    expect(normalizeBotCardUrl('http://example.com/bot')).toBe('http://example.com/bot')
    for (const value of ['', 'x.ai/bot/abc', 'https://', 'javascript:alert(1)', 'data:text/html,hi', 'https://name:secret@example.com', 'https://example.com/a b', 'https://example.com/a\nb']) {
      expect(normalizeBotCardUrl(value)).toBeNull()
    }
    expect(normalizeBotCardUrl('https://example.com/' + 'a'.repeat(CARD_LIMITS.url))).toBeNull()
    expect(normalizeBotCardUrl('https://example.com/' + '界'.repeat(200))).toBeNull()
  })
})
