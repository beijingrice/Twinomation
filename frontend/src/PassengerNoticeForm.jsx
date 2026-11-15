import React,{useRef,useState} from 'react';
import {ArrowLeft,Eye,FileText,Send} from 'lucide-react';
import {t,eventText} from './i18n';
import {NOTICE_TEMPLATES,passengerNoticeTemplate,publishedNoticeForEvent} from './noticeTemplates';
import {api} from './api';
import {markSaved} from './draftGuard';

export default function PassengerNoticeForm({record,event,busy,paused,onSubmit,token,onDraftSaved}) {
  const existing=publishedNoticeForEvent(record,event);
  const savedDraft=record.workspace?.draft;
  const [template,setTemplate]=useState(savedDraft?.template||(existing?'custom':'flight_update'));
  const [draft,setDraft]=useState(()=>savedDraft?{text_zh:savedDraft.text_zh,text_en:savedDraft.text_en}:existing ? {text_zh:existing.final_text_zh||'',text_en:existing.final_text||''} : passengerNoticeTemplate('flight_update',record));
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const formRef=useRef(null);
  const [appliedTemplate,setAppliedTemplate]=useState(savedDraft?.template||(existing?'custom':'flight_update'));
  const [preview,setPreview]=useState(false);
  const key=useRef(crypto.randomUUID());
  const content=draft.text_zh.trim()||draft.text_en.trim()?draft:passengerNoticeTemplate('flight_update',record);
  const apply=()=>{formRef.current.dataset.dirty='true';setDraft(passengerNoticeTemplate(template,record));setAppliedTemplate(template);};
  const edit=(language,value)=>{setDraft(d=>({...d,[language]:value}));setAppliedTemplate('custom');};
  const save=async()=>{setSaving(true);setError('');try{const result=await api(`/cases/${record.id}/notice-draft`,{token,method:'PUT',body:{version:savedDraft?.version||0,...draft,template:appliedTemplate,source_event_id:event.id}});markSaved(formRef.current);onDraftSaved(result);}catch(e){setError(e.message);}finally{setSaving(false);}};
  return <form ref={formRef} className="notice-editor" onSubmit={e=>{e.preventDefault();if(preview && !paused && !busy) onSubmit({version:record.version,...content,template:draft.text_zh.trim()||draft.text_en.trim()?appliedTemplate:'flight_update'},key.current);else setPreview(true);}}>
    {error&&<p className="notice warn" role="alert">{t(error)}</p>}
    <div className="notice-source"><FileText size={17}/><span><small>{t('Source event · internal reference')}</small><strong>{eventText(event)}</strong></span></div>
    {!preview ? <>
      <div className="notice-template-row"><label>{t('Notice template')}<select value={template} onChange={e=>setTemplate(e.target.value)}>{NOTICE_TEMPLATES.map(([id,label])=><option key={id} value={id}>{t(label)}</option>)}</select></label><button type="button" className="button glass" onClick={apply}>{t('Apply template')}</button></div>
      <div className="notice-language-fields"><label>{t('Chinese notice')}<textarea value={draft.text_zh} maxLength={3000} rows={6} onChange={e=>edit('text_zh',e.target.value)}/></label><label>{t('English notice')}<textarea value={draft.text_en} maxLength={3000} rows={6} onChange={e=>edit('text_en',e.target.value)}/></label></div>
      <p className="form-hint">{t('Text is optional. Leave both languages blank to use the latest flight-arrangement template.')}</p>
      <div className="modal-actions"><button type="button" className="button glass" disabled={saving||busy} onClick={save}>{t(saving?'Saving…':'Save draft')}</button><button className="button primary" disabled={busy||saving}><Eye size={16}/>{t('Preview notice')}</button></div>
    </> : <>
      <p className="notice-preview-label">{t('Passengers will see this')}</p>
      <div className="notice-language-fields"><section className="notice-preview"><small>中文</small><p>{content.text_zh.trim() || content.text_en.trim()}</p></section><section className="notice-preview"><small>English</small><p>{content.text_en.trim() || content.text_zh.trim()}</p></section></div>
      {paused && <div className="notice warn">{t('Publishing is paused by OCC. Contact OCC to resume.')}</div>}
      <div className="modal-actions"><button type="button" className="button glass" disabled={busy} onClick={e=>{e.preventDefault();setPreview(false);}}><ArrowLeft size={16}/>{t('Back to editing')}</button><button className="button primary" disabled={busy || paused}><Send size={16}/>{busy?t('Publishing…'):t('Publish to passengers')}</button></div>
    </>}
  </form>;
}
