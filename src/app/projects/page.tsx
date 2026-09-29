import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
import { ProjectList } from "@/components/project-list";
const fallbackMetadata = { title: "Projects" };
export default async function Projects() { const designed=await designerPublicPage("/projects");if(designed)return designed; return <section className="page-section"><p className="eyebrow">THE PROJECT INDEX</p><h1>Engineering projects.</h1><p className="page-intro">Three draft spaces for the work. Scope, roles, dates, and results await confirmation.</p><ProjectList /></section>; }

export async function generateMetadata(){return await designerMetadata("/projects")??fallbackMetadata;}
