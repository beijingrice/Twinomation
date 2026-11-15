import React from 'react';
import {ArrowUpRight, Coffee, MapPin, ShoppingBag, Utensils} from 'lucide-react';
import {Widget} from './components';
import {t,useLocale} from './i18n';
import {AIRPORT_DIRECTORIES} from './airportContent';

export default function AirportExperience({station}) {
  const language=useLocale();
  const airport=AIRPORT_DIRECTORIES[station];
  if (!airport) return null;
  const cards=[
    {id:'dining',icon:Utensils,title:'Find something to eat',text:'Meals, coffee and light bites',action:'Browse airport dining'},
    {id:'shopping',icon:ShoppingBag,title:'Explore airport shops',text:'Travel essentials, gifts and duty-free',action:'Browse airport shops'}
  ];
  return <Widget span={6} icon={Coffee} label={t('While you wait')} className="airport-experience">
    <div className="airport-heading"><div><h2>{t('Make the wait more comfortable')}</h2><p><MapPin size={14}/>{airport[language]} · {station}</p></div></div>
    <div className="airport-cards">{cards.map(card=><a key={card.id} href={airport[card.id]} target="_blank" rel="noopener noreferrer" className={'airport-card '+card.id}>
      <card.icon size={28}/><h3>{t(card.title)}</h3><p>{t(card.text)}</p><span>{t(card.action)}<ArrowUpRight size={18}/></span>
    </a>)}</div>
    <p className="content-note">{t('Check your terminal, security zone and opening hours. Keep time to return to your gate.')}</p>
  </Widget>;
}
