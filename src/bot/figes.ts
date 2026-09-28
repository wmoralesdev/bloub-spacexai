import { EXPRESSION_BY_ID, type ExpressionId } from './expressions'
import { COLOR_BY_ID, SHAPE_BY_ID, type ColorId, type ShapeId } from './skins'

/**
 * Portraits figes : une forme, une expression, une couleur, sans animation.
 *
 * Meme esprit que `cycles.ts` : donnees pures, aucune horloge, aucun import Vue.
 * Le localStorage est modifiable a la main, donc tout ce qui ne se relit pas
 * est jete silencieusement plutot que de casser l'application au demarrage.
 *
 * Date de pose : `idle` a t = 1, la meme que les vignettes du personnalisateur.
 * Seul cet etat porte `baseFace`, donc l'expression choisie s'y voit vraiment.
 */
export const POSE_FIGE = 1

/**
 * Borne contre un stockage hostile, pas une limite de produit. Meme classe que
 * `MAX_CYCLES` : une liste de quelques megaoctets monterait autant de bots figes
 * que de cases, chacun un moteur.
 */
export const MAX_FIGES = 50

export interface Fige {
  id: string
  shape: ShapeId
  color: ColorId
  expression: ExpressionId
}

/** Identifiant sans collision, y compris avec un localStorage bricole a la main. */
export function nextFigeId(figes: Fige[]): string {
  const taken = new Set(figes.map((f) => f.id))
  let n = 1
  while (taken.has(`f${n}`)) n++
  return `f${n}`
}

/**
 * Instantane du triple courant. `null` si un id n'existe plus dans les
 * catalogues — le stockage a pu etre trafique entre l'ecran et l'ecriture.
 */
export function makeFige(
  figes: Fige[],
  shape: string,
  color: string,
  expression: string
): Fige | null {
  if (!SHAPE_BY_ID.has(shape) || !COLOR_BY_ID.has(color) || !EXPRESSION_BY_ID.has(expression)) {
    return null
  }
  if (figes.length >= MAX_FIGES) return null
  return {
    id: nextFigeId(figes),
    shape: shape as ShapeId,
    color: color as ColorId,
    expression: expression as ExpressionId
  }
}

/** Recrit le triple d'un portrait. Liste inchangee si l'id ou un champ est invalide. */
export function appliqueFige(
  figes: Fige[],
  id: string,
  shape: string,
  color: string,
  expression: string
): Fige[] {
  if (!SHAPE_BY_ID.has(shape) || !COLOR_BY_ID.has(color) || !EXPRESSION_BY_ID.has(expression)) {
    return figes
  }
  let touche = false
  const out = figes.map((f) => {
    if (f.id !== id) return f
    touche = true
    return {
      ...f,
      shape: shape as ShapeId,
      color: color as ColorId,
      expression: expression as ExpressionId
    }
  })
  return touche ? out : figes
}

function parseFige(raw: unknown, seen: Fige[]): Fige | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, shape, color, expression } = raw as {
    id?: unknown
    shape?: unknown
    color?: unknown
    expression?: unknown
  }
  if (typeof id !== 'string' || !id) return null
  if (typeof shape !== 'string' || !SHAPE_BY_ID.has(shape)) return null
  if (typeof color !== 'string' || !COLOR_BY_ID.has(color)) return null
  if (typeof expression !== 'string' || !EXPRESSION_BY_ID.has(expression)) return null
  if (seen.some((f) => f.id === id)) return null
  return {
    id,
    shape: shape as ShapeId,
    color: color as ColorId,
    expression: expression as ExpressionId
  }
}

/**
 * Le localStorage est modifiable a la main : on ne lui fait pas confiance, meme
 * regle que pour le hash de l'URL. Tout ce qui ne se relit pas est jete.
 */
export function parseFiges(raw: string | null): Fige[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out: Fige[] = []
  for (const item of data.slice(0, MAX_FIGES)) {
    const fige = parseFige(item, out)
    if (fige) out.push(fige)
  }
  return out
}
