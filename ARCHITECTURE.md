# 项目结构与接手记录

核对日期：2026-11-15（HKT）。本文件描述当前源码；`Twinomation_Handoff.md` 的其余设计提案不代表已实现。

## 当前主流程

```text
OCC 创建航班 Case
  → 选择资源项目、建议时间、核对运营方信息
  → 发送 Work order v1（SENT）
外站接收（RECEIVED）
  → 回答预设项目，可增加自定义项目、备注和附件
  → 回覆 OCC（RESPONDED）
OCC 人工复核
  ├─ Authorise & publish → AUTHORIZED → 写入公开状态、发布历史 → 乘客刷新
  ├─ Reissue → 旧版本 REISSUED，新版本 SENT，保留旧答案供参考
  ├─ Stop → ABORTED，可另开新版，不等于取消航班
  └─ Cancel flight → 停止活动工单、关闭 Case、发布取消通知
```

Case 是航班协调容器；Work order 是可多次往返的版本。每个 Case 最多一个 SENT / RECEIVED / RESPONDED 的活动工单。所有预设资源 Ready 才可授权发布，否则须重新发起确认；自定义答案由 OCC 显式确认符合要求，系统不自动解释任意选项的含义。

## 源码地图

| 文件 | 职责 |
|---|---|
| `backend/main.py` | 请求模型、模拟员工会话、回环访问限制、角色/站点校验、业务 API、文件传输、乘客公开读模型、SSE、静态页面服务 |
| `backend/db.py` | SQLite 连接和短事务、建表及旧表加列、事件/草稿工具、合成航班和多状态工单种子 |
| `backend/station_services.py` / `weather_briefings.py` | OCC 广播、外站确认回执；演示简报生成、字段解析、站点权限及版本保存 |
| `backend/tests/test_station_services.py` | 广播收件范围、回执、幂等、乘客隔离，以及模拟天气解析、编辑冲突和重启保留 |
| `backend/tests/test_api.py` | 旧版 API 的身份隔离、草稿审核、幂等/并发、过时指引、关闭、链接和 SSE 上限回归 |
| `backend/tests/test_work_orders.py` | 新版工单闭环、站点权限、回覆校验、重发/停止/取消、文件、乘客类型链接和新增状态边界回归 |
| `frontend/src/main.jsx` | 按 URL 选择员工、乘客或入口页 |
| `frontend/src/Index.jsx` | OCC 与各外站入口 |
| `frontend/src/App.jsx` | 员工页会话、导航、刷新、全局弹窗、操作和文件上传协调 |
| `frontend/src/Broadcasts.jsx` / `WeatherBriefing.jsx` / `stationServices.js` | 广播范围选择、预览、回执；站点天气摘要、原文、编辑和提取预览 |
| `frontend/src/pages.jsx` | 总览、区域、站点、航班列表、工单详情、外站回覆和附件组件 |
| `frontend/src/forms.jsx` | 建 Case、发工单、审核发布、重发、停止、取消、乘客链接表单 |
| `frontend/src/passengerPreview.js` | 固定乘客预览地址及参数解析，无需签发链接，支持刷新和前进/后退 |
| `frontend/src/Passenger.jsx` | 公开状态、历史、本地场景预览、固定问答和中转航班演示 |
| `frontend/src/delayScenarios.js` | 六类中英文延误说明、下一步、建议、问答及通知示例；场景叠加不修改 API 数据 |
| `frontend/src/assistantSupport.js` | 温柔安抚与中转担忧入口，根据乘客当前可见的航班／衔接信息匹配固定双语答复，不推断情绪或改动预订 |
| `frontend/src/PassengerNoticeForm.jsx` / `noticeTemplates.js` | 外站时间线事件的通知编辑、双语模板、乘客预览；仅采用已公开运行字段，已有通知可带回编辑 |
| `frontend/src/passengerGuidance.js` | 120 分钟长短延误分流、未知时间处理及只读转机可行性计算 |
| `frontend/src/AirportExperience.jsx` / `airportContent.js` | 按出发站点展示七个机场的餐饮与商业官网目录 |
| `frontend/src/TravelExperience.jsx` / `travelContent.js` | 按国家和城市浏览目的地指南；官方推广及接续交通链接 |
| `frontend/src/data/travelGuide.json` / `travelGuide.en.json` | 原始指南内容、照片来源元数据及对应英文文案 |
| `scripts/import_travel_guide.py` | 从用户提供的指南导入 35 城市内容，保留来源哈希并校验英文景点数量 |
| `frontend/src/api.js` | JSON 请求、认证文件上传/下载、SSE 读取和轮询兜底 |
| `frontend/src/constants.js` | 地区/站点、资源与状态、下一步责任人、共用原因代码及图标 |
| `frontend/src/workflow.js` | 工单展示状态、下一步责任方和就绪情况摘要；版本与状态分开，保持后台流转规则不变 |
| `frontend/src/i18n.js` / `messages.js` | 中英文语言状态、浏览器语言和持久偏好、模板插值、系统文案词典；用户自由输入保持原文 |
| `frontend/tests/i18n.test.js` | 语言选择、插值、预设与自定义内容边界、切换与错误提示的回归测试 |
| `frontend/src/components.jsx` | 页面公共组件、弹窗焦点、HKT 日期时间显示 |
| `frontend/src/chime.js` | Web Audio 提示音和可选震动 |
| `frontend/src/styles.css` | 深色玻璃风格、员工布局、乘客卡片和响应式断点 |
| `scripts/run.sh` / `scripts/dev.sh` | 单进程本地运行 / Vite 热更新 |
| `vite.config.js` | 前端根目录、开发 API 代理、输出到 `dist/` |
| `data/` | 被忽略的运行数据库和内部附件；不属于源代码 |
| `artifacts/` | 人工页面核对截图 |

