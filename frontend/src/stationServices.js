export function broadcastTargets(stations,scope,targets) {
  return stations.filter(s=>scope==='all' || scope==='regions' && targets.includes(s.region) || scope==='stations' && targets.includes(s.code));
}
export function visibilityText(value) {
  if(value==null || !Number.isFinite(value)) return '—';
  return value>=1000 ? `${value/1000} km` : `${value} m`;
}
