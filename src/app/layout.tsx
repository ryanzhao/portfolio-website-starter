import type { Metadata } from "next";
import {PortfolioFrame} from "@/components/portfolio-frame";
import {publicDesigner,publicDesignerMedia} from "@/lib/designer/public";
import {sessionView} from "@/lib/designer/editor-session";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Ryan Zhao — Engineering portfolio", template: "%s — Ryan Zhao" },
  description: "An engineering portfolio in preparation: propulsion, experimental hardware, and computational design.",
  robots: { index: false, follow: false }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const state=await publicDesigner().catch(()=>null);
  const special=state?await Promise.all(['/404','/error'].map(path=>publicDesigner(path).catch(()=>null))):[];
  const loaded=new Map(special.flatMap(s=>s?[[s.session.page.id,s.session.page] as const]:[]));
  const site=state?sessionView(state.session,loaded):null;
  const media=state?Object.assign({},await publicDesignerMedia('global-header'),...await Promise.all(special.map(s=>s?publicDesignerMedia(s.session.page.id,s.session.page.path):{}))):{};
  return <html lang="en"><body><PortfolioFrame site={site} media={media}>{children}</PortfolioFrame></body></html>;
}
