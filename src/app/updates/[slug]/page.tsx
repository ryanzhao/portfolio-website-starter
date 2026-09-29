import {notFound} from 'next/navigation';
import {designerPublicPage} from '@/components/designer-public-page';
import {designerMetadata} from '@/lib/designer/public';
type Props={params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props){return await designerMetadata('/updates/'+(await params).slug)??{title:'Not found'};}
export default async function Update({params}:Props){return await designerPublicPage('/updates/'+(await params).slug)??notFound();}
