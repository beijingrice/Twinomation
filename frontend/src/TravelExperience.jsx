import React, {useState} from 'react';
import {ArrowUpRight, BookOpen, Camera, Compass, Info, MapPin, Plane, TrainFront, Utensils} from 'lucide-react';
import {Widget} from './components';
import {t, useLocale} from './i18n';
import {DESTINATIONS, MARKETS, TRAVEL_REGIONS, TRAVEL_SOURCE, OFFICIAL_LINKS, destinationForFlight, localCopy, promotionCards} from './travelContent';

export function OfficialLink({href, children, className=''}) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={15} aria-hidden="true"/></a>;
}

export default function TravelExperience({flight, showPromotions=true}) {
  const language = useLocale();
  const [selectedId,setSelectedId] = useState(() => destinationForFlight(flight).id);
  const destination = DESTINATIONS.find(d => d.id === selectedId);
  const copy = localCopy(destination.copy,language);
  const market = MARKETS.find(m => m.id === destination.market);
  const region = TRAVEL_REGIONS.find(r => r.id === destination.region);
  const cards = promotionCards(destination.market);
  return <>
    <Widget span={6} icon={Compass} label={t('Travel inspiration')} className="travel-guide">
      <div className="travel-intro"><h2>{t('Where would you like to go next?')}</h2><p>{t('35 cities · 8 countries and regions · From your travel guide')}</p></div>
      <div className="preview-fields travel-selectors">
        <label>{t('Country / region')}<select value={destination.market} onChange={e => setSelectedId(DESTINATIONS.find(d=>d.market===e.target.value).id)}>
          {TRAVEL_REGIONS.map(r=><optgroup key={r.id} label={localCopy(r,language)}>{MARKETS.filter(m=>m.region===r.id).map(m=><option key={m.id} value={m.id}>{localCopy(m,language)}</option>)}</optgroup>)}
        </select></label>
        <label>{t('Destination')}<select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
          {DESTINATIONS.filter(d=>d.market===destination.market).map(d=><option key={d.id} value={d.id}>{localCopy(d.name,language)} · {d.airports.join(' / ')}</option>)}
        </select></label>
      </div>
      <div className="destination-heading"><div><small>{localCopy(region,language)} · {localCopy(market,language)}</small><h3>{localCopy(destination.name,language)}</h3></div><span className="airport-code">{destination.airports.join(' / ')}</span></div>
      <div className="travel-tags">{copy.tags.map(tag=><span key={tag}>{tag}</span>)}{destination.seasonal&&<span className="seasonal-tag">{t('Seasonal destination')}</span>}</div>
      <p className="destination-description">{copy.description}</p>
      <p className="travel-stay"><BookOpen size={16}/><span>{t('Suggested stay')}: {copy.stay}</span></p>
      <section className="travel-attractions"><h4><MapPin size={16}/>{t('Places to explore')}</h4><ul>{copy.attractions.map(place=>{const split=place.indexOf(language==='zh'?'：':':');return <li key={place}>{split>0?<><strong>{place.slice(0,split)}</strong><span>{place.slice(split+1).trim()}</span></>:place}</li>;})}</ul></section>
      <div className="travel-food"><Utensils size={17}/><div><h4>{t('Local flavours')}</h4><p>{copy.food}</p></div></div>
      <div className="travel-tip"><Info size={17}/><div><h4>{t('Before you go')}</h4><p>{copy.tip}</p></div></div>
      <div className="travel-sources">
        <OfficialLink href={destination.photo.source}><Camera size={15}/>{t('View real photo & attribution')}</OfficialLink>
        <OfficialLink href={OFFICIAL_LINKS.hkExpressDestinations}>{t('HK Express destinations')}</OfficialLink>
      </div>
      <p className="content-note">{t('Travel inspiration, not live flight availability. Check opening times and transport with the operator.')} {t('Guide updated: {0}',{0:TRAVEL_SOURCE.date})}</p>
    </Widget>
    {showPromotions && <Widget span={6} icon={Plane} label={t('Promotions & onward travel')} className="travel-promotions">
      <p className="content-note">{t('Promotional examples · Official external links · No booking is made on this page.')}</p>
      <div className="promotion-grid">{cards.map(card=>{const Icon=card.kind==='airline'?Plane:TrainFront;return <a key={card.id} className={'promotion-card '+card.kind} href={card.url} target="_blank" rel="noopener noreferrer">
        <div className="promotion-brand"><Icon size={21}/><span>{card.brand}</span><span className="ad-label">{t('Promotion')}</span></div>
        <h3>{localCopy(card.title,language)}</h3><p>{localCopy(card.text,language)}</p>
        <span className="promotion-action">{localCopy(card.action,language)}<ArrowUpRight size={17}/></span>
      </a>;})}</div>
      <p className="content-note">{t('Prices, availability and conditions are set by the official provider. These examples do not imply a commercial partnership.')}</p>
    </Widget>}
  </>;
}
