'use client';
import {createContext,useContext,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {PortfolioHeader} from './portfolio-header';
import {DesignerRenderer} from './designer-renderer';
import type {DesignerSite} from '../lib/designer/model';
import type {DesignerMedia} from '../lib/designer/resources';
const PublicDesign=createContext<{site:DesignerSite|null;media:DesignerMedia}>({site:null,media:{}});
export const usePublicDesign=()=>useContext(PublicDesign);
export function PortfolioFrame({site,media,children}:{site:DesignerSite|null;media:DesignerMedia;children:ReactNode}){
  const pathname=usePathname(),admin=pathname.startsWith('/admin'),page=site?.pages.find(p=>!p.deleted&&p.path===pathname)??site?.pages.find(p=>p.id==='not-found');
  const designer=site&&!admin;
  return <PublicDesign.Provider value={{site,media}}>{designer?<>{page?.showHeader&&<DesignerRenderer site={site} page={site.header} media={media}/>}<main id="main" tabIndex={-1}>{children}</main>{page?.showFooter&&<DesignerRenderer site={site} page={site.footer} media={media}/>}</>:<><a className="skip-link" href="#main">Skip to content</a><PortfolioHeader/><main id="main" tabIndex={-1} className="container">{children}</main><footer className="container site-footer"><Link className="wordmark" href="/">MARS / RYAN ZHAO</Link><span>Portfolio · Design preview</span><Link href="/admin">管理入口 ↗</Link></footer></>}</PublicDesign.Provider>;
}
