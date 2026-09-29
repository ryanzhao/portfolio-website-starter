"use client";

import { useEffect, useRef, useState, useId, type ReactNode } from "react";
import type { ModelViewerElement } from "@google/model-viewer";

import { calibratedCadAsset, cadMaterialColour } from "@/lib/cad-appearance";
import { orbitAfterDrag, panCameraTarget } from "@/lib/cad-pan";

const INITIAL_ORBIT = "35deg 65deg auto";

export function CadViewer({ assetId, src = "/models/interaction-demo.gltf", title = "Explore the geometry.", demo = true, alt, accessibleLabel = (_role: string, fallback: string) => fallback, renderLabel = (_role: string, fallback: string): ReactNode => fallback }: { assetId?: string; src?: string; title?: string; demo?: boolean; alt?: string; accessibleLabel?: (role: string, fallback: string) => string; renderLabel?: (role: string, fallback: string) => ReactNode }) {
  const instance = useId();
  const titleId = `${instance}-title`, instructionsId = `${instance}-instructions`;
  const host = useRef<HTMLDivElement>(null);
  const model = useRef<ModelViewerElement | null>(null);
  const [dragMode,setDragMode]=useState<'pan'|'rotate'>('rotate');
  const dragModeRef=useRef<'pan'|'rotate'>('rotate');
  const [attempt, setAttempt] = useState(demo ? 0 : 1);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(demo ? "idle" : "loading");

  const calibrated = assetId === calibratedCadAsset;
  const initialOrbit = calibrated ? "215deg 65deg auto" : INITIAL_ORBIT;

  useEffect(() => {
    if (!attempt) return;
    let cancelled = false;
    let viewer: ModelViewerElement | undefined;
    let pointer:{id:number;button:number;x:number;y:number;target:{x:number;y:number;z:number}}|undefined;
    const preventContextMenu=(event:Event)=>event.preventDefault();
    const drag=(event:PointerEvent)=>{
      if(!viewer)return;
      if(event.type==='pointerdown'){
        if(event.pointerType!=='mouse'||(event.button!==0&&event.button!==2))return;
        pointer={id:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,target:viewer.getCameraTarget()};
        viewer.setPointerCapture(event.pointerId);
      }
      if(!pointer||event.pointerId!==pointer.id)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.type==='pointermove'){
        const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
        if(pointer.button===2&&dragModeRef.current==='rotate'){
          const orbit=orbitAfterDrag(viewer.getCameraOrbit(),dx,dy,viewer.getBoundingClientRect().height);
          viewer.cameraOrbit=`${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
        }else{
          const target=panCameraTarget(pointer.target,viewer.getCameraOrbit(),viewer.getFieldOfView(),viewer.getBoundingClientRect().height,dx,dy);
          viewer.cameraTarget=`${target.x}m ${target.y}m ${target.z}m`;
          pointer.target=target;
        }
        viewer.jumpCameraToGoal();pointer.x=event.clientX;pointer.y=event.clientY;
      }else if(event.type!=='pointerdown'){
        if(viewer.hasPointerCapture(event.pointerId))viewer.releasePointerCapture(event.pointerId);
        pointer=undefined;
      }
    };
    const timer = setTimeout(() => { if (!cancelled) setStatus("error"); }, 30000);
    const ready = () => {
      clearTimeout(timer);
      if (cancelled) return;
      for (const material of viewer?.model?.materials ?? []) {
        const pbr = material.pbrMetallicRoughness;
        const colour = cadMaterialColour(assetId, material.name, pbr.baseColorFactor[3]);
        if (colour) pbr.setBaseColorFactor(colour);
      }
      setStatus("ready");
    };
    const failed = () => { clearTimeout(timer); if (!cancelled) setStatus("error"); };
    import("@google/model-viewer").then(() => {
      if (cancelled || !host.current) return;
      viewer = document.createElement("model-viewer") as ModelViewerElement;
      for (const [key, value] of Object.entries({
        src, alt: demo ? "Interaction demo: an abstract bracket assembly. Not a project CAD model." : alt || title,
        "camera-controls": "", "touch-action": "pan-y", "disable-tap": "",
        "camera-orbit": initialOrbit, "interaction-prompt": "none",
        "shadow-intensity": "0.5", exposure: calibrated ? "0.8" : "1", loading: "eager",
        "aria-describedby": instructionsId
      })) viewer.setAttribute(key, value);
      viewer.addEventListener("load", ready);
      viewer.addEventListener("error", failed);
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])viewer.addEventListener(type,drag as EventListener,{capture:true});
      viewer.addEventListener('contextmenu',preventContextMenu);
      model.current = viewer;
      host.current.replaceChildren(viewer);
    }).catch(failed);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      viewer?.removeEventListener("load", ready);
      viewer?.removeEventListener("error", failed);
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])viewer?.removeEventListener(type,drag as EventListener,true);
      viewer?.removeEventListener('contextmenu',preventContextMenu);
      viewer?.remove();
      model.current = null;
    };
  }, [attempt, src, title, alt, demo, instructionsId, assetId, calibrated, initialOrbit]);

  function load() { setStatus("loading"); setAttempt(value => value + 1); }
  function reset() {
    if (!model.current) return;
    model.current.cameraOrbit = initialOrbit;
    model.current.cameraTarget = "auto auto auto";
    model.current.jumpCameraToGoal();
  }
  function rotate(direction: number) {
    const viewer = model.current;
    if (!viewer) return;
    const orbit = viewer.getCameraOrbit();
    viewer.cameraOrbit = `${orbit.theta + direction * Math.PI / 6}rad ${orbit.phi}rad ${orbit.radius}m`;
    viewer.jumpCameraToGoal();
  }

  return <section className="cad-section portfolio-container" aria-labelledby={titleId}>
    <div className="cad-heading"><div><span className="section-number">{renderLabel("cad-label", "DESIGN IN THREE DIMENSIONS")}</span><h2 id={titleId}>{title}</h2></div><span className="cad-badge">{renderLabel("cad-badge", demo ? "INTERACTION DEMO · NOT PROJECT CAD" : "INTERACTIVE MODEL")}</span></div>
    <div className={`cad-stage${calibrated ? " cad-stage-calibrated" : ""}`} aria-busy={status === "loading"}>
      <div className="cad-canvas" ref={host} />
      {status !== "ready" && <div className="cad-overlay">
        {status === "idle" && <><p>{renderLabel("cad-idle", "Look around. Get closer.")}</p><span>{renderLabel("cad-description", "Load the 3D view to rotate and inspect the geometry.")}</span><button className="feature-button" onClick={load} aria-label={accessibleLabel("cad-load", "Load 3D model")}>{renderLabel("cad-load", "Load 3D model ↗")}</button></>}
        {status === "loading" && <p role="status">{renderLabel("cad-loading", "Loading 3D model…")}</p>}
        {status === "error" && <><p role="alert">{renderLabel("cad-error", "The 3D view could not load.")}</p><span>{renderLabel("cad-error-description", "Your browser may not support WebGL, or the model could not be fetched.")}</span><button className="feature-button" onClick={load} aria-label={accessibleLabel("cad-retry", "Try again")}>{renderLabel("cad-retry", "Try again")}</button></>}
      </div>}
      <noscript><p className="cad-overlay">{renderLabel("cad-noscript", "JavaScript is required for the interactive model.")}</p></noscript>
    </div>
    <div className="cad-toolbar" role="group" aria-label="Model controls"><button disabled={status !== "ready"} aria-pressed={dragMode==='pan'} onClick={()=>{dragModeRef.current='pan';setDragMode('pan');}}>Pan</button><button disabled={status !== "ready"} aria-pressed={dragMode==='rotate'} onClick={()=>{dragModeRef.current='rotate';setDragMode('rotate');}}>Rotate</button><button disabled={status !== "ready"} onClick={() => rotate(-1)} aria-label={accessibleLabel("cad-left", "Rotate model left")}>{renderLabel("cad-left", "↶ Rotate left")}</button><button disabled={status !== "ready"} onClick={() => rotate(1)} aria-label={accessibleLabel("cad-right", "Rotate model right")}>{renderLabel("cad-right", "Rotate right ↷")}</button><button disabled={status !== "ready"} onClick={() => model.current?.zoom(1)} aria-label={accessibleLabel("cad-zoom-in", "Zoom in")}>{renderLabel("cad-zoom-in", "+")}</button><button disabled={status !== "ready"} onClick={() => model.current?.zoom(-1)} aria-label={accessibleLabel("cad-zoom-out", "Zoom out")}>{renderLabel("cad-zoom-out", "−")}</button><button disabled={status !== "ready"} onClick={reset} aria-label={accessibleLabel("cad-reset", "Reset view")}>{renderLabel("cad-reset", "Reset view")}</button></div>
    <p id={instructionsId} className="cad-instructions">{renderLabel("cad-instructions", "Mouse: left-drag to move the model; right-drag to rotate (or pan in Pan mode); scroll to zoom. Touch: swipe sideways to rotate, pinch to zoom, two-finger drag to move. Keyboard: arrows rotate; Shift + arrows move. Reset view recenters the model.")}</p>
    {demo && <p className="cad-disclaimer">{renderLabel("cad-disclaimer", "Simple demonstration geometry only. Your own exported GLB model will replace this example.")}</p>}
  </section>;
}
