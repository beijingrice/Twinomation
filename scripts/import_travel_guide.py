"""Import destination content, never document instructions, into a static catalogue."""
import argparse
import hashlib
import json
import re
from pathlib import Path

MARKETS = {'中国内地': 'CN', '中国台湾地区': 'TW', '日本': 'JP', '韩国': 'KR', '泰国': 'TH', '越南': 'VN', '马来西亚': 'MY', '菲律宾': 'PH'}
SLUGS = ['beijing', 'changzhou', 'hefei', 'ningbo', 'sanya', 'wuxi', 'yiwu', 'taipei', 'taichung', 'kaohsiung', 'tokyo', 'osaka', 'nagoya', 'fukuoka', 'hiroshima', 'okinawa', 'sendai', 'takamatsu', 'komatsu', 'ishigaki', 'seoul', 'busan', 'daegu', 'jeju', 'bangkok', 'chiang-mai', 'phuket', 'hanoi', 'da-nang', 'phu-quoc', 'kuala-lumpur', 'penang', 'kota-kinabalu', 'manila', 'clark']


def import_guide(source, english):
    text = source.read_text()
    titles = list(re.finditer(r'^#### (\d+)\. (.+?) · (.+?)（([^）]+)）\s*$', text, re.M))
    if len(titles) != 35:
        raise ValueError('Expected the supplied 35-city guide; review the import if its structure changes.')
    destinations = []
    for i, heading in enumerate(titles):
        body = text[heading.end():titles[i + 1].start() if i + 1 < len(titles) else text.index('## 给 GroundSync')]
        prefix = text[:heading.start()]
        market = MARKETS[re.findall(r'^### (.+)$', prefix, re.M)[-1]]
        region = 'SEA' if re.findall(r'^## (东亚|东南亚)', prefix, re.M)[-1] == '东南亚' else 'EA'
        def field(pattern):
            match = re.search(pattern, body, re.M)
            if not match:
                raise ValueError(f'Missing field for {heading[2]}: {pattern}')
            return match[1].strip().replace('**', '')
        slug = SLUGS[i]
        original = {
            'description': field(r'\n\n([^\n]+)\n\n\*\*值得游览'),
            'attractions': re.findall(r'^- (.+)$', body.split('**值得游览的景点**')[1].split('**推荐美食')[0], re.M),
            'food': field(r'^\*\*推荐美食：\*\* (.+)$'),
            'tip': field(r'^\*\*出行提示：\*\* (.+)$'),
            'tags': field(r'\*\*标签：\*\* (.+)$').split(' · '),
        }
        # Rewrite source editorial guidance as passenger-facing airport facts.
        if slug == 'komatsu': original['tip'] = 'KMQ 是小松机场，不在金泽市中心；前往金泽或加贺温泉乡需另计地面交通时间。'
        if slug == 'kuala-lumpur': original['tip'] = '此资料中的目的地机场为 SZB 梳邦机场，不是 KUL 吉隆坡国际机场，请核对机场代码。'
        stay = field(r'\*\*推荐停留：\*\* (.+?)\s*｜')
        translated = {**english[slug], 'stay': stay.replace('天', 'days').strip()}
        if len(translated['attractions']) != len(original['attractions']):
            raise ValueError(f'Attraction translations do not match: {slug}')
        destinations.append({
            'id': slug, 'region': region, 'market': market,
            'name': {'zh': heading[2], 'en': heading[3]},
            'airports': re.findall(r'[A-Z]{3}', heading[4]), 'seasonal': slug == 'ishigaki',
            'copy': {'zh': {**original, 'stay': stay}, 'en': translated},
            'photo': {'label': field(r'^\*\*实景照片 — (.+)\*\*'),
                      'url': field(r'^- \*\*图片原始 URL：\*\* <(.+)>'),
                      'source': field(r'^- \*\*图片来源／授权页：\*\* <(.+)>'),
                      'credit': field(r'^- \*\*摄影／来源署名：\*\* (.+)（请以原始页面当前版权信息为准）')}
        })
    return {'source': {'file': source.name, 'date': '2026-11-15', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}, 'destinations': destinations}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--english', type=Path, default=Path('frontend/src/data/travelGuide.en.json'))
    parser.add_argument('--output', type=Path, default=Path('frontend/src/data/travelGuide.json'))
    args = parser.parse_args()
    result = import_guide(args.source, json.loads(args.english.read_text()))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'Imported {len(result["destinations"])} cities / {sum(len(d["airports"]) for d in result["destinations"])} airports.')
