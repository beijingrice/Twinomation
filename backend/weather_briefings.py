"""Small parser for the explicit demo briefing format, not METAR/TAF or live weather."""
import re
from datetime import datetime, timedelta, timezone

from .db import STATIONS, encode, now, transaction


def _stamp(value):
    try:
        parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
        return parsed.astimezone(timezone.utc).isoformat().replace('+00:00','Z') if parsed.utcoffset() is not None else None
    except (ValueError,AttributeError,OverflowError):
        return None


def parse_briefing(text, station):
    route=re.search(r'^Route:\s*([A-Z]{3})\s*->\s*([A-Z]{3})\s*$',text,re.M|re.I)
    if not route or route[1].upper()!=station:
        raise ValueError('The briefing route must start at the selected station.')
    destination=route[2].upper()
    warnings=[]
    def line(body,key):
        match=re.search(r'^'+re.escape(key)+r':\s*([^\n\r]+)',body,re.M|re.I)
        return match[1].strip() if match else None
    def section(role,airport):
        match=re.search(r'\['+role+r'\s+'+airport+r'\]\s*\n(.*?)(?=\n\[|\Z)',text,re.S|re.I)
        body=match[1] if match else ''
        fields={'airport':airport}
        specs=[('visibility_m','Visibility',r'(\d+(?:\.\d+)?)\s*(m|km)',0,100000),
               ('wind_direction_deg','Wind direction',r'(\d+)\s*deg',0,360),
               ('wind_speed_kt','Wind speed',r'(\d+(?:\.\d+)?)\s*kt',0,250),
               ('gust_kt','Gust',r'(\d+(?:\.\d+)?)\s*kt',0,250),
               ('cloud_base_ft','Cloud base',r'(\d+)\s*ft',0,60000),
               ('temperature_c','Temperature',r'(-?\d+(?:\.\d+)?)\s*°?C',-90,60),
               ('humidity_pct','Humidity',r'(\d+(?:\.\d+)?)\s*%',0,100),
               ('qnh_hpa','QNH',r'(\d+(?:\.\d+)?)\s*hPa',850,1100)]
        for key,label,pattern,low,high in specs:
            raw=line(body,label)
            found=re.fullmatch(pattern,raw or '',re.I)
            value=float(found[1]) if found else None
            if key=='visibility_m' and found and found[2].lower()=='km': value*=1000
            if value is None or not low<=value<=high:
                value=None
                if key not in ('gust_kt','humidity_pct'): warnings.append(role.lower()+'.'+key)
            fields[key]=value
        fields['conditions']=line(body,'Conditions')
        return fields
    issued=_stamp(line(text,'Issued'))
    valid_from=_stamp(line(text,'Valid from'))
    valid_to=_stamp(line(text,'Valid until'))
    if not issued: warnings.append('issued_at')
    if not valid_from or not valid_to or datetime.fromisoformat(valid_to.replace('Z','+00:00'))<=datetime.fromisoformat(valid_from.replace('Z','+00:00')):
        warnings.append('validity');valid_from=valid_to=None
    enroute_match=re.search(r'\[ENROUTE\]\s*\n(.*?)(?=\n\[|\Z)',text,re.S|re.I)
    enroute=enroute_match[1] if enroute_match else ''
    return {'demo':True,'route':{'departure':station,'destination':destination},'issued_at':issued,'valid_from':valid_from,'valid_to':valid_to,
            'departure':section('DEPARTURE',station),'destination':section('DESTINATION',destination),
            'enroute':{key:line(enroute,label) for key,label in [('summary','Summary'),('turbulence','Turbulence'),('icing','Icing'),('thunderstorms','Thunderstorms')]},'missing_fields':warnings}


def sample_briefing(station):
    index=next(i for i,s in enumerate(STATIONS) if s['code']==station)
    stamp=datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0)
    fmt=lambda value:value.isoformat().replace('+00:00','Z')
    visibility=[3500,6000,5000,8000,10000,7000,4000][index%7]
    conditions=['Light rain and mist','Cloudy','Light rain','Cloudy','Clear','Cloudy','Light rain'][index%7]
    return f'''DEMO ROUTE WEATHER BRIEFING — simulated data
Route: {station} -> HKG
Issued: {fmt(stamp)}
Valid from: {fmt(stamp)}
Valid until: {fmt(stamp+timedelta(hours=6))}

[DEPARTURE {station}]
Visibility: {visibility} m
Wind direction: {80+index*20} deg
Wind speed: {12+index} kt
Gust: {20+index} kt
Cloud base: {1200+index*300} ft
Conditions: {conditions}
Temperature: {16+index} C
Humidity: {86-index} %
QNH: {1008+index} hPa

[DESTINATION HKG]
Visibility: 10000 m
Wind direction: 090 deg
Wind speed: 8 kt
Gust: 14 kt
Cloud base: 3000 ft
Conditions: Cloudy
Temperature: 25 C
Humidity: 77 %
QNH: 1012 hPa

[ENROUTE]
Summary: Scattered showers
Turbulence: Moderate at cruise level
Icing: Not indicated in this sample
Thunderstorms: Isolated cells near coastal sector
'''


def seed_weather_briefings(path):
    with transaction(path) as db:
        for station in STATIONS:
            code=station['code']
            if db.execute('SELECT 1 FROM weather_briefings WHERE station=?',(code,)).fetchone(): continue
            raw=sample_briefing(code)
            db.execute('INSERT INTO weather_briefings(station,source_name,raw_text,parsed_json,created_at,created_by) VALUES(?,?,?,?,?,?)',
                       (code,'Demo route briefing',raw,encode(parse_briefing(raw,code)),now(),'demo.seed'))
