import Link from "next/link";
import { portfolioSections } from "@/lib/portfolio";
import { PhotoSlot } from "@/components/photo-slot";
import type { SlotMedia } from "@/lib/public-content";

export function WorkContent({ section, media }: { section: typeof portfolioSections[number]; media?: Record<string, SlotMedia | null> }) {
  const slug = section.slug;
  return <article className="work-page"><Link href={`/#${section.slug}`} className="text-link">← Back to portfolio</Link><header className="work-heading"><span className="section-number">SECTION {section.number}</span><h1>{section.title}</h1><p>“{section.quote}”</p></header><PhotoSlot media={media?.[`work.${section.slug}.hero`]} slotId={`work.${section.slug}.hero`} label={section.image} className="work-hero" /><div className="work-section-heading"><h2>The work</h2><span>Portfolio content in preparation</span></div>
    {section.projects.length > 0 ? <div className="work-grid">{section.projects.map((title, i) => <article className="work-card" key={title}><PhotoSlot media={media?.[`work.${section.slug}.project.${i + 1}`]} slotId={`work.${section.slug}.project.${i + 1}`} label={title} /><p className="work-index">0{i + 1} / PROJECT</p><h3>{title}</h3><p>Project photographs and documentation will be added here.</p></article>)}</div> : <div className="work-editorial"><PhotoSlot media={media?.[`work.${section.slug}.activity`]} slotId={`work.${section.slug}.activity`} label={section.layout === "team" ? "Team activity" : "Outreach activity"}/><div><h2>{section.layout === "team" ? "Working together." : "Ideas worth sharing."}</h2><p>Photographs and stories will be added here.</p></div></div>}
    <nav className="work-next" aria-label="Other sections"><span>Explore another field</span>{portfolioSections.filter(s => s.slug !== slug).map(s => <Link key={s.slug} href={`/work/${s.slug}`}>{s.title} ↗</Link>)}</nav>
  </article>;
}
