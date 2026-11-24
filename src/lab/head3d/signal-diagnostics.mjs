import {STALE_MS} from './signal.mjs';

// Status-only diagnosis: never includes samples, band powers or credentials.
export function signalDiagnostics(store,now=Date.now()){
 const reasons=new Map();let valid=0;
 for(let id=1;id<=16;id++){const state=store.state(id,now);if(state.valid)valid++;else reasons.set(state.label,(reasons.get(state.label)||0)+1);}
 const timing=store.waveTiming,fresh=timing&&now-timing.at<=STALE_MS;
 const delayed=fresh&&timing.lagMs>STALE_MS,future=fresh&&timing.lagMs< -5000;
 const main=[...reasons].sort((a,b)=>b[1]-a[1])[0];
 let title=!store.source?'等待设备数据':valid?`${valid}/16 路有效`:main?.[0]||'等待有效信号';
 const detail=[...reasons].map(([label,count])=>`${count} 路：${label}`).join('；');
 const timeNote=delayed?`采样时间落后约 ${(timing.lagMs/1000).toFixed(1)} 秒，超过 3 秒实时显示范围。`:future?'采样时间晚于本机时钟，请检查采集端时间。':'';
 let action='';
 if(delayed||future)action='请在 开源文明 BCI-001 停止后重新开始采集，检查波形和设备连接；若持续滞后，请检查采集端时间与缓冲。';
 else if(!valid&&store.source)action=title==='信号近似平线'?'请先确认 开源文明 BCI-001 中波形正常，并检查电极、参考/地连接及采集设置。':'请先检查 开源文明 BCI-001 的采集与通道状态。';
 if(store.meta?.backend==='wifi'){action=store.quality?.reason==='transport_backlog'?'连接仍保留，正在排空延迟数据；赶上后会重新预热。':store.quality?.reason==='transport_wait'?'正在等待设备发送新数据；持续收不到数据时会尝试重连。':delayed||future?'采样时序异常，直连服务将尝试重新建立采集。':!valid&&store.source?'直连先核验格式与速率，随后预热约 6 秒。若持续平线或幅度异常，请检查电极和设备设置；这些检查不等同于电极阻抗测量。':'';}
 return {valid,title,detail,timeNote,action};
}
