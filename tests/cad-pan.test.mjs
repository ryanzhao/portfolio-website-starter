import test from 'node:test';
import assert from 'node:assert/strict';
import {orbitAfterDrag,panCameraTarget} from '../src/lib/cad-pan.ts';
test('screen-plane panning follows the mouse and scales with zoom, regardless of camera angle',()=>{
 const origin={x:0,y:0,z:0},orbit={theta:0,phi:Math.PI/2,radius:10};
 const down=panCameraTarget(origin,orbit,45,500,0,50);
 assert.ok(down.y>0);assert.ok(Math.abs(down.x)<1e-10&&Math.abs(down.z)<1e-10);
 const right=panCameraTarget(origin,orbit,45,500,50,0);assert.ok(right.x<0);
 const rotated=panCameraTarget(origin,{...orbit,theta:Math.PI/2},45,500,50,0);assert.ok(rotated.z>0);assert.ok(Math.abs(rotated.x)<1e-10);
 const zoomed=panCameraTarget(origin,{...orbit,radius:5},45,500,0,50);assert.equal(zoomed.y,down.y/2);
 const back=panCameraTarget(down,orbit,45,500,0,-50);assert.deepEqual(back,origin);
});
test('right-drag reverses both orbit axes without changing camera distance',()=>{
 const orbit={theta:0,phi:Math.PI/2,radius:10};
 const moved=orbitAfterDrag(orbit,-50,-25,500);
 assert.ok(moved.theta>orbit.theta&&moved.phi>orbit.phi);
 assert.equal(moved.radius,orbit.radius);
 assert.deepEqual(orbitAfterDrag(moved,50,25,500),orbit);
});
