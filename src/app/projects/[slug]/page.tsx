import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
import Link from "next/link";
import { notFound } from "next/navigation";
import { projects } from "@/lib/projects";
import { MediaPlaceholder } from "@/components/project-card";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) { const { slug } = await params; return await designerMetadata("/projects/"+slug)??{ title: projects.find(p => p.slug === slug)?.title ?? "Project not found" }; }
export default async function Project({ params }: Props) {
  const { slug } = await params;
  const designed=await designerPublicPage("/projects/"+slug);if(designed)return designed;
  const project = projects.find(p => p.slug === slug);
  if (!project) notFound();
  return <article className="page-section"><Link className="text-link" href="/projects">← Project index</Link><div className="detail-heading"><p className="eyebrow">PROJECT {project.number} / {project.category}</p><h1>{project.title}</h1><p className="page-intro">{project.subtitle}</p><div className="tags"><span className="badge">Draft · Unconfirmed</span>{project.tags.map(t => <span key={t} className="tag">{t}</span>)}</div></div><MediaPlaceholder label={project.title} large /><div className="detail-body"><aside><p className="eyebrow">PROJECT RECORD</p><dl><dt>Status</dt><dd>Awaiting confirmation</dd><dt>Role & dates</dt><dd>Not yet provided</dd><dt>Evidence</dt><dd>Not yet published</dd></dl></aside><section><h2>Project overview</h2><p>{project.summary}</p><div className="notice"><h3>Documentation in preparation</h3><p>This is a project draft. No performance figures, completed experiments, or outcomes are claimed here. Measured results, simulations, and design targets will be labeled separately when source material is added.</p></div><h2>Engineering record</h2><p>Goals, design decisions, system architecture, tests, and lessons learned will be added as verified material becomes available.</p></section></div></article>;
}
