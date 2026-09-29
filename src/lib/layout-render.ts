import { layoutFonts, resolveElement, resolveBlock, type BlockLayout, type ElementLayout, type Viewport } from './page-layout.ts';

function declarations(value: ElementLayout, media: boolean) {
  const rules: string[] = [];
  const add = (name: string, entry: unknown, unit = '') => { if (entry !== undefined) rules.push(`${name}:${entry}${unit}!important`); };
  if (value.hidden) add('display', 'none');
  if (value.x !== undefined || value.y !== undefined) {
    add('position', 'absolute'); add('inset', 'auto'); add('margin', 0);
    add('max-width', '100%'); add('min-width', 0); add('min-height', 0);
    if (value.z === undefined) add('z-index', media ? 0 : 1);
  }
  add('left', value.x, '%'); add('top', value.y, '%'); add('width', value.width, '%');
  // Text must grow to fit its content, even after a user shortens its frame.
  if (media) add('height', value.height, '%');
  else { if (value.height !== undefined) add('min-height', value.height, '%'); add('overflow-wrap', 'anywhere'); }
  if (value.font) add('font-family', layoutFonts[value.font]);
  add('font-size', value.fontSize, 'px'); add('font-weight', value.fontWeight); add('color', value.color);
  add('line-height', value.lineHeight); add('letter-spacing', value.letterSpacing, 'em'); add('text-align', value.align);
  add('border-width', value.borderWidth, 'px'); if (value.borderWidth !== undefined) add('border-style', 'solid');
  add('border-color', value.borderColor); add('border-radius', value.radius, 'px'); add('z-index', value.z);
  if (value.z !== undefined && value.x === undefined && value.y === undefined) add('position', 'relative');
  return rules.join(';');
}
export function layoutBlockCss(blockId: string, block: BlockLayout, viewport?: Viewport, instance?: string) {
  // Selectors contain fixed IDs or server-validated UUIDs, never user text.
  const scope = instance ? `[data-layout-instance="${instance}"]` : `[data-layout-block="${blockId}"]`;
  const layout = { schemaVersion: 1 as const, blocks: { [blockId]: block } };
  const ids = new Set([...Object.keys(block.elements), ...Object.values(block.overrides ?? {}).flatMap(view => Object.keys(view.elements))]);
  const render = (view: Viewport) => {
    const height = resolveBlock(layout, blockId, view).height;
    let css = height === undefined ? '' : `${scope}{height:${height}px!important;min-height:${height}px!important}`;
    for (const id of ids) {
      const value = resolveElement(layout, blockId, id, view);
      if (!Object.keys(value).length) continue;
      const selector = `${scope} [data-layout-element="${id}"]`;
      css += `${selector}{${declarations(value, id.startsWith('media:'))}}`;
      if (value.x !== undefined || value.y !== undefined) css += `${scope} *:has([data-layout-element="${id}"]){position:static!important}`;
      if (id.startsWith('media:')) {
        const crop: string[] = [];
        if (value.fit) crop.push(`object-fit:${value.fit}!important`);
        if (value.focusX !== undefined || value.focusY !== undefined) crop.push(`object-position:${value.focusX ?? 50}% ${value.focusY ?? 50}%!important`);
        // Crop the replaced content, not the video element: playback controls stay fixed.
        if (value.zoom !== undefined) {
          const removed = 100 - 100 / value.zoom;
          const left = removed * (value.focusX ?? 50) / 100, top = removed * (value.focusY ?? 50) / 100;
          crop.push(`object-view-box:inset(${top}% ${removed-left}% ${removed-top}% ${left}%)!important`);
        }
        if (crop.length) css += `${selector}>img,${selector}>video{${crop.join(';')}}`;
        if (value.zoom !== undefined && value.zoom > 1) css += `@supports not (object-view-box:inset(10%)){${selector}>img{transform:scale(${value.zoom});transform-origin:${value.focusX ?? 50}% ${value.focusY ?? 50}%}${selector}:has(>video)>.layout-crop-fallback{display:block}}`;
      }
    }
    return css;
  };
  if (viewport) return render(viewport);
  return `@media(min-width:1024px){${render('desktop')}}@media(min-width:768px) and (max-width:1023px){${render('tablet')}}@media(max-width:767px){${render('mobile')}}`;
}
