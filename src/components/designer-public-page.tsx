import {notFound,permanentRedirect} from 'next/navigation';
import {publicDesigner,publicDesignerMedia} from '@/lib/designer/public';
import {sessionView} from '@/lib/designer/editor-session';
import {DesignerRenderer} from './designer-renderer';
export async function designerPublicPage(path:string){
  const state=await publicDesigner(path);if(!state){if(await publicDesigner())notFound();return null;}
  if(state.redirect)permanentRedirect(state.redirect);
  return <DesignerRenderer site={sessionView(state.session)} page={state.session.page} media={await publicDesignerMedia(state.session.page.id,path)}/>;
}
