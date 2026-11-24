import avatarUrl from './assets/avatar.glb?url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {shapeValue} from './face-signal.mjs';
import {FaceMotion,responseBlend} from './FaceMotion.mjs';
const morphVertex=`
#include <common>
#include <morphtarget_pars_vertex>
varying vec3 vNormal;varying vec3 vView;varying vec3 vPos;
void main(){
 #include <beginnormal_vertex>
 #include <morphnormal_vertex>
 #include <begin_vertex>
 #include <morphtarget_vertex>
 vec4 mv=modelViewMatrix*vec4(transformed,1.0);
 vNormal=normalize(normalMatrix*objectNormal);vView=-mv.xyz;vPos=transformed;
 gl_Position=projectionMatrix*mv;
}`;
export class FaceRig {
 constructor(scene,uniforms,fragment,onReady,onError){
  this.root=new THREE.Group();this.root.visible=false;scene.add(this.root);this.meshes=[];this.nodes=[];this.disposed=false;this.lastTime=0;this.motion=new FaceMotion();
  new GLTFLoader().load(avatarUrl,gltf=>{
   if(this.disposed){gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return;}
   gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;
    mesh.material.dispose();mesh.material=new THREE.ShaderMaterial({uniforms,vertexShader:morphVertex,fragmentShader:fragment});mesh.frustumCulled=false;
    this.meshes.push(mesh);
    if(mesh.name==='ExpressionHead')this.head=mesh;
   });this.root.add(gltf.scene);
   if(!this.head){onError();return;}
   const wire=new THREE.Mesh(this.head.geometry,new THREE.ShaderMaterial({uniforms,vertexShader:morphVertex,fragmentShader:'varying vec3 vPos;void main(){gl_FragColor=vec4(.02,.32,.8,.10);}',wireframe:true,transparent:true,depthWrite:false}));
   wire.morphTargetInfluences=this.head.morphTargetInfluences;wire.scale.setScalar(1.001);wire.frustumCulled=false;this.root.add(wire);
   this.morphEntries=Object.entries(this.head.morphTargetDictionary);
   this.eyes=this.meshes.filter(m=>m.name==='mesh_0'||m.name==='mesh_1').map(mesh=>{
    mesh.geometry.computeBoundingBox();const center=mesh.geometry.boundingBox.getCenter(new THREE.Vector3());mesh.geometry.translate(-center.x,-center.y,-center.z);mesh.position.copy(center);
    // A small holographic iris makes eye direction legible without a photo texture.
    const iris=new THREE.Mesh(new THREE.CircleGeometry(.085,24),new THREE.MeshBasicMaterial({color:'#64d6ff',transparent:true,opacity:.75,side:THREE.DoubleSide}));
    iris.position.z=mesh.geometry.boundingBox?.max.z||.14;mesh.add(iris);return mesh;
   });
   onReady(this);
  },undefined,onError);
 }
 update(sample,active,t){
  this.root.visible=active&&!!this.head;if(!this.head)return;
  const dt=Math.min(.05,Math.max(.001,(t-this.lastTime)/1000));this.lastTime=t;
  this.motion.update(sample,active,t);const shapes=this.motion.shapes,mirror=this.motion.mirror;
  for(const [name,index] of this.morphEntries){const current=this.head.morphTargetInfluences[index],target=shapeValue(shapes,name,mirror);this.head.morphTargetInfluences[index]=THREE.MathUtils.lerp(current,target,responseBlend(target-current,dt,name.startsWith('eyeBlink')));}
  this.root.position.lerp(this.motion.position,responseBlend(this.root.position.distanceTo(this.motion.position),dt));
  this.root.quaternion.slerp(this.motion.rotation,responseBlend(this.root.quaternion.angleTo(this.motion.rotation),dt));
  for(const eye of this.eyes||[]){const side=eye.position.x>0?'Right':'Left';
   const pitch=(shapeValue(shapes,'eyeLookDown'+side,mirror)-shapeValue(shapes,'eyeLookUp'+side,mirror))*.35;
   const yaw=(shapeValue(shapes,'eyeLookOut'+side,mirror)-shapeValue(shapes,'eyeLookIn'+side,mirror))*(eye.position.x>0?.35:-.35);
   eye.rotation.x=THREE.MathUtils.lerp(eye.rotation.x,pitch,responseBlend(pitch-eye.rotation.x,dt,true));eye.rotation.y=THREE.MathUtils.lerp(eye.rotation.y,yaw,responseBlend(yaw-eye.rotation.y,dt,true));
  }
  this.root.updateMatrixWorld(true);
 }
}
