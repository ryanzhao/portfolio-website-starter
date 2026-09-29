import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
import { notFound } from "next/navigation";
import { portfolioSections } from "@/lib/portfolio";
import { WorkContent } from "@/components/work-content";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) { const { slug } = await params; return await designerMetadata("/work/"+slug)??{ title: portfolioSections.find(s => s.slug === slug)?.title ?? "Not found" }; }
export default async function WorkPage({ params }: Props) {
  const { slug } = await params;
  const designed=await designerPublicPage("/work/"+slug);if(designed)return designed;
  const section = portfolioSections.find(s => s.slug === slug);
  if (!section) notFound();
  return <WorkContent section={section} />;
}
