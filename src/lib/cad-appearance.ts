// Owner-approved screenshot calibration for this immutable uploaded asset only.
// Other GLBs may already contain linear colours and must not be converted again.
export const calibratedCadAsset = '3073ee20-2dff-42b2-ba0d-ac6975c99c8c';
const palette: Record<string, string> = {
  FF1F2120: '20211f', FFAEC6D3: '96917c', FF3D3740: '171717',
  FF8095D9: 'b58470', FF77261B: '24263b', FF164CDD: 'a44932',
};
export function cadMaterialColour(assetId: string | undefined, name: string, alpha: number): [number, number, number, number] | null {
  if (assetId !== calibratedCadAsset || !/^FF[0-9A-F]{6}$/.test(name)) return null;
  // ImageToStl names retain ABGR source bytes. Derive from these, not the
  // mutable current colour, so repeated load events cannot darken the model.
  const rgb = palette[name] ?? name.slice(6, 8) + name.slice(4, 6) + name.slice(2, 4);
  const linear = (offset: number) => {
    const value = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [linear(0), linear(2), linear(4), alpha];
}
