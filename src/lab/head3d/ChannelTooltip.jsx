import React from 'react';
import {channelVisual,regionFor,METRICS} from './regional-signal.mjs';

export function ChannelTooltip({channel,signal,metric,elementRef,onEnter,onLeave}){
 const reading=channelVisual(signal,channel.id,metric),region=regionFor(channel.name);
 return <div ref={elementRef} id="channel-tooltip" className="channel-tooltip" role="tooltip" style={{'--region-color':region.color}} onPointerEnter={onEnter} onPointerLeave={onLeave}>
  <div className="tooltip-heading"><strong>{channel.name}</strong><span>{channel.region}<small>通道 {String(channel.id).padStart(2,'0')} · {signal.source==='demo'?'模拟数据':signal.source==='device'?'设备数据':'等待连接'}</small></span></div>
  <div className="tooltip-tags">{channel.tags.join(' · ')}</div>
  <p>{channel.description}</p>
  <div className="tooltip-reading"><span>{METRICS.find(([key])=>key===metric)?.[1]}<small>{reading.label}</small></span><b>{reading.valid?reading.value.toFixed(1):'—'} <small>{reading.unit}</small></b></div>
  <p className="tooltip-note">{channel.note}</p><footer>位置为头皮示意 · 点击节点查看完整波形</footer>
 </div>;
}
