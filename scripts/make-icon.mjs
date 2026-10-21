import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

/**
 * 生成应用图标（不引入图像依赖）：
 * 深色圆角方块 + 暖色光晕 + 一圈细环，对应 Lumen「阅读灯」的意象。
 * 输出 build/icon.png 与含多尺寸的 build/icon.ico。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'build')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const SUPERSAMPLE = 4

const BG_TOP = [0x25, 0x20, 0x19]
const BG_BOTTOM = [0x11, 0x0f, 0x0c]
const GLOW = [0xe8, 0xb0, 0x6a]
const RING = [0xf4, 0xe7, 0xcf]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function blend(dst, src, alpha) {
  if (alpha <= 0) return dst
  const a = clamp(alpha, 0, 1)
  return [
    dst[0] + (src[0] - dst[0]) * a,
    dst[1] + (src[1] - dst[1]) * a,
    dst[2] + (src[2] - dst[2]) * a,
  ]
}

function renderIcon(size) {
  const scale = SUPERSAMPLE
  const s = size * scale
  const radius = s * 0.225
  const cx = s / 2
  const cy = s * 0.52
  const ringRadius = s * 0.245
  const ringWidth = s * 0.042
  const dotRadius = s * 0.072
  const glowRadius = s * 0.6

  // 先以 supersample 分辨率画，再压缩到目标尺寸，边缘才不会有锯齿
  const hi = new Float64Array(size * scale * size * scale * 4)

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const qx = Math.abs(x + 0.5 - s / 2) - (s / 2 - radius)
      const qy = Math.abs(y + 0.5 - s / 2) - (s / 2 - radius)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      const inside = Math.min(Math.max(qx, qy), 0)
      const boxAlpha = clamp(0.5 - (outside + inside - radius), 0, 1)
      if (boxAlpha <= 0) continue

      const t = y / s
      let color = [
        BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
        BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
        BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t,
      ]

      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const glow = Math.pow(clamp(1 - distance / glowRadius, 0, 1), 2.2) * 0.62
      color = blend(color, GLOW, glow)

      const band = Math.abs(distance - ringRadius)
      const ringAlpha = 1 - smoothstep(ringWidth / 2 - 1, ringWidth / 2 + 1, band)
      color = blend(color, RING, ringAlpha * 0.95)

      const dotAlpha = 1 - smoothstep(dotRadius - 1.5, dotRadius + 1.5, distance)
      color = blend(color, RING, dotAlpha)

      const index = (y * s + x) * 4
      hi[index] = color[0]
      hi[index + 1] = color[1]
      hi[index + 2] = color[2]
      hi[index + 3] = 255 * boxAlpha
    }
  }

  // box filter 下采样，颜色按 alpha 加权，避免透明边缘发黑
  const out = Buffer.alloc(size * size * 4)
  const block = scale * scale
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let by = 0; by < scale; by += 1) {
        for (let bx = 0; bx < scale; bx += 1) {
          const index = ((y * scale + by) * s + (x * scale + bx)) * 4
          const alpha = hi[index + 3] / 255
          r += hi[index] * alpha
          g += hi[index + 1] * alpha
          b += hi[index + 2] * alpha
          a += alpha
        }
      }
      const offset = (y * size + x) * 4
      if (a > 0) {
        out[offset] = Math.round(r / a)
        out[offset + 1] = Math.round(g / a)
        out[offset + 2] = Math.round(b / a)
        out[offset + 3] = Math.round((a / block) * 255)
      }
    }
  }
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })

  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)])
}

mkdirSync(OUT_DIR, { recursive: true })

const png512 = encodePng(512, renderIcon(512))
writeFileSync(path.join(OUT_DIR, 'icon.png'), png512)

const icoImages = ICO_SIZES.map((size) => ({ size, png: encodePng(size, renderIcon(size)) }))
writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(icoImages))

console.log(`已生成 build/icon.png（512px）与 build/icon.ico（${ICO_SIZES.join('/')}px）`)
