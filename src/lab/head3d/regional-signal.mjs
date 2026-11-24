import {CHANNELS} from './channels.mjs';
import {signalDiagnostics} from './signal-diagnostics.mjs';
export const REGIONS={
 frontal:{name:'额区',color:'#53d9ff'},
 central:{name:'中央区',color:'#65edb5'},
 temporal:{name:'颞区',color:'#b99aff'},
 parietal:{name:'顶区',color:'#ff9c85'},
 occipital:{name:'枕区',color:'#789dff'},
};
export const VISUAL_STYLES=[['pulse','柔和扩散'],['aura','微光节点'],['lines','经典细线'],['off','关闭效果']];
export const METRICS=[['rms','当前波形 RMS'],['theta','θ 能量 · 4–8 Hz'],['alpha','α 能量 · 8–13 Hz'],['beta','β 能量 · 13–30 Hz'],['delta','δ 能量 · 1–4 Hz'],['gamma','γ 能量 · 30–40 Hz']];
export const regionFor=name=>REGIONS[name.startsWith('F')?'frontal':name.startsWith('C')?'central':name.startsWith('T')?'temporal':name.startsWith('P')?'parietal':'occipital'];

// Shared, fixed scales across channels. Missing data is never interpreted as zero activity.
export function channelVisual(store,id,metric='rms',now=Date.now()){
 const state=store?.state(id,now),row=store?.rows[id-1];
 const empty={valid:false,value:null,level:0,unit:metric==='rms'?'µV':'µV²',label:state?.label||'等待数据'};
 if(!state?.valid||!row)return empty;
 let value;
 if(metric==='rms'){
  let sum=0,count=0,start=row.lastT;
  for(let i=row.points.length-1;i>=0;i--){const p=row.points[i];if(!Number.isFinite(p.v)||row.lastT-p.t>.5)break;sum+=p.v*p.v;count++;start=p.t;}
  if(count<8||row.lastT-start<.08)return {...empty,label:'等待连续波形'};
  value=Math.sqrt(sum/count);
 }else value=row.band?.bands?.[metric]?.absoluteUv2;
 if(!Number.isFinite(value)||value<0)return {...empty,label:'该指标暂无有效数据'};
 return {valid:true,value,level:Math.min(1,metric==='rms'?value/40:Math.sqrt(value)/20),unit:empty.unit,label:state.label};
}

export function regionalSummary(store,metric='rms',now=Date.now()){
 const regions=Object.entries(REGIONS).map(([key,region])=>{
  const channels=CHANNELS.filter(c=>regionFor(c.name)===region);
  const values=channels.map(c=>channelVisual(store,c.id,metric,now)).filter(v=>v.valid);
  const value=values.length?values.reduce((sum,v)=>sum+v.value,0)/values.length:null;
  return {...region,key,value,validCount:values.length,total:channels.length};
 });
 const ranked=regions.filter(r=>r.value!==null).sort((a,b)=>b.value-a.value),max=ranked[0]?.value||0;
 const complete=regions.every(r=>r.validCount===r.total);
 // Compare means, never sums: the montage has unequal region channel counts.
 // Missing coverage and near-ties must not produce a confident region claim.
 const leader=complete&&max>0&&ranked[0].value>(ranked[1]?.value||0)*1.05?ranked[0]:null;
 return {regions,leader,complete,max,validCount:regions.reduce((sum,r)=>sum+r.validCount,0),unit:metric==='rms'?'µV':'µV²',source:store?.source,diagnostics:store?signalDiagnostics(store,now):null};
}
