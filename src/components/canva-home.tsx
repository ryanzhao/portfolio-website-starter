import Link from "next/link";
import { portfolioSections, journeyLanes } from "@/lib/portfolio";
import { PhotoSlot } from "@/components/photo-slot";
import type { SlotMedia } from "@/lib/public-content";
import { CadViewer } from "@/components/cad-viewer";
import { LayoutBlock, LayoutElement as E } from "./layout-element";

export function CanvaHome({ media }: { media?: Record<string, SlotMedia | null> } = {}) {
  return <div className="canva-home">
    <LayoutBlock id="hero" className="portfolio-hero" aria-labelledby="portfolio-title">
      <PhotoSlot layoutBlock="hero" media={media?.["home.hero"]} slotId="home.hero" label="Hero · propulsion experiment" className="hero-photo" />
      <div className="hero-title-row"><E blockId="hero" id="title" label="封面标题" as="h1" htmlId="portfolio-title">Ryan Zhao’s Portfolio</E><E blockId="hero" id="caption" label="封面说明" className="hero-caption">Your original photograph</E></div>
    </LayoutBlock>
    <LayoutBlock id="bio" className="portfolio-bio portfolio-container" aria-labelledby="bio-title">
      <PhotoSlot layoutBlock="bio" media={media?.["home.portrait"]} slotId="home.portrait" label="Portrait · project exhibition" className="portrait-photo" />
      <div className="bio-copy">
        <E blockId="bio" id="title" label="个人介绍标题" as="h2" htmlId="bio-title">RYAN ZHAO:</E>
        <E blockId="bio" id="lead" label="个人介绍副标题" as="p" className="bio-lead">A <strong>full-time creator.</strong></E>
        <E blockId="bio" id="intro" label="个人介绍" as="p">“I’m willing to venture boldly into any field with a forward-looking mindset and devote myself completely to mastering it.”</E>
        <div className="bio-divider" />
        <E blockId="bio" id="gratitude" label="致谢" as="p">“Much of my knowledge comes from open-source communities, guidance from teachers, and books, and I owe them tremendous gratitude.”</E>
        <E blockId="bio" id="openness" label="开放分享" as="p">“Because of that, <strong>transparency and openness</strong> are fundamental to my work. I am committed to documenting and openly sharing my research.”</E>
        <E blockId="bio" id="note" label="个人介绍注释" className="reference-copy">Excerpts from the original portfolio · biography to be updated</E>
      </div>
    </LayoutBlock>
    <LayoutBlock id="journey" className="journey-section portfolio-container" aria-labelledby="journey-title">
      <E blockId="journey" id="title" label="旅程标题" as="h2" htmlId="journey-title">My journey to challenge<br className="desktop-break" /> the inefficiency of propulsion</E>
      <E blockId="journey" id="intro" label="旅程引言" as="p" className="journey-intro">Three connected paths. One evolving body of work.</E>
      <div className="journey-grid">{journeyLanes.map(lane => <section className="journey-lane" key={lane.slug} aria-labelledby={`lane-${lane.slug}`}>
        <E blockId="journey" id={`lane:${lane.slug}:title`} label={`${lane.title} · 标题`} as="h3" htmlId={`lane-${lane.slug}`}>{lane.title}</E>
        <ol>{lane.steps.map(step => <li className={`journey-step year-${step.year}`} key={step.year}>
          <E blockId="journey" id={`step:${lane.slug}:${step.year}:year`} label={`${lane.title} · ${step.year} 年份`} className="journey-year">{step.year}{step.year === "2025" ? " · to Nov. 1" : ""}</E>
          <E blockId="journey" id={`step:${lane.slug}:${step.year}:title`} label={`${lane.title} · ${step.year} 项目`} kind="link" as="a" className="journey-node" href={`/work/${lane.slug}`}>{step.title}</E>
          <ul className="journey-details">{step.details.map((detail, index) => <E key={detail} blockId="journey" id={`step:${lane.slug}:${step.year}:detail:${index}`} label={detail} as="li">{detail}</E>)}</ul>
        </li>)}</ol>
      </section>)}</div>
      <div className="journey-legend"><E blockId="journey" id="legend-label" label="图例说明">Color indicates year:</E>{["2023", "2024", "2025"].map(year => <E key={year} blockId="journey" id={`legend-${year}`} label={`图例 ${year}`} className={`legend-chip year-${year}`}>{year}{year === "2025" ? " · to Nov. 1" : ""}</E>)}</div>
    </LayoutBlock>
    <CadViewer />
    <div className="portfolio-sections portfolio-container">{portfolioSections.map(section => <LayoutBlock id={section.slug} htmlId={section.slug} key={section.slug} className={`portfolio-feature feature-${section.layout}`} aria-labelledby={`title-${section.slug}`}>
      <div className="feature-copy">
        <E blockId={section.slug} id="number" label="区块编号" className="section-number">SECTION {section.number}</E>
        <E blockId={section.slug} id="title" label="区块标题" as="h2" htmlId={`title-${section.slug}`}>{section.title}</E>
        <E blockId={section.slug} id="quote" label="引言" as="blockquote">“{section.quote}”</E>
        <E blockId={section.slug} id="button" label="按钮" kind="link" as="a" className="feature-button" href={`/work/${section.slug}`}>{section.number === "I" || section.number === "II" ? "Read more" : "See works"}<span aria-hidden="true">↗</span></E>
      </div>
      <PhotoSlot layoutBlock={section.slug} media={media?.[`home.${section.slug}`]} slotId={`home.${section.slug}`} label={section.image} className="feature-photo" />
      {section.layout === "pair" && <PhotoSlot layoutBlock={section.slug} media={media?.["home.electronics.secondary"]} slotId="home.electronics.secondary" label="Flight computer · circuit board" className="secondary-photo" />}
    </LayoutBlock>)}</div>
    <div className="design-note portfolio-container"><p>Design preview · Image spaces are ready for your original photographs.</p><Link href="/projects">Project index ↗</Link></div>
  </div>;
}
