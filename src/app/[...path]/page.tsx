import {notFound} from 'next/navigation';
import {designerPublicPage} from '@/components/designer-public-page';
import {designerMetadata} from '@/lib/designer/public';
export const dynamic='force-dynamic';
type Props={params:Promise<{path:string[]}>};
export async function generateMetadata({params}:Props){return await designerMetadata('/'+(await params).path.join('/'))??{title:'Not found'};}
export default async function CustomPage({params}:Props){return await designerPublicPage('/'+(await params).path.join('/'))??notFound();}
