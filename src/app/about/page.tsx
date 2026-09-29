import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
const fallbackMetadata = { title: "About" };
export default async function About() { const designed=await designerPublicPage("/about");if(designed)return designed; return <section className="page-section narrow"><p className="eyebrow">BEHIND THE WORK</p><h1>About Ryan.</h1><p className="page-intro">An engineering portfolio in preparation.</p><div className="notice"><h2>Biography pending confirmation</h2><p>Education, experience, personal interests, and current work will be added using confirmed information. This preview does not assume an institution, job title, degree, award, or publication.</p></div></section>; }

export async function generateMetadata(){return await designerMetadata("/about")??fallbackMetadata;}
