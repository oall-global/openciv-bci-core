import {CHANNELS} from './channels.mjs';
import {REGIONS,regionFor,channelVisual} from './regional-signal.mjs';
import {rippleSignal} from './ripple-signal.mjs';

// allow(id): which channels may give a plume (佩戴: only those whose contact has been steady)
// one per electrode (主图's plumes), region 'c<id>'
export function channelSamples(store,metric='rms',now=Date.now(),allow=null){
 if(!store?.source)return [];
 return CHANNELS.filter(c=>!allow||allow(c.id)).flatMap(c=>{
  const v=channelVisual(store,c.id,metric,now);if(!v.valid)return [];
  const sample=rippleSignal(store,c.id,now,true);if(!sample)return [];
  return [{...sample,region:'c'+c.id,level:Math.min(1,metric==='rms'?v.value/40:Math.sqrt(v.value)/20)}];
 });
}

export function outwardSamples(store,metric='rms',now=Date.now(),allow=null){
 if(!store?.source)return [];
 return Object.entries(REGIONS).flatMap(([key,region])=>{
  const rows=CHANNELS.filter(c=>regionFor(c.name)===region).map(c=>({id:c.id,...channelVisual(store,c.id,metric,now)})).filter(v=>v.valid&&(!allow||allow(v.id))).sort((a,b)=>b.value-a.value);
  for(const row of rows){
   const sample=rippleSignal(store,row.id,now,true);if(!sample)continue;
   const value=rows.reduce((sum,v)=>sum+v.value,0)/rows.length;if(value===0)return [];
   return [{...sample,region:key,color:region.color,level:Math.min(1,metric==='rms'?value/40:Math.sqrt(value)/20),key:`${store.source}/${store.stream}/${store.mode}/${metric}/${key}`}];
  }
  return [];
 });
}
