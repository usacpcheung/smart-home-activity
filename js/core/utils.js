export function qs(sel, el=document){ return el.querySelector(sel); }
export function qsa(sel, el=document){ return [...el.querySelectorAll(sel)]; }
export function log(el, msg){ const t=new Date().toLocaleTimeString(); el.textContent += `[${t}] ${msg}\n`; el.scrollTop=el.scrollHeight; }
