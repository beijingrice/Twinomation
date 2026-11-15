export const hasUnsavedForms=(root=document)=>!!root?.querySelector('form[data-dirty="true"]');
export function markDirty(event) {
  const form=event.target.closest('form');
  if(form)form.dataset.dirty='true';
}
export function markSaved(form) {if(form)form.dataset.dirty='false';}
export function mayLeave(message,root=document) {
  if(!hasUnsavedForms(root))return true;
  if(!window.confirm(message))return false;
  root.querySelectorAll('form[data-dirty="true"]').forEach(markSaved);
  return true;
}
window.addEventListener('beforeunload',event=>{if(hasUnsavedForms()){event.preventDefault();event.returnValue='';}});
