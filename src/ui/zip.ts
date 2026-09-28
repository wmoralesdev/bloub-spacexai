/**
 * Archive STORE (methode 0). Les PNG sont deja compresses : deflater ici
 * n'economiserait rien et ajouterait une dependance. Testable en `node`.
 *
 * Pas de JSZip : le projet n'a que Vue et un `mediabunny` charge a la demande.
 */

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const VERSION = 20
const ENTETE_LOCAL = 30
const ENTETE_CENTRAL = 46
const ENTETE_EOCD = 22

/** Table CRC-32 IEEE, construite une fois. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

/** CRC-32 IEEE d'un tampon. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

function encodeNom(nom: string): Uint8Array {
  return new TextEncoder().encode(nom)
}

/**
 * Construit un zip STORE. Les noms doivent etre ASCII (ceux de `nomFichier`
 * le sont) : pas de drapeau UTF-8, pour rester lisible partout.
 */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const noms = entries.map((e) => encodeNom(e.name))
  const crcs = entries.map((e) => crc32(e.data))

  let tailleLocaux = 0
  let tailleCentral = 0
  for (let i = 0; i < entries.length; i++) {
    const n = noms[i]!.length
    tailleLocaux += ENTETE_LOCAL + n + entries[i]!.data.length
    tailleCentral += ENTETE_CENTRAL + n
  }

  const out = new Uint8Array(tailleLocaux + tailleCentral + ENTETE_EOCD)
  const vue = new DataView(out.buffer)
  let curseur = 0
  const offsets: number[] = []

  const u16 = (v: number) => {
    vue.setUint16(curseur, v, true)
    curseur += 2
  }
  const u32 = (v: number) => {
    vue.setUint32(curseur, v, true)
    curseur += 4
  }
  const octets = (b: Uint8Array) => {
    out.set(b, curseur)
    curseur += b.length
  }

  for (let i = 0; i < entries.length; i++) {
    const nom = noms[i]!
    const data = entries[i]!.data
    offsets.push(curseur)
    u32(SIG_LOCAL)
    u16(VERSION)
    u16(0)
    u16(0)
    u16(0)
    u16(0)
    u32(crcs[i]!)
    u32(data.length)
    u32(data.length)
    u16(nom.length)
    u16(0)
    octets(nom)
    octets(data)
  }

  const debutCentral = curseur
  for (let i = 0; i < entries.length; i++) {
    const nom = noms[i]!
    const data = entries[i]!.data
    u32(SIG_CENTRAL)
    u16(VERSION)
    u16(VERSION)
    u16(0)
    u16(0)
    u16(0)
    u16(0)
    u32(crcs[i]!)
    u32(data.length)
    u32(data.length)
    u16(nom.length)
    u16(0)
    u16(0)
    u16(0)
    u16(0)
    u32(0)
    u32(offsets[i]!)
    octets(nom)
  }

  const tailleRepertoire = curseur - debutCentral
  u32(SIG_EOCD)
  u16(0)
  u16(0)
  u16(entries.length)
  u16(entries.length)
  u32(tailleRepertoire)
  u32(debutCentral)
  u16(0)

  return out
}

export function zipBlob(entries: ZipEntry[]): Blob {
  const bytes = zipStore(entries)
  const tampon = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(tampon).set(bytes)
  return new Blob([tampon], { type: 'application/zip' })
}
