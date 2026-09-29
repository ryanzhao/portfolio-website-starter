"use client";
import {usePublicDesign} from '@/components/portfolio-frame';
import {DesignerRenderer} from '@/components/designer-renderer';
export default function ErrorPage({ reset }: { reset: () => void }) { const {site,media}=usePublicDesign(),page=site?.pages.find(p=>p.id==='error'&&!p.deleted);if(site&&page)return <DesignerRenderer site={site} page={page} media={media} onReset={reset}/>;return <section className="page-section"><h1>Something didn’t load.</h1><p>Please try again.</p><button className="button" onClick={reset}>Try again</button></section>; }
