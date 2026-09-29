"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { portfolioSections } from "@/lib/portfolio";

export function PortfolioHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return <header className="portfolio-header"><div className="portfolio-nav">
    <Link href="/" className="mars-wordmark" aria-label="MARS — Ryan Zhao home" onClick={() => setOpen(false)}>MARS<span>RYAN ZHAO</span></Link>
    <button className="menu-button" aria-expanded={open} aria-controls="portfolio-navigation" onClick={() => setOpen(!open)}>{open ? "Close −" : "Explore +"}</button>
    <nav id="portfolio-navigation" className={open ? "category-nav is-open" : "category-nav"} aria-label="Portfolio categories" onKeyDown={e => { if(e.key === "Escape") { setOpen(false); document.querySelector<HTMLButtonElement>(".menu-button")?.focus(); } }}>
      {portfolioSections.map(section => <Link key={section.slug} href={`/#${section.slug}`} aria-current={pathname === `/work/${section.slug}` ? "page" : undefined} onClick={() => setOpen(false)}>{section.title}</Link>)}
    </nav>
  </div></header>;
}
