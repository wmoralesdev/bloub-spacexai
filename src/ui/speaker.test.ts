import { describe, expect, it } from 'vitest'
import { ASPECTS, createSpeakerDraft, speakerDimensions, speakerExportDimensions, speakerFilename } from './speaker'

describe('speaker draft', () => {
  it('starts with the supplied example and creates independent session drafts', () => {
    const draft = createSpeakerDraft()
    expect(draft).toMatchObject({ name: 'Walter Morales', event: 'Grok Bot', city: 'San Salvador Meetup', aspect: '4:3' })
    draft.name = 'Changed'
    expect(createSpeakerDraft().name).toBe('Walter Morales')
  })

  it('provides the three exact export dimensions and proportionate previews', () => {
    expect(ASPECTS.map((aspect) => speakerDimensions(aspect.id))).toEqual([
      { width: 2400, height: 1800 },
      { width: 2000, height: 2000 },
      { width: 1080, height: 1920 }
    ])
    expect(speakerDimensions('4:3', 800)).toEqual({ width: 800, height: 600 })
    expect(speakerDimensions('1:1', 800)).toEqual({ width: 800, height: 800 })
    expect(speakerDimensions('9:16', 800)).toEqual({ width: 800, height: 1422 })
    expect(() => speakerDimensions('9:16', NaN)).toThrow()
  })

  it('keeps native resolution except for GIFs capped at 960 pixels on the long edge', () => {
    for (const format of ['png', 'jpeg', 'mp4'] as const) {
      expect(ASPECTS.map((aspect) => speakerExportDimensions(aspect.id, format)))
        .toEqual(ASPECTS.map((aspect) => speakerDimensions(aspect.id)))
    }
    expect(ASPECTS.map((aspect) => speakerExportDimensions(aspect.id, 'gif'))).toEqual([
      { width: 960, height: 720 },
      { width: 960, height: 960 },
      { width: 540, height: 960 }
    ])
  })

  it('makes safe names with accents, blank names, and all four formats', () => {
    const draft = { ...createSpeakerDraft(), name: 'María José / Muñoz', aspect: '9:16' as const }
    expect(speakerFilename(draft, 'jpeg')).toBe('grok-bot-maria-jose-munoz-9x16.jpg')
    expect(speakerFilename(draft, 'mp4')).toBe('grok-bot-maria-jose-munoz-9x16.mp4')
    expect(speakerFilename(draft, 'gif')).toBe('grok-bot-maria-jose-munoz-9x16.gif')
    expect(speakerFilename({ ...draft, name: '   ' }, 'png')).toBe('grok-bot-speaker-9x16.png')
    expect(speakerFilename({ ...draft, name: '../../speaker' }, 'png')).not.toContain('..')
  })
})
