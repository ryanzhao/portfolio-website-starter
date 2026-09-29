import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
import { CanvaHome } from "@/components/canva-home";
import { LayoutProvider } from "@/components/layout-context";
import { publicPageLayout } from "@/lib/public-layout";
export const dynamic = "force-dynamic";
export default async function Home() { const designed=await designerPublicPage("/");if(designed)return designed; return <LayoutProvider layout={await publicPageLayout()}><CanvaHome /></LayoutProvider>; }

export async function generateMetadata(){return await designerMetadata("/")??{};}
