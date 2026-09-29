"use client";
import { useState, type ReactNode } from "react";
import { projects as defaultProjects, type Project } from "@/lib/projects";
import { ProjectCard } from "./project-card";

export function ProjectList({ items = defaultProjects, accessibleLabel = (_role: string, fallback: string) => fallback, renderLabel = (_role: string, fallback: string): ReactNode => fallback } : { items?: (Project & { href?: string })[]; accessibleLabel?: (role: string, fallback: string) => string; renderLabel?: (role: string, fallback: string) => ReactNode } = {}) {
  const [category, setCategory] = useState("All");
  const [tag, setTag] = useState("All");
  const filtered = items.filter(p => (category === "All" || p.category === category) && (tag === "All" || p.tags.includes(tag)));
  return <>
    <div className="filters">
      <label>{renderLabel("filter-discipline", "Discipline")}<select aria-label={accessibleLabel("filter-discipline", "Discipline")} value={category} onChange={e => setCategory(e.target.value)}>{["All", ...new Set(items.map(p => p.category))].map(v => <option key={v} value={v} aria-label={v === "All" ? accessibleLabel("filter-all", "All") : undefined}>{v === "All" ? renderLabel("filter-all", "All") : v}</option>)}</select></label>
      <label>{renderLabel("filter-tag", "Tag")}<select aria-label={accessibleLabel("filter-tag", "Tag")} value={tag} onChange={e => setTag(e.target.value)}>{["All", ...new Set(items.flatMap(p => p.tags))].map(v => <option key={v} value={v} aria-label={v === "All" ? accessibleLabel("filter-all", "All") : undefined}>{v === "All" ? renderLabel("filter-all", "All") : v}</option>)}</select></label>
      <span className="filter-count" aria-live="polite">{filtered.length} {renderLabel("filter-count", "draft")} {filtered.length === 1 ? renderLabel("filter-project", "project") : renderLabel("filter-projects", "projects")}</span>
    </div>
    <h2 className="sr-only">{renderLabel("filter-results", "Project results")}</h2>
    {filtered.length ? <div className="project-grid">{filtered.map(p => <ProjectCard key={p.slug} project={p} renderLabel={renderLabel} />)}</div> : <p className="empty-state">{renderLabel("filter-empty", "No projects match these filters. Try another discipline or tag.")}</p>}
  </>;
}
