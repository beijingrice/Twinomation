import React,{useEffect,useRef} from 'react';
import {t} from './i18n';

import {hktInput,fromHkt} from './timeInput.js';
export {hktInput,fromHkt} from './timeInput.js';
export default function TimeWheel({value,onChange,label,optional=false}) {
  const drag=useRef(null),root=useRef(null),shown=value||hktInput(new Date().toISOString());
  const change=value=>{const form=root.current?.closest('form');if(form)form.dataset.dirty='true';onChange(value);};
  const adjust=(minutes)=>change(hktInput(new Date(new Date(fromHkt(shown)).getTime()+minutes*60000).toISOString()));
  useEffect(()=>{const el=root.current;const wheel=e=>{const spin=e.target.closest('[data-step]');if(spin&&e.deltaY){e.preventDefault();adjust((e.deltaY<0?1:-1)*Number(spin.dataset.step));}};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[shown]);
  return <div ref={root} className="time-wheel" role="group" aria-label={label}><div className="time-wheel-columns">{[['Date',1440,shown.slice(5,10)],['Hour',60,shown.slice(11,13)],['Minute',1,shown.slice(14,16)]].map(([name,minutes,text])=><div key={name}>
    <small>{t(name)}</small><button type="button" aria-label={t('Decrease {0}',{0:t(name)})} onClick={()=>adjust(-minutes)}>−</button>
    <span data-step={minutes} role="spinbutton" tabIndex={0} aria-label={`${label} · ${t(name)}`} aria-valuetext={String(text)} aria-valuenow={name==='Date'?Math.floor(new Date(fromHkt(shown)).getTime()/86400000):Number(text)}
      onKeyDown={e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();adjust(e.key==='ArrowUp'?minutes:-minutes);}}}
      onPointerDown={e=>{if(e.pointerType!=='mouse'){drag.current={y:e.clientY,id:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);}}}
      onPointerMove={e=>{if(drag.current?.id===e.pointerId){const steps=Math.trunc((drag.current.y-e.clientY)/25);if(steps){drag.current.y=e.clientY;adjust(steps*minutes);}}}} onPointerUp={()=>{drag.current=null;}}>{text}</span>
    <button type="button" aria-label={t('Increase {0}',{0:t(name)})} onClick={()=>adjust(minutes)}>+</button></div>)}</div>
    <label>{label}<input type="datetime-local" value={value} onChange={e=>change(e.target.value)}/></label><div className="button-row"><button type="button" className="button glass small" onClick={()=>change(hktInput(new Date().toISOString()))}>{t('Use now')}</button>{optional&&<button type="button" className="button glass small" onClick={()=>change('')}>{t('Clear time')}</button>}</div>
  </div>;
}
