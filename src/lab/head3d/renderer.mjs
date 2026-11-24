import {WebGLRenderer} from 'three';

// Use a fresh canvas for each attempt: context attributes cannot be changed
// once a canvas has acquired a context. Do not require a discrete GPU.
export function createHeadRenderer({compatible=false,makeCanvas=()=>document.createElement('canvas'),Renderer=WebGLRenderer}={}){
 const profiles=compatible?['compatible']:['standard','compatible'];
 for(const mode of profiles){
  const canvas=makeCanvas();let context;
  try{
   const options={alpha:false,depth:true,stencil:false,antialias:mode==='standard',powerPreference:'default',preserveDrawingBuffer:false,failIfMajorPerformanceCaveat:false};
   context=canvas.getContext('webgl2',options);
   if(!context||context.isContextLost())throw new Error('WebGL2 unavailable');
   const renderer=new Renderer({canvas,context,...options});
   return {renderer,mode};
  }catch{
   context?.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();
  }
 }
 throw new Error('WebGL2 unavailable');
}

export function releaseHeadRenderer(renderer,composer){
 // Composer.dispose does not dispose the passes' bloom targets/materials.
 if(composer){for(const pass of composer.passes)pass.dispose?.();composer.dispose();}
 renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
}
