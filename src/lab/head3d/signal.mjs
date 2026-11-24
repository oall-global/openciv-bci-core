export const STALE_MS=3000;
export class SignalStore {
  constructor(){this.reset();}
  reset(){this.source=null;this.stream=null;this.rows=Array.from({length:16},()=>({points:[],lastT:null,at:0,band:null,bandAt:0}));this.status=null;this.statusAt=0;this.statusEmittedAt=0;this.quality=null;this.qualityAt=0;this.qualityEmittedAt=0;this.settled=false;this.meta={};this.waveTiming=null;this.mode='broadband';this.lastSequence=new Map();this.version=0;}
  clearWaves(){for(const r of this.rows){r.points=[];r.lastT=null;r.at=0;}this.settled=false;this.waveTiming=null;}
  setMode(mode){if(mode!==this.mode){this.mode=mode;this.clearWaves();}}
  ingest(msg,now=Date.now()){
    if(!msg||!['device','demo'].includes(msg.source))return;
    if(this.stream&&msg.streamId&&this.stream!==msg.streamId){const m=this.mode;this.reset();this.mode=m;}
    if(this.source&&this.source!==msg.source){const m=this.mode;this.reset();this.mode=m;}
    this.stream=msg.streamId||this.stream;this.source=msg.source;
    if(!['status','metadata'].includes(msg.type)&&Number.isFinite(msg.emittedAtMs)&&(now-msg.emittedAtMs>STALE_MS||msg.emittedAtMs-now>5000))return;
    const sequenceKey=msg.type;
    if(Number.isFinite(msg.sequence)){if(msg.sequence<=(this.lastSequence.get(sequenceKey)??-1))return;this.lastSequence.set(sequenceKey,msg.sequence);}
    const p=msg.payload||{};
    if(msg.type==='metadata'){this.meta=p;return;}
    if(msg.type==='status'){this.status=p;this.statusAt=now;this.statusEmittedAt=msg.emittedAtMs??now;if(p.valid===false||p.status!=='streaming')this.clearWaves();return;}
    if(msg.type==='quality'){this.quality=p;this.qualityAt=now;this.qualityEmittedAt=msg.emittedAtMs??now;if(p.valid===false)this.clearWaves();return;}
    if(msg.type==='bands'){
      for(const c of p.channels||[]){const r=this.rows[c.channel-1];if(r){r.band=c;r.bandAt=now;if(c.valid!==true){r.points=[];r.lastT=null;}}}return;
    }
    if(!['waves','eeg'].includes(msg.type))return;
    if((this.mode==='raw')!==(msg.type==='eeg'))return;
    if(msg.type==='waves'&&p.settled!==true){this.settled=false;this.clearWaves();return;}
    this.settled=true;
    const ids=Array.isArray(p.channels)?p.channels:this.meta.channelNumbers;
    const values=msg.type==='eeg'?p.samples:p[this.mode];
    const times=p.timestamps;
    // Never infer timebase, channel order, units or transpose an unknown raw schema.
    if(!Array.isArray(ids)||!Array.isArray(values)||!Array.isArray(times)||!times.length)return;
    if(p.unit&& !['µV','μV','uV'].includes(p.unit))return;
    if(values.length!==ids.length)return;
    const lastTimestamp=times.at(-1);
    if(Number.isFinite(lastTimestamp))this.waveTiming={at:now,lagMs:now-lastTimestamp*1000};
    ids.forEach((id,i)=>{
      const r=this.rows[id-1],row=values[i];if(!r||!Array.isArray(row)||row.length!==times.length)return;
      if(r.band&&r.band.valid!==true)return;
      if(this.status&&!this.acquisitionValid(now)||this.quality?.valid===false)return;
      for(let j=0;j<times.length;j++){
        const t=times[j],v=row[j];if(!Number.isFinite(t)||!Number.isFinite(v))continue;
        if(now-t*1000>STALE_MS||t*1000-now>5000)continue;
        if(r.lastT!==null&&t<=r.lastT)continue;
        if(r.lastT!==null&&t-r.lastT>.25)r.points.push({t:t-.000001,v:null});
        r.points.push({t,v});r.lastT=t;r.at=now;
      }
      if(r.points.length){const cutoff=r.lastT-10;let n=0;while(n<r.points.length&&r.points[n].t<cutoff)n++;if(n)r.points.splice(0,n);if(r.points.length>12000)r.points.splice(0,r.points.length-12000);}
    });this.version++;
  }
  acquisitionValid(now=Date.now()){
    if(this.status?.status!=='streaming')return false;
    if(this.status.valid===true)return true;
    // Brain Lab status.valid is a one-time freshness snapshot at subscription/start.
    // Only a newer, fresh quality event can recover this specific transient reason.
    // Its global sequence is authoritative even when both events share a millisecond.
    if(this.status.reason!=='not_receiving_fresh_data'||this.quality?.valid!==true||now-this.qualityAt>STALE_MS)return false;
    const statusSequence=this.lastSequence.get('status'),qualitySequence=this.lastSequence.get('quality');
    return Number.isFinite(statusSequence)&&Number.isFinite(qualitySequence)?qualitySequence>statusSequence:this.qualityEmittedAt>this.statusEmittedAt;
  }
  state(id,now=Date.now()){
    const r=this.rows[id-1];if(!this.source)return {valid:false,label:'等待数据'};
    if(!this.status)return {valid:false,label:'采集状态未更新'};
    if(!this.acquisitionValid(now))return {valid:false,label:this.status.status==='streaming'?'等待采集恢复':'设备未采集'};
    if(!this.quality||now-this.qualityAt>STALE_MS)return {valid:false,label:'质量状态未更新'};
    if(this.quality.valid!==true)return {valid:false,label:this.quality.reason==='validating_format'?'核验数据格式中':this.quality.reason==='transport_backlog'?'传输延迟，暂停显示':this.quality.reason==='transport_wait'?'等待设备新数据':'数据质量异常'};
    if(!r.band||now-r.bandAt>STALE_MS)return {valid:false,label:'通道检查未更新'};
    if(r.band.valid!==true)return {valid:false,label:r.band.reason==='warming'?'信号分析预热中':r.band.reason==='flat'?'信号近似平线':r.band.reason==='rail'?'信号超量程':r.band.reason==='amplitude'?'幅度检查未通过':r.band.reason?`通道检查未通过（${r.band.reason}）`:'通道无效'};
    if(!this.settled)return {valid:false,label:'滤波稳定中'};
    if(!r.at||now-r.at>STALE_MS){const timing=this.waveTiming;if(timing&&now-timing.at<=STALE_MS){if(timing.lagMs>STALE_MS)return {valid:false,label:'采样时间滞后'};if(timing.lagMs< -5000)return {valid:false,label:'采样时间异常'};}return {valid:false,label:'等待新波形'};}
    return {valid:true,label:this.source==='demo'?'模拟数据':'实时数据'};
  }
}
export function demoPacket(store,now=Date.now()){
 const end=now/1000, start=end-.10,ids=Array.from({length:16},(_,i)=>i+1),timestamps=Array.from({length:25},(_,i)=>start+i/250);
 const rows=ids.map(id=>timestamps.map(t=>{const a=id%5;return (11+a*2)*(.75+.35*Math.sin(t*.7+id*.8))*Math.sin(t*(8+a*.55)*Math.PI*2+id)+5*Math.sin(t*3.3*Math.PI*2+id*2)+3*Math.sin(t*23.1*Math.PI*2+id*.3)+1.5*Math.sin(t*37.3*Math.PI*2+id);}));
 const base={source:'demo',streamId:'local-demo',emittedAtMs:now};
 store.ingest({...base,type:'status',payload:{status:'streaming',valid:true}},now);
 store.ingest({...base,type:'quality',payload:{valid:true}},now);
 store.ingest({...base,type:'bands',payload:{channels:ids.map(id=>({channel:id,valid:true,alphaPeakHz:10+(id%3)*.5,dominantHz:10,bands:demoBands(id,end)}))}},now);
 store.ingest({...base,type:store.mode==='raw'?'eeg':'waves',payload:{channels:ids,timestamps,unit:'µV',settled:true,samples:rows,broadband:rows,alpha:ids.map(id=>timestamps.map(t=>(12+id%5)*Math.sin(t*(9+id%4)*Math.PI*2+id))),alphaAmplitude:ids.map(id=>timestamps.map(t=>12+id%5+2*Math.sin(t*.7+id)))}},now);
}

// Synthetic, independently varying channels for visual inspection only. These
// arbitrary changes are not trained task responses or measured band spectra.
function demoBands(id,t){
 const keys=['delta','theta','alpha','beta','gamma'],values=keys.map((_,i)=>[18,27,66,31.5,7.5][i]*(.8+.5*Math.sin(t*.6+id*.8+i)));
 const total=values.reduce((sum,v)=>sum+v,0);return Object.fromEntries(keys.map((key,i)=>[key,{absoluteUv2:values[i],relativePercent:values[i]/total*100}]));
}
