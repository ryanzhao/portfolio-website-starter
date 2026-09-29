import type { ReactNode } from "react";
import Link from "next/link";
import type { Project } from "@/lib/projects";

export function MediaPlaceholder({ label, large = false, imageLabel = "PROJECT IMAGE / PENDING" }: { label: string; large?: boolean; imageLabel?: ReactNode }) {
  return <div className={`media-placeholder ${large ? "large" : ""}`} role="img" aria-label={`${label}: real project photograph pending`}>
    <span className="placeholder-cross" aria-hidden="true">+</span>
    <span className="placeholder-label">{imageLabel}</span>
    <span className="placeholder-title">{label}</span>
  </div>;
}

export function ProjectCard({ project, renderLabel = (_role: string, fallback: string): ReactNode => fallback }: { project: Project & { href?: string }; renderLabel?: (role: string, fallback: string) => ReactNode }) {
  return <article className="project-card">
    <Link href={project.href ?? `/projects/${project.slug}`} className="image-link" aria-label={`View ${project.title} draft`}><MediaPlaceholder label={project.title} imageLabel={renderLabel("project-image-label", "PROJECT IMAGE / PENDING")} /></Link>
    <div className="card-meta"><span>{project.category}</span><span className="badge">{renderLabel("project-draft", "Draft")}</span></div>
    <h3><Link href={project.href ?? `/projects/${project.slug}`}>{project.title}<span aria-hidden="true"> ↗</span></Link></h3>
    <p>{project.summary}</p>
  </article>;
}
