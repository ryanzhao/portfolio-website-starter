// Convert screen pixels to the camera's right/up plane, at the current zoom.
export function panCameraTarget(target:{x:number;y:number;z:number},orbit:{theta:number;phi:number;radius:number},fov:number,height:number,dx:number,dy:number) {
 const scale=2*orbit.radius*Math.tan(fov*Math.PI/360)/Math.max(1,height);
 return {x:target.x-scale*(dx*Math.cos(orbit.theta)+dy*Math.cos(orbit.phi)*Math.sin(orbit.theta)),y:target.y+scale*dy*Math.sin(orbit.phi),z:target.z+scale*(dx*Math.sin(orbit.theta)-dy*Math.cos(orbit.phi)*Math.cos(orbit.theta))};
}

export function orbitAfterDrag(orbit:{theta:number;phi:number;radius:number},dx:number,dy:number,height:number) {
 const angle=2*Math.PI/Math.max(1,height);
 return {theta:orbit.theta-dx*angle,phi:orbit.phi-dy*angle,radius:orbit.radius};
}
