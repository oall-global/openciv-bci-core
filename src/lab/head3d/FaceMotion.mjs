import * as THREE from 'three';
import {faceIsFresh} from './face-signal.mjs';

// Follow the newest detection immediately. Smoothing happens only in the rig;
// a missed detection holds briefly then eases to neutral without extrapolation.
export function responseBlend(error,dt,blink=false){
 const rate=(blink?60:26)+Math.min(blink?100:74,Math.abs(error)*100);
 return 1-Math.exp(-rate*Math.min(.05,Math.max(0,dt)));
}
export class FaceMotion {
 constructor(){this.reset();this.position=new THREE.Vector3();this.rotation=new THREE.Quaternion();this.shapes={};}
 reset(){this.frames=[];this.key=null;this.lastAt=-Infinity;this.neutral=null;this.origin=new THREE.Vector3();}
 update(sample,active,now){
  if(!active){this.reset();this.position.set(0,0,0);this.rotation.identity();this.shapes={};return;}
  if(faceIsFresh(sample,now)&&sample.at!==this.lastAt){
   const key=`${sample.source}/${sample.calibration}/${sample.mirror}`;
   if(key!==this.key){this.reset();this.key=key;}
   const rotation=new THREE.Quaternion(),position=new THREE.Vector3();
   if(sample.source==='demo')rotation.setFromEuler(new THREE.Euler(...sample.euler));
   else{
    const matrix=new THREE.Matrix4().fromArray(sample.matrix),absolute=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrix)).normalize();
    if(!this.neutral){this.neutral=absolute.clone().invert();this.origin.setFromMatrixPosition(matrix);}
    rotation.copy(absolute).multiply(this.neutral).normalize();
    if(sample.mirror){rotation.y*=-1;rotation.z*=-1;}
    position.setFromMatrixPosition(matrix).sub(this.origin).multiplyScalar(.075);position.x*=sample.mirror?-1:1;
    position.clamp(new THREE.Vector3(-.7,-.5,-.4),new THREE.Vector3(.7,.5,.4));
   }
   this.frames[0]={at:sample.at,rotation,position,shapes:sample.shapes,mirror:sample.mirror};this.lastAt=sample.at;
  }
  if(!this.frames.length){this.rotation.identity();this.position.set(0,0,0);this.shapes={};return;}
  const last=this.frames[0];
  this.rotation.copy(last.rotation);this.position.copy(last.position);this.mirror=last.mirror;
  const age=now-last.at,fade=1-THREE.MathUtils.smoothstep(age,450,1100);
  this.rotation.slerp(new THREE.Quaternion(),1-fade);this.position.multiplyScalar(fade);
  for(const key of new Set([...Object.keys(last.shapes),...Object.keys(this.shapes)]))this.shapes[key]=(last.shapes[key]||0)*fade;
 }
}
