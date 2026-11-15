/** Date-time controls always use explicit HKT, independent of the device timezone. */
export const hktInput=iso=>iso?new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,16):'';
export const fromHkt=value=>value?`${value}:00+08:00`:null;
export function transferMargin(arrival,deadline,minutes){
  const a=Date.parse(fromHkt(arrival)),b=Date.parse(fromHkt(deadline)),m=Number(minutes);
  return Number.isFinite(a)&&Number.isFinite(b)&&Number.isFinite(m)&&m>=1&&m<=1440?Math.floor((b-a)/60000)-m:null;
}
