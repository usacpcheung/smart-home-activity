export function qs(sel, el=document){ return el.querySelector(sel); }
export function qsa(sel, el=document){ return [...el.querySelectorAll(sel)]; }
