export const FACE_TIMEOUT=650;
export function faceSample(result,now=performance.now()){
 if(!result?.found||!(Array.isArray(result.matrix)||ArrayBuffer.isView(result.matrix))||result.matrix.length!==16||!result.matrix.every(Number.isFinite))return null;
 const m=result.matrix;
 // A degenerate pose matrix would produce a non-finite rotation and blank mesh.
 for(const offset of [0,4,8]){const scale=Math.hypot(m[offset],m[offset+1],m[offset+2]);if(scale<.5||scale>2)return null;}
 const determinant=m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);
 if(determinant<.2||Math.abs(m[15]-1)>.01)return null;
 const shapes={};for(const c of result.categories||[]){if(typeof c.categoryName==='string'&&Number.isFinite(c.score))shapes[c.categoryName]=Math.max(0,Math.min(1,c.score));}
 return {source:'camera',at:now,matrix:Array.from(result.matrix),shapes};
}
export function shapeValue(shapes,name,mirror=false){
 let key=name.replace(/_L$/,'Left').replace(/_R$/,'Right');
 if(mirror)key=key.endsWith('Left')?key.slice(0,-4)+'Right':key.endsWith('Right')?key.slice(0,-5)+'Left':key;
 return Math.max(0,Math.min(1,shapes?.[key]||0));
}
export function faceIsFresh(sample,now=performance.now()){return !!sample&&now-sample.at>=0&&now-sample.at<FACE_TIMEOUT;}
