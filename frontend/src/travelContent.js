import guide from './data/travelGuide.json' with { type: 'json' };

export const TRAVEL_SOURCE = guide.source;
export const DESTINATIONS = guide.destinations;
export const MARKETS = [
  {id:'CN',region:'EA',zh:'中国内地',en:'Mainland China'}, {id:'TW',region:'EA',zh:'台湾',en:'Taiwan'},
  {id:'JP',region:'EA',zh:'日本',en:'Japan'}, {id:'KR',region:'EA',zh:'韩国',en:'South Korea'},
  {id:'TH',region:'SEA',zh:'泰国',en:'Thailand'}, {id:'VN',region:'SEA',zh:'越南',en:'Vietnam'},
  {id:'MY',region:'SEA',zh:'马来西亚',en:'Malaysia'}, {id:'PH',region:'SEA',zh:'菲律宾',en:'Philippines'}
];
export const TRAVEL_REGIONS = [{id:'EA',zh:'东亚',en:'East Asia'},{id:'SEA',zh:'东南亚',en:'Southeast Asia'}];
export const localCopy = (value, language) => value[language === 'zh' ? 'zh' : 'en'];
export function destinationForFlight(flight) {
  // Exact IATA matches only: PEK is not PKX, and KUL is not SZB.
  return DESTINATIONS.find(d => d.airports.includes(flight.destination))
    || DESTINATIONS.find(d => d.airports.includes(flight.station))
    || DESTINATIONS.find(d => d.id === 'tokyo');
}

// Official destinations checked 2026-11-15; do not append passenger data to URLs.
export const OFFICIAL_LINKS = {
  hkExpressOffers:'https://www.hkexpress.com/en/offers',
  hkExpressDestinations:'https://www.hkexpress.com/en/destinations',
  hkExpressSupport:'https://www.hkexpress.com/en/help-and-support/flight-disruptions',
  hongKongRail:'https://www.highspeed.mtr.com.hk/en/ticket/ticket-purchase-channels.html',
  airportExpress:'https://www.mtr.com.hk/en/customer/services/airport_express_index.html',
  taiwanRail:'https://en.thsrc.com.tw/',
  japanRail:'https://smart-ex.jp/en/reservation/reserve_smart/sp/'
};
export function promotionCards(market) {
  const cards = [
    {id:'hk-express',kind:'airline',brand:'HK Express',url:OFFICIAL_LINKS.hkExpressOffers,
      title:{zh:'下一程，飞向亚洲',en:'Your next Asian escape'},
      text:{zh:'浏览香港快运官方优惠与旅行产品，发现下一次旅程的灵感。',en:'Explore current HK Express offers and travel products for your next trip.'},
      action:{zh:'查看官方优惠',en:'Explore official offers'}},
    {id:'hong-kong-rail',kind:'rail',brand:'MTR · High Speed Rail',url:OFFICIAL_LINKS.hongKongRail,
      title:{zh:'从香港西九龙继续出发',en:'Continue from Hong Kong West Kowloon'},
      text:{zh:'查看跨境高铁购票渠道，规划香港与内地城市之间的下一段行程。',en:'Find official ticketing channels for onward high-speed rail journeys between Hong Kong and mainland cities.'},
      action:{zh:'高铁购票指南',en:'Rail ticketing guide'}}
  ];
  cards.push(market === 'TW'
    ? {id:'taiwan-rail',kind:'rail',brand:'Taiwan High Speed Rail',url:OFFICIAL_LINKS.taiwanRail,
       title:{zh:'搭高铁探索台湾',en:'Explore Taiwan by high-speed rail'},text:{zh:'前往台湾高铁官网查看路线、时刻与订票入口。',en:'Visit Taiwan High Speed Rail for routes, timetables and its booking service.'},action:{zh:'前往台湾高铁',en:'Visit Taiwan High Speed Rail'}}
    : market === 'JP'
    ? {id:'japan-rail',kind:'rail',brand:'JR · smartEX',url:OFFICIAL_LINKS.japanRail,
       title:{zh:'用新干线串联日本城市',en:'Connect Japanese cities by Shinkansen'},text:{zh:'查看东海道、山阳及九州新干线的 smartEX 官方订票指引。',en:'Read the official smartEX reservation guide for the Tokaido, Sanyo and Kyushu Shinkansen.'},action:{zh:'新干线订票指引',en:'Shinkansen reservation guide'}}
    : {id:'airport-express',kind:'rail',brand:'MTR · Airport Express',url:OFFICIAL_LINKS.airportExpress,
       title:{zh:'抵达香港，轻松进城',en:'Arrive in Hong Kong, continue into the city'},text:{zh:'查看机场快线路线、服务及官方网上购票入口。',en:'Find Airport Express routes, services and its official online ticketing link.'},action:{zh:'查看机场快线',en:'Explore Airport Express'}});
  return cards;
}
