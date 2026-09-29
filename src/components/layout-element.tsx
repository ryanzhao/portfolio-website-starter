"use client";

import { createElement, useContext, useId, type HTMLAttributes, type ReactNode } from "react";
import { LayoutContext } from "./layout-context";
import { layoutBlockCss } from "../lib/layout-render";
import { resolveElement } from "../lib/page-layout";

type ElementProps = Omit<HTMLAttributes<HTMLElement>, "id"> & {
  blockId: string; id: string; kind?: "text" | "media" | "link"; label: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "blockquote" | "a" | "figure" | "div" | "li";
  htmlId?: string; href?: string; children?: ReactNode;
};
export function LayoutElement({ blockId, id, kind = "text", label, as = "span", htmlId, children, ...props }: ElementProps) {
  const editor = useContext(LayoutContext);
  const block = editor?.layout.blocks[blockId];
  const baseText = block?.elements[id]?.text;
  let content = baseText === undefined ? children : baseText;
  if (editor?.viewport) content = resolveElement(editor.layout, blockId, id, editor.viewport).text ?? children;
  else if (block?.overrides?.tablet?.elements[id]?.text !== undefined || block?.overrides?.mobile?.elements[id]?.text !== undefined) {
    content = <>{(["desktop", "tablet", "mobile"] as const).map(view => <span key={view} data-layout-text-view={view}>{resolveElement(editor!.layout, blockId, id, view).text ?? children}</span>)}</>;
  }
  return createElement(as, {
    ...props, id: htmlId, "data-layout-element": id, "data-layout-kind": kind,
    "data-layout-label": label, "data-layout-owner": blockId,
    "data-layout-selected": editor?.editing && editor.selected?.blockId === blockId && editor.selected.elementId === id || undefined,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (editor?.editing) { event.preventDefault(); event.stopPropagation(); editor.onSelect?.({ blockId, elementId: id }); }
    },
  }, kind === "media" ? <>{children}{block && <span className="layout-crop-fallback" role="note">Zoomed video crop unavailable in this browser.</span>}</> : content);
}
export function LayoutBlock({ id, htmlId, children, ...props }: Omit<HTMLAttributes<HTMLElement>, "id"> & { id: string; htmlId?: string; children: ReactNode }) {
  const editor = useContext(LayoutContext);
  const block = editor?.layout.blocks[id];
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const css = block ? layoutBlockCss(id, block, editor?.viewport, instance) : "";
  const added = new Set(Object.keys(block?.elements ?? {}).filter(key => key.startsWith("text-")));
  for (const override of Object.values(block?.overrides ?? {})) for (const key of Object.keys(override.elements ?? {})) if (key.startsWith("text-")) added.add(key);
  return <>{css && <style>{css}</style>}<section {...props} id={htmlId} data-layout-block={id} data-layout-instance={instance} data-layout-editing={editor?.editing || undefined}>
    {children}{[...added].map(key => <LayoutElement key={key} blockId={id} id={key} label="新增文字" as="p" />)}
  </section></>;
}
