import * as THREE from 'three';
import {REGIONS} from './regional-signal.mjs';

// Artistic diffusion; not electrical propagation or source localisation.
// Fixed geometry, slow GPU motion, at most five small local plumes.
const flow=`uniform float time;uniform float strength;uniform float modulation;uniform float originTime;
vec3 flow(float age,float lane,float seed){
 float spread=.05+age*.28;
 float bend=sin(age*5.3-time*.65+seed*.35)*age*.19;
 return vec3(lane*spread+bend,cos(seed*5.7+age*4.-time*.45)*spread*.52,age*(.72+strength*.65));
}`;
const pointVertex=`attribute vec3 parameters;varying float opacity;${flow}
void main(){float age=fract(time*.16+parameters.x);vec3 p=flow(age,parameters.y,parameters.z);
 opacity=smoothstep(0.,.12,age)*pow(1.-age,1.7)*strength*(1.1+parameters.z*.35)*smoothstep(0.,.9,time-originTime);
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 gl_PointSize=clamp((1.+parameters.z*1.2)*9./max(1.,-mv.z),.9,2.4);}`;
const pointFragment=`varying float opacity;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(.16,.58,.95,opacity*(1.-smoothstep(.08,.5,d)));\n#include <colorspace_fragment>\n}`;
const strandVertex=`attribute vec3 parameters;varying float opacity;${flow}
void main(){float age=parameters.x;vec3 p=flow(age,parameters.y,parameters.z);
 p.x+=sin(age*16.-time*.85+parameters.z*3.)*age*.018*modulation;
 opacity=sin(age*3.14159)*pow(1.-age,1.2)*strength*.30*smoothstep(0.,1.2,time-originTime);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
const strandFragment=`varying float opacity;void main(){gl_FragColor=vec4(.08,.42,.78,opacity);\n#include <colorspace_fragment>\n}`;
function geometry(parameters){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(parameters.length),3));g.setAttribute('parameters',new THREE.Float32BufferAttribute(parameters,3));return g;}

export class SignalPlumes{
 constructor(scene){
  this.group=new THREE.Group();this.group.matrixAutoUpdate=false;scene.add(this.group);this.z=new THREE.Vector3(0,0,1);this.normal=new THREE.Vector3();this.lastTime=0;
  let seed=319;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const points=[];for(let i=0;i<150;i++)points.push(random(),(random()-.5)*2,random());
  const strands=[];for(let lane=0;lane<12;lane++)for(let i=0;i<47;i++)for(const j of [i,i+1])strands.push(j/47,(lane/11-.5)*2,lane/12);
  this.make=()=>{
   const root=new THREE.Group();root.visible=false;this.group.add(root);
   const uniforms={time:{value:0},strength:{value:0},modulation:{value:0},originTime:{value:0}};
   const makeMaterial=(vertexShader,fragmentShader)=>new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
   const particles=new THREE.Points(geometry(points),makeMaterial(pointVertex,pointFragment));
   const wisps=new THREE.LineSegments(geometry(strands),makeMaterial(strandVertex,strandFragment));
   particles.frustumCulled=wisps.frustumCulled=false;root.add(particles,wisps);
   return {root,uniforms,channel:null};
  };
  this.emitters=Object.fromEntries(Object.keys(REGIONS).map(key=>[key,this.make()]));
 }
 clear(){this.group.visible=false;for(const emitter of Object.values(this.emitters)){emitter.root.visible=false;emitter.uniforms.strength.value=0;emitter.channel=null;}}
 // each (主图): one plume per electrode (samples' region 'c<id>'), in bursts every 2-5 s that
 // fade out over a few seconds; otherwise one per region, following its level
 update(t,samples,head,nodes,each=false){
  if(!head||!nodes?.length||!samples.length){this.clear();return;}
  this.group.visible=true;this.group.matrix.copy(head.matrixWorld);
  const blend=1-Math.exp(-7*Math.min(.05,Math.max(0,t-this.lastTime)));this.lastTime=t;
  if(each){
   for(const s of samples)if(!this.emitters[s.region])this.emitters[s.region]=this.make();
   for(const [slot,emitter] of Object.entries(this.emitters)){
    const sample=samples.find(s=>s.region===slot),node=sample&&nodes.find(n=>n.c.id===sample.channel);
    if(!node){emitter.uniforms.strength.value*=1-blend*.5;emitter.next=null;if(emitter.uniforms.strength.value<.01)emitter.root.visible=false;emitter.uniforms.time.value=t;continue;}
    if(emitter.channel!==node.c.id){emitter.channel=node.c.id;emitter.uniforms.originTime.value=t;}
    if(emitter.next==null)emitter.next=t+Math.random()*1.5;
    if(t>=emitter.next){emitter.burst=t;emitter.next=t+2+Math.random()*3;}
    const age=t-(emitter.burst??-99),envelope=age<.5?age/.5:Math.exp(-(age-.5)/1.6);
    emitter.root.visible=true;emitter.root.position.copy(node.point);emitter.root.quaternion.setFromUnitVectors(this.z,this.normal.copy(node.norm).normalize());
    emitter.uniforms.time.value=t;emitter.uniforms.strength.value=(.45+.55*Math.min(1,sample.level*1.5))*envelope;
    emitter.uniforms.modulation.value=Math.abs(sample.profile[32]||0);
   }
   return;
  }
  for(const [region,emitter] of Object.entries(this.emitters)){
   if(!REGIONS[region]){emitter.root.visible=false;continue;}
   const sample=samples.find(s=>s.region===region),node=sample&&nodes.find(n=>n.c.id===sample.channel);
   if(!node||sample.level<=0){emitter.root.visible=false;emitter.channel=null;emitter.uniforms.strength.value=0;continue;}
   if(emitter.channel!==node.c.id){emitter.channel=node.c.id;emitter.uniforms.strength.value=0;emitter.uniforms.originTime.value=t;}
   emitter.root.visible=true;emitter.root.position.copy(node.point);emitter.root.quaternion.setFromUnitVectors(this.z,this.normal.copy(node.norm).normalize());
   emitter.uniforms.time.value=t;emitter.uniforms.strength.value=THREE.MathUtils.lerp(emitter.uniforms.strength.value,Math.min(1,sample.level*1.5),blend);
   emitter.uniforms.modulation.value=Math.abs(sample.profile[32]||0);
  }
 }
}
