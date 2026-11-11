// 作り手が出したサムネイルを読み直して、決まった形に作り直す（docs/tasks/T021.md、SEC001 A06）。
//
// 受けるのは PNG、JPEG、WebP の静止画だけ。先に頭だけを読んで、形、画素数、アニメーションでないことを確かめる（展開する前に断るため）。
// 完全に展開できたものだけを、WebP（幅800。高さ÷幅は 0.6〜1.25）と OG 画像（PNG、1200×630）に作り直す。元のバイト列は置かないので、メタデータは残らない。
// Workers は wasm をその場で作れないので、wasm はモジュールとして読み込んで渡す。

import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode';
import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import { decode as decodePng, init as initPngDecode } from '@jsquash/png/decode';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode';
// @ts-expect-error このファイルの型は wasm の中身の関数で、モジュールとして読むときの形ではない
import PNG_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode';
import WEBP_DEC_WASM from '@jsquash/webp/codec/dec/webp_dec.wasm';
import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode';
import WEBP_ENC_WASM from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';

/** 受ける画素数の上限。展開すると RGBA で4倍になり、wasm と JS の両方に載る。Worker の上限は 128MB。 */
export const MAX_SOURCE_PIXELS = 6_000_000;
const MAX_SOURCE_SIDE = 8000;
const MIN_SOURCE_WIDTH = 320;
export const THUMB_WIDTH = 800;
const THUMB_MIN_RATIO = 0.6;
const THUMB_MAX_RATIO = 1.25;
/** SPEC.md「10」の 80KB。品質を下げて収める。 */
const THUMB_MAX_BYTES = 80 * 1024;
const THUMB_QUALITIES = [80, 65, 50, 35];
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export type ThumbError = 'format' | 'animated' | 'too_large' | 'too_small' | 'broken';
export interface ThumbResult {
  thumb: Uint8Array;
  og: Uint8Array;
  width: number;
  height: number;
}

interface Header {
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
  animated: boolean;
}

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

function readPng(b: Uint8Array): Header | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || signature.some((value, index) => b[index] !== value) || ascii(b, 12, 16) !== 'IHDR') return null;
  let animated = false;
  // acTL は最初の IDAT より前に置く決まり（APNG）
  for (let at = 8; at + 8 <= b.length; ) {
    const type = ascii(b, at + 4, at + 8);
    if (type === 'acTL') animated = true;
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + u32be(b, at);
  }
  return { format: 'png', width: u32be(b, 16), height: u32be(b, 20), animated };
}

function readJpeg(b: Uint8Array): Header | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let at = 2; at + 9 <= b.length; ) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // SOF の印。DHT（C4）、JPG（C8）、DAC（CC）は別物
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: 'jpeg', height: (b[at + 5] << 8) | b[at + 6], width: (b[at + 7] << 8) | b[at + 8], animated: false };
    }
    at += 2 + ((b[at + 2] << 8) | b[at + 3]);
  }
  return null;
}

