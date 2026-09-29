import { publicSlotMedia, type SlotMedia } from "../lib/public-content.ts";
import { AdminSlotButton } from "./admin-editor-context";
import { LayoutElement } from "./layout-element";

export async function PhotoSlot({ slotId, label, className = "", media, layoutBlock }: { slotId: string; label: string; className?: string; media?: SlotMedia | null; layoutBlock?: string }) {
  const content = media === undefined ? await publicSlotMedia(slotId) : media;
  const children = <>
    {content ? <>
      {content.kind === "video" ? <video className="absolute inset-0 w-full h-full object-contain" src={content.src} poster={content.poster}
        controls playsInline preload="metadata" aria-label={content.alt} /> :
        // Keep private media out of a shared image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="absolute inset-0 w-full h-full object-cover" src={content.src} alt={content.alt} loading="lazy" />}
      {content.caption && <figcaption className="sr-only">{content.caption}</figcaption>}
    </> : <><span className="slot-frame" aria-hidden="true" /><span className="slot-label" role="img" aria-label={`${label} — image to be supplied`}>{label}<small>IMAGE TO BE ADDED</small></span></>}
    <AdminSlotButton slotId={slotId} />
  </>;
  const props = { "data-media-slot": slotId, className: `photo-slot ${className}` };
  if (layoutBlock) return <LayoutElement {...props} blockId={layoutBlock} id={`media:${slotId}`} kind="media" label={label} as={content ? "figure" : "div"}>{children}</LayoutElement>;
  return content ? <figure {...props}>{children}</figure> : <div {...props}>{children}</div>;
}
