import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
const fallbackMetadata = { title: "Updates" };
export default async function Updates() { const designed=await designerPublicPage("/updates");if(designed)return designed; return <section className="page-section"><p className="eyebrow">THE ENGINEERING LOG</p><h1>Notes from the work.</h1><p className="page-intro">A place for design decisions, observations, and the next question.</p><div className="empty-state"><h2>No published entries yet.</h2><p>Confirmed engineering notes will appear here, linked to the projects they document.</p></div></section>; }

export async function generateMetadata(){return await designerMetadata("/updates")??fallbackMetadata;}