function readWebp(b: Uint8Array): Header | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 12) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8X') {
    const flags = b[20];
    return { format: 'webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, animated: (flags & 0x02) !== 0 };
  }
  if (chunk === 'VP8 ') return { format: 'webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff, animated: false };
  if (chunk === 'VP8L') {
    const bits = u32le(b, 21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  return null;
}

// wasm のコードが ImageData を作る。Workers にはないので、同じ形のものを置く
class WorkerImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace = 'srgb' as const;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

let ready: Promise<unknown> | null = null;
function prepare(): Promise<unknown> {
  ready ??= (async () => {
    (globalThis as { ImageData?: unknown }).ImageData ??= WorkerImageData;
    await Promise.all([initJpegDecode(JPEG_DEC_WASM), initWebpDecode(WEBP_DEC_WASM), initPngDecode(PNG_WASM), initPngEncode(PNG_WASM), initWebpEncode(WEBP_ENC_WASM)]);
  })();
  return ready;
}

/**
 * cover で切り出して縮める。左右は中央、上下は上から（カードと同じ。SPEC.md「3」）。
 * 透けているところは白に合わせる（サムネイルに透明を残さない）。
 * 縮めるときは面積の平均、広げるときは双線形。wasm へ写さないので、元の画像の分しかメモリーを使わない。
 */
export function coverTop(source: Pixels, width: number, height: number): Uint8ClampedArray {
  const scale = Math.max(width / source.width, height / source.height);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  const left = (source.width - cropWidth) / 2;
  const out = new Uint8ClampedArray(width * height * 4);
  const data = source.data;
  const put = (at: number, r: number, g: number, b: number) => {
    out[at] = r;
    out[at + 1] = g;
    out[at + 2] = b;
    out[at + 3] = 255;
  };
  if (scale < 1) {
    for (let y = 0; y < height; y += 1) {
      const y0 = Math.floor((y * cropHeight) / height);
      const y1 = Math.max(y0 + 1, Math.min(source.height, Math.floor(((y + 1) * cropHeight) / height)));
      for (let x = 0; x < width; x += 1) {
        const x0 = Math.floor(left + (x * cropWidth) / width);
        const x1 = Math.max(x0 + 1, Math.min(source.width, Math.floor(left + ((x + 1) * cropWidth) / width)));
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let sy = y0; sy < y1; sy += 1) {
          let at = (sy * source.width + x0) * 4;
          for (let sx = x0; sx < x1; sx += 1) {
            const alpha = data[at + 3];
            const rest = 255 - alpha;
            r += (data[at] * alpha + 255 * rest) / 255;
            g += (data[at + 1] * alpha + 255 * rest) / 255;
            b += (data[at + 2] * alpha + 255 * rest) / 255;
            n += 1;
            at += 4;
          }
        }
        put((y * width + x) * 4, r / n, g / n, b / n);
      }
    }
    return out;
  }
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, left + (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const channel = (index: number) => {
        const read = (px: number, py: number) => {
          const at = (py * source.width + px) * 4;
          const alpha = data[at + 3];
          return index === 3 ? alpha : (data[at + index] * alpha + 255 * (255 - alpha)) / 255;
        };
        return (read(x0, y0) * (1 - fx) + read(x1, y0) * fx) * (1 - fy) + (read(x0, y1) * (1 - fx) + read(x1, y1) * fx) * fy;
      };
      put((y * width + x) * 4, channel(0), channel(1), channel(2));
    }
  }
  return out;
}

/** サムネイルの高さ。縦長と横長は切る（SPEC.md「3」の 0.6〜1.25）。 */
export function thumbHeight(width: number, height: number): number {
  const ratio = Math.min(THUMB_MAX_RATIO, Math.max(THUMB_MIN_RATIO, height / width));
  return Math.round(THUMB_WIDTH * ratio);
}

/** 読めない画像は error を返す。投げない（検査の結果として人に返す）。 */
export async function processThumb(bytes: Uint8Array): Promise<ThumbResult | { error: ThumbError }> {
  const header = readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
  if (!header) return { error: 'format' };
  if (header.animated) return { error: 'animated' };
  if (header.width < 1 || header.height < 1 || header.width > MAX_SOURCE_SIDE || header.height > MAX_SOURCE_SIDE || header.width * header.height > MAX_SOURCE_PIXELS) {
    return { error: 'too_large' };
  }
  if (header.width < MIN_SOURCE_WIDTH) return { error: 'too_small' };

  try {
    await prepare();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const source: Pixels =
      header.format === 'png' ? await decodePng(buffer) : header.format === 'jpeg' ? await decodeJpeg(buffer) : await decodeWebp(buffer);
    // 頭に書いてある大きさと違うなら、壊れているか、細工してある
    if (source.width !== header.width || source.height !== header.height || source.data.length !== source.width * source.height * 4) return { error: 'broken' };

    const height = thumbHeight(source.width, source.height);
    const thumbPixels = coverTop(source, THUMB_WIDTH, height);
    const ogPixels = coverTop(source, OG_WIDTH, OG_HEIGHT);

    let thumb = new Uint8Array(0);
    for (const quality of THUMB_QUALITIES) {
      thumb = new Uint8Array(await encodeWebp({ data: thumbPixels, width: THUMB_WIDTH, height, colorSpace: 'srgb' }, { quality }));
      if (thumb.length <= THUMB_MAX_BYTES) break;
    }
    if (thumb.length === 0 || thumb.length > THUMB_MAX_BYTES) return { error: 'too_large' };
    const og = new Uint8Array(await encodePng({ data: ogPixels, width: OG_WIDTH, height: OG_HEIGHT, colorSpace: 'srgb' }));
    return { thumb, og, width: THUMB_WIDTH, height };
  } catch {
    return { error: 'broken' };
  }
}
