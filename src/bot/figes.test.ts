import { describe, expect, it } from 'vitest'
import { MAX_FIGES, appliqueFige, makeFige, nextFigeId, parseFiges, type Fige } from './figes'

const base: Fige = {
  id: 'f1',
  shape: 'goutte',
  color: 'violet',
  expression: 'hilare'
}

describe('identifiants', () => {
  it('laisse toujours de la place pour un nouveau portrait, sans collision', () => {
    expect(nextFigeId([])).toBe('f1')
    expect(nextFigeId([base])).toBe('f2')
    expect(nextFigeId([base, { ...base, id: 'f2' }])).toBe('f3')
  })

  it('saute un trou laisse par un stockage bricole', () => {
    expect(nextFigeId([{ ...base, id: 'f1' }, { ...base, id: 'f3' }])).toBe('f2')
  })
})

describe('fabrication', () => {
  it('prend un instantane du triple, avec un id neuf', () => {
    const fige = makeFige([], 'capsule', 'encre', 'neutre')
    expect(fige).toEqual({
      id: 'f1',
      shape: 'capsule',
      color: 'encre',
      expression: 'neutre'
    })
  })

  it('refuse un id inconnu plutot que de l ecrire', () => {
    expect(makeFige([], 'carre', 'encre', 'neutre')).toBeNull()
    expect(makeFige([], 'cercle', 'magenta', 'neutre')).toBeNull()
    expect(makeFige([], 'cercle', 'encre', 'sourire')).toBeNull()
  })

  it('recrit un portrait deja la, sans toucher les autres', () => {
    const autre: Fige = { id: 'f2', shape: 'cercle', color: 'encre', expression: 'neutre' }
    expect(appliqueFige([base, autre], 'f1', 'capsule', 'rose', 'triste')).toEqual([
      { id: 'f1', shape: 'capsule', color: 'rose', expression: 'triste' },
      autre
    ])
  })

  it('laisse la liste telle quelle si l id ou un champ est inconnu', () => {
    const liste = [base]
    expect(appliqueFige(liste, 'f9', 'capsule', 'encre', 'neutre')).toBe(liste)
    expect(appliqueFige(liste, 'f1', 'carre', 'encre', 'neutre')).toBe(liste)
  })

  it('refuse d ajouter au dela du plafond', () => {
    const plein = Array.from({ length: MAX_FIGES }, (_, i) => ({
      ...base,
      id: `f${i + 1}`
    }))
    expect(makeFige(plein, 'cercle', 'encre', 'neutre')).toBeNull()
  })
})

describe('lecture du stockage', () => {
  it('rend une liste vide sur tout ce qui n est pas un tableau valide', () => {
    expect(parseFiges(null)).toEqual([])
    expect(parseFiges('')).toEqual([])
    expect(parseFiges('{pas du json')).toEqual([])
    expect(parseFiges('{"id":"f1"}')).toEqual([])
  })

  it('relit un portrait connu', () => {
    expect(parseFiges(JSON.stringify([base]))).toEqual([base])
  })

  it('jette les ids inconnus, les doublons et les champs manquants', () => {
    const raw = JSON.stringify([
      base,
      { ...base, id: 'f1' },
      { id: 'f2', shape: 'inconnu', color: 'encre', expression: 'neutre' },
      { id: 'f3', shape: 'cercle', color: 'encre' },
      { id: 'f4', shape: 'cercle', color: 'encre', expression: 'neutre' }
    ])
    expect(parseFiges(raw)).toEqual([
      base,
      { id: 'f4', shape: 'cercle', color: 'encre', expression: 'neutre' }
    ])
  })

  it('tronque au plafond avant de valider', () => {
    const trop = Array.from({ length: MAX_FIGES + 10 }, (_, i) => ({
      id: `f${i + 1}`,
      shape: 'cercle',
      color: 'encre',
      expression: 'neutre'
    }))
    expect(parseFiges(JSON.stringify(trop))).toHaveLength(MAX_FIGES)
  })
})
