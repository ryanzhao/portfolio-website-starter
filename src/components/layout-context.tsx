"use client";

import { createContext, type ReactNode } from "react";
import type { PageLayout, Viewport } from "../lib/page-layout";

export type LayoutSelection = { blockId: string; elementId: string };
export type LayoutContextValue = {
  layout: PageLayout; viewport?: Viewport; editing: boolean; selected: LayoutSelection | null;
  onSelect?: (selection: LayoutSelection | null) => void;
};
export const LayoutContext = createContext<LayoutContextValue | null>(null);
export function LayoutProvider({ children, editing = false, selected = null, ...value }: Omit<LayoutContextValue, "editing" | "selected"> & { editing?: boolean; selected?: LayoutSelection | null; children: ReactNode }) {
  return <LayoutContext.Provider value={{ ...value, editing, selected }}>{children}</LayoutContext.Provider>;
}
