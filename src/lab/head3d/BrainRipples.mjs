import * as THREE from 'three';
import {rippleSignal} from './ripple-signal.mjs';
import {outwardSamples,channelSamples} from './outward-signal.mjs';
import {CHANNELS} from './channels.mjs';
import {regionFor} from './regional-signal.mjs';
import {SignalPlumes} from './SignalPlumes.mjs';

const COUNT=193;
export class BrainRipples {
 constructor(scene){
  this.group=new THREE.Group();scene.add(this.group);this.plumes=new SignalPlumes(scene);this.lastEmit=-Infinity;this.lastSample=-Infinity;this.key=null;this.samples=[];this.next=0;
  this.rings=Array.from({length:7},()=>{
   const geometry=new THREE.BufferGeometry(),uv=new Float32Array(COUNT*4),indices=[];
   geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(COUNT*6),3).setUsage(THREE.DynamicDrawUsage));
   for(let i=0;i<COUNT;i++){uv.set([i/(COUNT-1),0,i/(COUNT-1),1],i*4);if(i<COUNT-1){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}}
   geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(indices);
   const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    uniforms:{color:{value:new THREE.Color('#4bbfff')},opacity:{value:0}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 vUv;uniform vec3 color;uniform float opacity;void main(){float d=abs(vUv.y*2.-1.);float glow=exp(-d*d*5.)*(1.-smoothstep(.75,1.,d));gl_FragColor=vec4(color,glow*opacity);\n#include <colorspace_fragment>\n}'});
   const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.visible=false;
   const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(COUNT*3),3).setUsage(THREE.DynamicDrawUsage));
   const line=new THREE.Line(lineGeometry,new THREE.LineBasicMaterial({color:'#4bbfff',transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));line.frustumCulled=false;line.visible=false;
   this.group.add(mesh,line);return {mesh,line,born:-Infinity,sample:null};
  });
 }
 clear(){for(const ring of this.rings){ring.born=-Infinity;ring.mesh.visible=false;ring.line.visible=false;}this.plumes.clear();this.lastEmit=-Infinity;this.next=0;}
 update(t,camera,store,selected,reducedMotion,style='pulse',metric='rms',anchor=null,head=null,nodes=[],allow=null,each=false){
  const enabled=style==='pulse'||style==='lines',key=`${store?.source}/${store?.stream}/${store?.mode}/${style}/${metric}/${style==='lines'?selected:''}`;
  const changed=key!==this.key;if(changed){this.clear();this.key=key;}
  this.group.visible=enabled&&!reducedMotion;
  if(!enabled||reducedMotion){this.clear();return;}
  if(changed||t-this.lastSample>.09){
   if(style==='lines'){const sample=rippleSignal(store,selected);this.samples=sample?[{...sample,color:regionFor(CHANNELS[sample.channel-1].name).color}]:[];}
   else this.samples=each?channelSamples(store,metric,Date.now(),allow):outwardSamples(store,metric,Date.now(),allow);
   this.lastSample=t;
  }
  if(!this.samples.length){this.clear();return;}
  if(style==='pulse'){this.group.visible=false;this.plumes.update(t,this.samples,head,nodes,each);return;}
  this.plumes.clear();
  this.group.quaternion.copy(camera.quaternion);this.group.position.set(anchor?.x||0,.2+(anchor?.y||0),anchor?.z||0);
  if(t-this.lastEmit>.66){
   const ring=this.rings.reduce((a,b)=>a.born<b.born?a:b),sample=this.samples[this.next++%this.samples.length];
   ring.sample=sample;ring.born=t;ring.line.material.color.set(sample.color);ring.mesh.material.uniforms.color.value.set(sample.color);this.lastEmit=t;
  }
  const activeKeys=new Set(this.samples.map(s=>s.key));
  for(const ring of this.rings){
   const age=(t-ring.born)/4.5,visible=age>=0&&age<1&&activeKeys.has(ring.sample?.key);
   ring.mesh.visible=visible&&style==='pulse';ring.line.visible=visible&&style==='lines';if(!visible)continue;
   const scale=1+age*.95,level=ring.sample.level,width=.032+level*.048;
   const positions=(style==='pulse'?ring.mesh:ring.line).geometry.attributes.position;
   for(let i=0;i<COUNT;i++){
    const angle=i/(COUNT-1)*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),wave=ring.sample.profile[i]*(.13+level*.12);
    const rx=1.82*scale+wave,ry=2.48*scale+wave;
    if(style==='pulse'){positions.setXYZ(i*2,c*(rx-width),s*(ry-width),-.12);positions.setXYZ(i*2+1,c*(rx+width),s*(ry+width),-.12);}
    else positions.setXYZ(i,c*rx,s*ry,-.12);
   }
   positions.needsUpdate=true;const opacity=Math.min(1,age/.1)*(1-age)**1.55*(.62+level*.65);
   ring.mesh.material.uniforms.opacity.value=opacity;ring.line.material.opacity=opacity*.65;
  }
 }
}
