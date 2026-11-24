import React,{useEffect,useRef} from 'react';

// Decorative glyphs only: never render EEG, credentials or camera information.
export function CodeFlow(){
 const ref=useRef(null);
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas.getContext('2d');if(!ctx)return;
  let width=0,height=0,frame=0,last=-Infinity,disposed=false;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const resize=()=>{width=canvas.clientWidth;height=canvas.clientHeight;canvas.width=width;canvas.height=height;last=-Infinity;};
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  const glyphs='01ABCDEF<>{}[]/+=:';
  function draw(t){if(disposed)return;frame=requestAnimationFrame(draw);if(document.hidden||!width||!height)return;if(motion.matches&&last!==-Infinity)return;if(t-last<70)return;last=t;
   ctx.clearRect(0,0,width,height);ctx.font='11px Consolas, monospace';ctx.textAlign='center';
   const time=motion.matches?0:t/1000;
   for(let col=0;col<Math.ceil(width/38);col++){
    const x=col*38+15,speed=14+(col*7)%19,head=(time*speed+col*97)%(height+400)-110;
    for(let j=0;j<18;j++){const y=head-j*17;if(y<0||y>height)continue;const index=(col*13+j*7+Math.floor(time*.6))%glyphs.length;
     ctx.fillStyle=j===0?'rgba(128,222,255,.5)':`rgba(52,144,181,${(.32*(1-j/18)).toFixed(3)})`;ctx.fillText(glyphs[index],x,y);
    }
   }
  }
  const change=()=>{last=-Infinity;};motion.addEventListener('change',change);frame=requestAnimationFrame(draw);
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();motion.removeEventListener('change',change);};
 },[]);
 return <canvas ref={ref} className="code-flow" aria-hidden="true"/>;
}
