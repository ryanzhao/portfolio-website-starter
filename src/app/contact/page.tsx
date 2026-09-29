import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
const fallbackMetadata = { title: "Contact" };
export default async function Contact() { const designed=await designerPublicPage("/contact");if(designed)return designed; return <section className="page-section narrow"><p className="eyebrow">GET IN TOUCH</p><h1>Let’s talk engineering.</h1><p className="page-intro">Contact details are awaiting confirmation.</p><div className="notice"><p>An approved email address and external profiles will appear here. No contact form or personal details are published in this preview.</p></div></section>; }

export async function generateMetadata(){return await designerMetadata("/contact")??fallbackMetadata;}
