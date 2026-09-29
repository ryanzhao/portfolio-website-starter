import {designerPublicPage} from "@/components/designer-public-page";
import {designerMetadata} from "@/lib/designer/public";
import { CadViewer } from "@/components/cad-viewer";
const fallbackMetadata = { title: "3D interaction preview" };
export default async function ModelPreview() { const designed=await designerPublicPage("/model-preview");if(designed)return designed; return <CadViewer />; }

export async function generateMetadata(){return await designerMetadata("/model-preview")??fallbackMetadata;}
