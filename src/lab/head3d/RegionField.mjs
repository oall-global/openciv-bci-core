import * as THREE from 'three';
import {regionFor} from './regional-signal.mjs';

// Small GPU-drawn fields attached to individual electrodes. These are schematic
// scalp measurements, not a source-localisation heatmap or travelling neural waves.
export function createRegionField(channel){
 const uniforms={color:{value:new THREE.Color(regionFor(channel.name).color)},strength:{value:0},phase:{value:0},pulse:{value:0}};
 const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`varying vec2 vUv;uniform vec3 color;uniform float strength;uniform float phase;uniform float pulse;
  void main(){float r=length(vUv*2.-1.);if(r>1.)discard;
   float glow=exp(-r*r*5.5)*.44;
   float p=fract(phase),q=fract(phase+.5);
   float bands=exp(-pow((r-p)*17.,2.))*(1.-p)+exp(-pow((r-q)*17.,2.))*(1.-q);
   float a=mix(glow,glow*.32+bands*.55,pulse)*strength*(1.-smoothstep(.8,1.,r));
   gl_FragColor=vec4(color,a);
  }`});
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);mesh.visible=false;mesh.frustumCulled=false;return mesh;
}

export function updateRegionField(field,{valid,level},style,t,quaternion,reducedMotion){
 field.visible=valid&&(style==='aura'||style==='pulse');if(!field.visible)return;
 field.quaternion.copy(quaternion);field.scale.setScalar(.18+level*.18);
 field.material.uniforms.strength.value=level*.28;
 field.material.uniforms.phase.value=reducedMotion?.38:t*.65;
 field.material.uniforms.pulse.value=0;
}
