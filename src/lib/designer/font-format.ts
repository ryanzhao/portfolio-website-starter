import { brotliDecompressSync } from 'node:zlib';
import bundledFontkit from 'next/dist/compiled/@next/font/dist/fontkit/index.js';
import { UploadError } from '../uploads.ts';

export const fontByteLimit = 5 * 1024 * 1024;
const expandedLimit = 32 * 1024 * 1024;
const tags = 'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'.split(' ').map(t => t.replace('_', ' '));
const invalid = () => { throw new UploadError(400, '字体无效或过大；请选择单字体 WOFF2 文件。'); };

// Container bounds from https://www.w3.org/TR/WOFF2/; fontkit is already bundled
// with the pinned Next version. Validate decompression budgets before its lazy parser.
export function inspectFont(bytes: Uint8Array) {
  if (bytes.byteLength < 48 || bytes.byteLength > fontByteLimit) invalid();
  const buffer = Buffer.from(bytes), view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.toString('ascii', 0, 4) !== 'wOF2' || ![0x10000, 0x4f54544f].includes(view.getUint32(4)) || view.getUint32(8) !== bytes.length || view.getUint16(14) !== 0) invalid();
  const tables = view.getUint16(12), expanded = view.getUint32(16), compressed = view.getUint32(20);
  if (!tables || tables > 128 || expanded > expandedLimit || !compressed) invalid();
  let offset = 48, sum = 0;
  const next = () => { if (offset >= bytes.length) invalid(); return bytes[offset++]; };
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) { const b = next(); if ((!i && b === 128) || value > 0x1ffffff) invalid(); value = value * 128 + (b & 127); if (!(b & 128)) return value; }
    return invalid();
  };
  const seen = new Set<string>();
  for (let i = 0; i < tables; i++) {
    const flags = next(), index = flags & 63, version = flags >> 6;
    const tag = index === 63 ? String.fromCharCode(next(), next(), next(), next()) : tags[index];
    if (seen.has(tag)) invalid(); seen.add(tag);
    const original = base128(); if (original > expandedLimit) invalid();
    const outline = tag === 'glyf' || tag === 'loca';
    if (outline ? ![0, 3].includes(version) : tag === 'hmtx' ? ![0, 1].includes(version) : version !== 0) invalid();
    const length = (outline ? version !== 3 : version !== 0) ? base128() : original;
    if (tag === 'loca' && version === 0 && length !== 0) invalid();
    sum += length; if (sum > expandedLimit) invalid();
  }
  if (!['head', 'maxp', 'cmap', 'name'].every(t => seen.has(t)) || offset + compressed > bytes.length) invalid();
  let end = offset + compressed;
  const block = (start: number, length: number) => {
    if (!start && !length) return;
    if (!start || !length || start < end || start - end > 3 || start + length > bytes.length) invalid();
    for (let i = end; i < start; i++) if (bytes[i]) invalid();
    end = start + length;
  };
  block(view.getUint32(28), view.getUint32(32));
  if (view.getUint32(36) > expandedLimit) invalid();
  block(view.getUint32(40), view.getUint32(44));
  if (bytes.length - end > 3 || bytes.subarray(end).some(b => b !== 0)) invalid();
  try {
    const decoded = brotliDecompressSync(buffer.subarray(offset, offset + compressed), { maxOutputLength: expandedLimit });
    if (decoded.byteLength !== sum) invalid();
    const font = bundledFontkit.default(buffer);
    if (!font.numGlyphs || font.numGlyphs > 65535 || !font.unitsPerEm || !font.familyName || !font.characterSet.length) invalid();
    return { family: String(font.familyName).slice(0, 100), glyphs: font.numGlyphs };
  } catch { return invalid(); }
}
