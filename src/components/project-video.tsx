'use client';
/* eslint-disable @next/next/no-img-element -- Published/private media use their existing authorized URLs. */
import {useEffect,useRef,useState} from 'react';
import './project-video.css';

export function ProjectVideo({src,poster,title,disabled=false}:{src?:string;poster?:string;title:string;disabled?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),screen=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const overflow=useRef<string|undefined>(undefined);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const modal=dialog.current,frame=screen.current,player=video.current;
    if(!modal||!frame||!player)return;
    let wasFullscreen=false;
    const stop=()=>{
      player.pause();player.removeAttribute('src');player.load();
      if(overflow.current!==undefined){document.documentElement.style.overflow=overflow.current;overflow.current=undefined;}
      if(document.fullscreenElement===frame)void document.exitFullscreen().catch(()=>{});
      trigger.current?.focus({preventScroll:true});
    };
    const fullscreen=()=>{if(document.fullscreenElement===frame)wasFullscreen=true;else if(wasFullscreen){wasFullscreen=false;if(modal.open)modal.close();}};
    modal.addEventListener('close',stop);document.addEventListener('fullscreenchange',fullscreen);
    return ()=>{modal.removeEventListener('close',stop);document.removeEventListener('fullscreenchange',fullscreen);stop();};
  },[]);
  function play(){
    const modal=dialog.current,frame=screen.current,player=video.current;
    if(!src||disabled||!modal||!frame||!player)return;
    setMessage('');modal.showModal();overflow.current=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';player.src=src;
    void player.play().catch(()=>{if(modal.open)setMessage('Press play to start the video.');});
    // Fullscreen includes our close button; browsers that decline keep the viewport-sized dialog.
    if(frame.requestFullscreen)void frame.requestFullscreen().catch(()=>{});
  }
  return <>
    <button ref={trigger} type="button" className="project-video-poster" onClick={play} disabled={disabled||!src} aria-label={src?`Play ${title} fullscreen`:`${title}: video to be added`}>
      {poster?<img src={poster} alt="" loading="lazy"/>:<span className="project-video-empty">{src?title:'VIDEO TO BE ADDED'}</span>}
      <span className="project-video-play" aria-hidden="true">▶</span>
    </button>
    <dialog ref={dialog} className="project-video-dialog" aria-label={title}>
      <div ref={screen} className="project-video-screen">
        <div className="project-video-header"><span>{title}</span><button type="button" autoFocus onClick={()=>dialog.current?.close()} aria-label="Close video">×</button></div>
        <video ref={video} controls playsInline preload="none" poster={poster} aria-label={title} onError={()=>{if(dialog.current?.open)setMessage('Video could not load. Close and try again.');}}/>
        <p role="status">{message}</p>
      </div>
    </dialog>
  </>;
}