## 数据与刷新

SQLite 的主要表：`cases`、`work_orders`、`case_events`、`case_files`、`passenger_updates`、`passengers`、`idempotency_keys`、`settings`、`broadcasts`、`broadcast_recipients`、`weather_briefings`。业务写入用 `BEGIN IMMEDIATE`，在同一事务内校验版本并记录事件；附件本体在数据库同级的 `files/` 中，用随机存储名，元数据保存在 `case_files`。

公开状态与内部建议分开保存。乘客 API 只挑选航班标识、已授权状态/时间/登机口/原因和 PUBLISHED 历史；不传外站答案、员工备注或内部文件。后续回覆的登机口答案变化时，会清除旧公开登机口并标记旧指引失效，新位置仍需人工发布。

外站可从所属航班的时间线事件直接人工编辑／审核发布 `general` 乘客通知。原事件不可变，通知关联 `source_event_id`，新增 `PASSENGER_NOTICE_PUBLISHED` 审计事件记录原事件、通知和模板 ID。API 检查站点、Case 版本、暂停开关和幂等键；允许取消后的协助通知，保持关闭状态。`final_text_zh` 是兼容加列，用于保存显式审核的中文文案；运行状态和工单不随一般通知发布变化。乘客 SSE 接收新通知事件并重新读取公开模型。

SSE 每秒查询新事件，只推送刷新信号，员工按站点过滤，乘客只接收发布和公开指引失效事件。GET 是权威数据来源，客户端另外每 30 秒轮询。

OCC 广播在发送时解析区域／站点并保存具体收件站点快照，回执以站点为单位，由经理手动确认，不将“查看过”或网络连接等同于确认收到。广播与天气使用 `case_id=NULL` 的内部审计事件；外站 SSE 仅接收相关站点信号，乘客 SSE 和公开模型均排除这两类内部数据。广播不受乘客发布暂停开关影响。

天气只解析内置演示格式的显式字段，不解码 METAR/TAF、不调用实时天气，也不从数值推断航班可否起飞。原文包含 Route、Issued、Valid from/until、[DEPARTURE 机场]、[DESTINATION 机场] 和 [ENROUTE]。能见度支持 m/km，风使用 deg/kt、云底 ft、气温 C、气压 hPa；缺失或不合范围值为 null，界面显示“—”，真实零值保留。保存时从原文重新提取，校验 `previous_id` 并保留历史。首次启动为七个站点补充标明模拟的简报；已有编辑不会被种子覆盖。

## 本次完成的收尾

