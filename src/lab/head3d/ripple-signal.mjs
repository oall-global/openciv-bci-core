// A bounded snapshot for visual feedback. Never substitute synthetic data for invalid EEG.
export function rippleSignal(store, selected, now=Date.now(),strict=false) {
  if (!store?.source) return null;
  const candidates=strict?[selected]:[selected,...Array.from({length:16},(_,i)=>i+1).filter(id=>id!==selected)];
  for(const id of candidates){
    if(!Number.isInteger(id)||id<1||id>16)continue;
    if(!store.state(id,now).valid)continue;
    const row=store.rows[id-1],end=row.lastT;
    let start=row.points.length;
    while(start>0){const p=row.points[start-1];if(!Number.isFinite(p.v)||end-p.t>.7)break;start--;}
    const points=row.points.slice(start);
    if(points.length<8||end-points[0].t<.08)continue;
    const rms=Math.sqrt(points.reduce((sum,p)=>sum+p.v*p.v,0)/points.length);
    const profile=new Float32Array(193);
    for(let i=0;i<profile.length;i++){
      const f=i/192*(points.length-1),lo=Math.floor(f),hi=Math.min(lo+1,points.length-1);
      const v=points[lo].v+(points[hi].v-points[lo].v)*(f-lo);
      // Taper the join and softly bound artifacts; this is not a calibrated graph.
      profile[i]=Math.tanh(v/45)*Math.sin(Math.PI*i/192)**2;
    }
    return {key:`${store.source}/${store.stream}/${store.mode}/${id}`,channel:id,level:Math.min(1,rms/50),profile};
  }
  return null;
}
