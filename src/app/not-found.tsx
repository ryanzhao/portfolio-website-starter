'use client';
import Link from 'next/link';
import {usePublicDesign} from '@/components/portfolio-frame';
import {DesignerRenderer} from '@/components/designer-renderer';
export default function NotFound(){const {site,media}=usePublicDesign(),page=site?.pages.find(p=>p.id==='not-found'&&!p.deleted);if(site&&page)return <DesignerRenderer site={site} page={page} media={media}/>;return <section className="page-section"><p className="eyebrow">404 / NOT FOUND</p><h1>This page isn’t here.</h1><p className="page-intro">The address may have changed, or the page has not been published.</p><Link className="button primary" href="/">Back to home ↗</Link></section>;}
