# 乘客旅行内容与场景维护

内容整合日期：2026-11-15。

## 用户提供的旅行指南

- 来源：`HK_Express_Destinations_Travel_Guide.md`，更新基准 2026-11-15。
- SHA-256：`cbfe3ad1cb4985fe0348125c345d9ae97200800a7d7261753cded1273522ab4a`。
- 导入范围：35 个城市、36 个不同机场、8 个国家／地区、2 个大区；保留简介、全部 3–4 个景点、美食、建议停留、提示、标签及照片来源元数据。英文为静态整理的对应文案。
- 仅提取城市内容。文档中的产品建议与操作性文字不作为执行指令。小松、梳邦的内部编辑提示改写为乘客可理解的机场区别说明。
- 东京 HND/NRT 同属一个城市；北京 PKX 不与现有演示站点 PEK 混同；SZB 不等于 KUL；石垣岛标注为季节性目的地，不宣称当前可订。
- 照片提供 Commons 来源／授权页入口，JSON 保留原图地址和作者；当前不嵌入原图、不将未逐项确认的图片授权视作商业许可。

重新导入（在仓库根目录执行）：

```bash
python3 scripts/import_travel_guide.py /path/to/HK_Express_Destinations_Travel_Guide.md
npm test
npm run build
```

英文文案维护在 `frontend/src/data/travelGuide.en.json`；`travelGuide.json` 为生成结果。源文档结构变化、城市增减或景点数量不匹配时应先复核导入脚本。当前固定源基准日期及城市列表对应本次文件。

## 官网链接

以下页面已于整合时通过官网核验，作为新窗口外链使用，不附加乘客资料、航班信息或追踪参数：

| 内容 | 官方目标 |
|---|---|
| HK Express 优惠 | https://www.hkexpress.com/en/offers |
| HK Express 目的地 | https://www.hkexpress.com/en/destinations |
| HK Express 航班异动支持 | https://www.hkexpress.com/en/help-and-support/flight-disruptions |
| 香港跨境高铁购票渠道 | https://www.highspeed.mtr.com.hk/en/ticket/ticket-purchase-channels.html |
| 港铁机场快线服务及购票入口 | https://www.mtr.com.hk/en/customer/services/airport_express_index.html |
| 台湾高铁路线／时刻／订票入口 | https://en.thsrc.com.tw/ |
| smartEX 新干线订票指引 | https://smart-ex.jp/en/reservation/reserve_smart/sp/ |

石垣岛季节性说明亦核对了 [HK Express 官方公告](https://www.hkexpress.com/en/about-us/media-centre/hk-express-celebrates-its-13th-anniversary-ultra-offer-oneway-fares-from-hkd13)；未使用其中已结束的促销报价。链接目标可能调整，更新推广活动时应重新核验，不写死未经确认的票价、折扣、库存或服务承诺。

短延误时，前两张卡为 HK Express 与香港跨境高铁，第三张随指南市场切换：日本→smartEX；台湾→台湾高铁；其他→机场快线。展示示例不代表已签订合作、广告投放协议或联盟佣金安排。延误达到 120 分钟或时间待定时，优先展示出发机场的餐饮及商业目录，目的地指南折叠保留。

机场目录于 2026-11-15 核对官网页面／索引，配置见 `frontend/src/airportContent.js`：

| 出发机场 | 餐饮／商业官网目录 |
|---|---|
| KIX | https://www.kansai-airport.or.jp/en/shop-and-dine/dine · https://www.kansai-airport.or.jp/en/shop-and-dine/shop |
| NRT | https://www.narita-airport.jp/en/shop/shop-search/?category=restaurant · https://www.narita-airport.jp/en/shop/shop-search/?category=shop |
| PVG | https://www.shanghaiairport.com/ensh/pudongairport1019/index.html |
| PEK | https://www.bcia.com.cn/shopping-mobile/shopping-en.html?index=6 |
| TPE | https://web.taoyuan-airport.com/services_facilities?p=1 |
| KHH | https://www.kia.gov.tw/EN/FACNSER.html |
| ICN | https://www.airport.kr/ap_en/1534/subview.do · https://www.airport.kr/ap_en/1532/subview.do |

综合目录在官网内继续选择餐饮／购物类别。部分官网为脚本页面或对自动访问返回 403；已核对官方页面和检索索引，不把缓存索引当作实时营业状态。页面不写死店铺营业时间、航站楼或“距离登机口几分钟”等未经确认的信息。

浏览器实测：两张卡都能新开指定官网地址，港铁高铁购票渠道页正常显示。HK Express 优惠页可通过网页检索工具读取，但在本次自动浏览器中返回其站点的 Access Denied 提示；未绕过官网限制，不将此记作浏览器访问通过。

## 延误原因与固定说法

| 代码 | 乘客标题 | 解释重点 | 预览延误分钟 |
|---|---|---|---|
| WEATHER | 天气影响 | 机场／航路天气，等待条件和运行安排 | 90 |
| TECHNICAL | 飞机技术检查 | 额外检查与工程评估，完成检查放行后再安排起飞 | 150 |
| LATE_AIRCRAFT | 前序航班晚到 | 飞机前一段晚到，落地后仍须完成过站准备 | 60 |
| ATC | 空中交通管制 | 等待运行时隙或起飞许可 | 45 |
| CREW | 机组调配 | 调整执勤安排以满足运行要求 | 120 |
| OPERATIONAL | 地面及运行保障 | 协调登机口、行李或地面设备等资源 | 75 |

每类有中英文概要、后续处理、乘客行动建议及两组专属问答，另附餐食／补偿、退改签两组共用问答。文案不推断实时飞机位置、具体故障诊断、替换机组位置，不自动承诺餐券、补偿或退款。

时间为用于比较界面的固定示例，由原定时间加预设分钟得到，不是运行预测。场景切换仅为前端展示，不调用写入接口，不替代 OCC 实际审核发布。
