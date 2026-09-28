import { describe, expect, it } from 'vitest'
import { crc32, zipStore } from './zip'

function lu16(buf: Uint8Array, at: number) {
  return buf[at]! | (buf[at + 1]! << 8)
}

function lu32(buf: Uint8Array, at: number) {
  return (
    buf[at]! |
    (buf[at + 1]! << 8) |
    (buf[at + 2]! << 16) |
    (buf[at + 3]! << 24)
  ) >>> 0
}

describe('crc32', () => {
  it('reproduit le vecteur 123456789', () => {
    // ISO 3309 / PNG / ZIP : CRC de « 123456789 » = 0xcbf43926
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('vaut zero sur un tampon vide', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('zip STORE', () => {
  const hello = new TextEncoder().encode('hello')

  it('ecrit les trois signatures, le crc et les tailles', () => {
    const zip = zipStore([{ name: 'a.txt', data: hello }])
    expect(lu32(zip, 0)).toBe(0x04034b50)
    expect(lu16(zip, 8)).toBe(0)
    expect(lu32(zip, 14)).toBe(crc32(hello))
    expect(lu32(zip, 18)).toBe(hello.length)
    expect(lu32(zip, 22)).toBe(hello.length)

    const nom = new TextDecoder().decode(zip.subarray(30, 35))
    expect(nom).toBe('a.txt')
    expect(new TextDecoder().decode(zip.subarray(35, 40))).toBe('hello')

    const debutCentral = 30 + 5 + hello.length
    expect(lu32(zip, debutCentral)).toBe(0x02014b50)
    expect(lu32(zip, debutCentral + 42)).toBe(0)

    const eocd = debutCentral + 46 + 5
    expect(lu32(zip, eocd)).toBe(0x06054b50)
    expect(lu16(zip, eocd + 8)).toBe(1)
    expect(lu16(zip, eocd + 10)).toBe(1)
    expect(lu32(zip, eocd + 12)).toBe(eocd - debutCentral)
    expect(lu32(zip, eocd + 16)).toBe(debutCentral)
  })

  it('enchaine deux fichiers sans ecraser le second', () => {
    const deux = new TextEncoder().encode('world')
    const zip = zipStore([
      { name: 'a.txt', data: hello },
      { name: 'b.txt', data: deux }
    ])
    const premier = 30 + 5
    const second = premier + hello.length + 30 + 5
    expect(new TextDecoder().decode(zip.subarray(premier, premier + 5))).toBe('hello')
    expect(new TextDecoder().decode(zip.subarray(second, second + 5))).toBe('world')
    expect(lu16(zip, zip.length - 14)).toBe(2)
    const eocd = zip.length - 22
    const directoryStart = lu32(zip, eocd + 16)
    expect(lu32(zip, eocd + 12)).toBe(eocd - directoryStart)
  })
})