- 保留接手前全部未提交的 v2 开发成果，未回退到旧版四工作区设计。
- 关闭 Case 时停止活动工单并记录事件；所有工单操作拒绝关闭后的请求。
- 接收、回覆和停止工单时同步递增 Case 版本，避免旧窗口继续使用过期 Case。
- v2 发布作废遗留待审草稿，发布记录关联来源事件；取消时作废所有待审项并清除旧公开时间/登机口。
- 登机口回覆变化时失效旧指引；乘客历史显示明确标记。转为可登机时清除已不适用的延误原因。
- 修复批量上传受实时 FileList 影响可能只处理第一份文件的问题。
- 对齐自定义选项数量/唯一性/长度限制与后端；修正弹窗 Escape 对旧 busy 状态的引用。
- 修正列表与详情建议时间不一致、总览三列计数、窄屏长选项/弹窗/历史版本布局。
- 更新 README，补齐此前缺失的验证记录。

## 保留的实现范围

旧版 readiness、内部 schedule、notes、CS 审核和普通关闭 API 仍在，当前前端不提供独立 CS 页。原交接稿“CS 独立审核发布”的设计与接手时 v2 源码“OCC 人工审核发布”存在差异；本次沿用已有 v2 行为并明确记录，未重做产品流程。

中转选择只存在于页面状态，固定问答不接 LLM，航班为合成示例。推广卡片链接真实官网，不宣称实际优惠或合作关系。生产身份、真实航班系统、真实重订/退款、邮件发送、共享部署、持久消息队列和大规模历史分页仍未实现，不属于本次本地演示收尾。

## 常驻乘客预览更新

OCC 总览仅保留 OCC 与外站两项待办统计，移除“本轮已发布”。入口页增加 `/passenger` 固定入口，OCC 航班中的乘客视图直接跳转 `/passenger?case={id}`；页面可选择直达或中转视角，无生成、到期或替换链接步骤。`/api/demo/passenger/cases` 只列基本合成航班标识，预览 GET/SSE 与旧私人链接共享已发布信息白名单。旧 token API 保留兼容，其过期策略不影响固定预览。

## 旅行内容及延误预设

旅行指南为静态双语数据，不向外部服务发送乘客或航班资料。目的地选择仅改变本地指南和第三张交通推广卡；照片以来源页链接呈现，保留原图地址及作者元数据。六类场景与后台原因代码一致，已发布的延误原因也使用同一套说明。无 token 预览支持 `scenario=WEATHER|TECHNICAL|LATE_AIRCRAFT|ATC|CREW|OPERATIONAL`；选择预设时克隆公开状态并替换显示原因及示例时间，标注为未发布演示，通知区显示固定示例，不伪造发布历史。清空场景即恢复已发布数据，旧 token 页面保持仅展示实际公开状态。

## Integrated daily operations and passenger notifications

`backend/extended_ops.py` owns the independent ground-task, staff-message/receipt, operations-handover, notice-draft and dispatch tables. `case_detail` assembles them as an internal workspace. The new `care` role shares its station's read scope but has no task, boarding, work-order or operational edit permissions. Existing authorisation APIs remain the authority for flight status/time/gate/terminal. Independent task completion cannot authorise a flight.

A lifespan-managed worker calls `run_due` every two seconds. Each due batch and recall check runs inside `BEGIN IMMEDIATE`; publication, audit records and the local dispatch status commit together. A second worker sees the committed SENT state instead of producing a duplicate local publication. Jobs persist in SQLite across restarts. Publishing pause prevents delivery; cancellation cancels queued jobs and clears recall. Scheduled content uses current public fields, and boarding time remains hidden until it matches the latest OCC-authorised departure. No external email request exists.

`backend/demo_scenarios.py` adds idempotent scenario loading, published-only onward-network reads and explicit reset/backup/restore controls. `scenario_key` is unique, so repeated loading retains user edits. Backup filenames are generated locally and validated on restore. This is a demo-wide data operation, not a production tenant migration or recovery service.

`CaseWorkspace.jsx`, `OpsExtras.jsx`, `PassengerJourney.jsx` and `ThematicGuide.jsx` provide the new UI. Workspaces are lazily loaded by role, so passenger content does not require loading employee forms. `draftGuard.js` preserves in-progress employee forms when refreshed data changes and supports navigation/beforeunload warnings. API versions and idempotency still enforce consistency when browser convenience guards are bypassed.
