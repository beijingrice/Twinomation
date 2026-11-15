# Verification

Reviewed on 15 November 2026 (HKT). Existing uncommitted v2 work was preserved. Browser checks used a separate synthetic database under `/private/tmp`, not the user's running demo database.

## Automated checks

```bash
.venv/bin/python -m pytest backend/tests -q
npm run build
git diff --check
```

- API suite: **37 passed**. Covers identity/role/station restrictions; passenger isolation and token lifetime/revocation; legacy publication, idempotency and parallel publication; publishing pause; stale guidance; case closure; work-order receipt/reply/reissue/stop/authorisation/cancellation; file scope/type/size; direct and connecting links.
- New regression cases cover closing a case with SENT, RECEIVED and RESPONDED work orders; rejecting subsequent work-order actions; retiring legacy drafts on authorisation; repeat authorisation; publication source linkage; gate invalidation while publishing is paused; clearing an obsolete delay cause on boarding; and clearing gate/time/drafts on cancellation.
- Production Vite build: passed.
- One dependency warning remains: Starlette's test client warns that its `httpx` integration is deprecated in favour of `httpx2`. Tests pass with the existing pinned dependencies; no dependency upgrade was introduced for this review.

## Browser checks

Against the built frontend and single-process backend:

| Check | Observed result |
|---|---|
| OCC at 1440 × 1000 | Overview, station navigation, flight details, reply cards and files render correctly |
| TW218 authorisation | Publishing paused initially; Resume keeps the dialog open; selecting Weather and explicitly authorising publishes Delayed, 12:30 HKT, Gate 18 |
| Passenger page | Published fields and history appear; 390 px and 320 px document widths match the viewport with no horizontal overflow |
| KIX TW602 at 320 px | Receive succeeds; all five resources answered; Gate 7 and custom Wheelchair assistance / Arranged submitted |
| Cross-workspace reply | OCC shows Gate 7, custom assistance and station reply status |
| Batch upload | Two synthetic text files selected together; both appear in station and OCC file lists; UI reports “2 files shared” |
| Download | OCC downloads the station's gate-plan file; decoded content matches the original synthetic fixture exactly |
| Browser logs | No warning/error entries in the inspected OCC and station tabs |

Evidence: `artifacts/occ-review-complete.jpg` shows the final TW602 reply and both shared files. Previously existing screenshots remain as prior-round artifacts and are not evidence of this review.

## Limits of verification

This is local demo verification, not a production security assessment. No real airline system, personal data, email service, public hosting or booking operation was exercised. Sound hardware output, every browser/OS combination, long-running SSE recovery and a full simulated multi-user load test were not verified. Version/status safeguards were tested; v2 does not implement general idempotent response replay. File bytes are scoped and bounded per file, but malware scanning, global disk quotas and crash recovery for orphaned files are not implemented.

## Chinese / English support review

- `npm test`: **4 passed**, covering browser-language defaults/overrides, safe interpolation, switching back to English, preserving custom labels/answers and free-form notes, generated audit copy and localisable errors.
- Backend suite after the language change: **41 passed**. Added checks for Chinese display text on reviewed v2 delay/boarding/cancellation templates and no translation of arbitrary CS publications. Original published text is preserved.
- `npm run build` and `git diff --check`: passed.
- Browser: index switches between English and Chinese; navigation preserves the choice. A new-case dialog retained `TW1234` and `双语测试备注 — keep original` when switched to English without submitting.
- Browser: Chinese OCC review/resume/publish succeeded on an isolated test database; the passenger page showed the approved update in Chinese and restored the original English text when switched back. Fixed Q&A and its existing conversation also changed languages.
- Browser: Chinese KIX receive and all five resource answers submitted successfully; a mixed-language gate note remained unchanged. Passenger and station pages had 320 px document width at a 320 px viewport.
- Simplified Chinese is supplied. Free-form notes, custom labels/options, filenames and unrecognised historical publication text remain in their original language. No external translation service is used.

## Work-order status clarity review

- `npm test`: **8 passed**. New workflow checks ensure OCC/station responsibility is explicit and identical across viewers, custom items remain flagged for manual review, publication does not imply flight cancellation, and English status labels describe pending responsibility.
- `npm run build` and `git diff --check`: passed. No backend workflow transitions were changed.
- Browser: KIX list shows “待 OCC 审核” and “已审核发布”, with “工单 · 第 1 版” separately. The next-action column names OCC or the specific station; published rows explain the passenger-facing result. Detail widgets use the same status terminology.
- Chinese and English lists retain status/version at 320 px without horizontal overflow. Inspected browser logs contain no warning/error entries.
- Evidence: `artifacts/work-order-status-clarity.jpg`.

## Always-available passenger preview

- Backend: **45 passed**. New checks cover token-free read-only previews, catalog field limits, unpublished-data isolation, the same URL before/after publication and application restart, independent connecting views, unchanged legacy link expiry/revocation and preview SSE connection limits.
- Frontend: **10 passed**. Added stable URL construction and restoring flight/view choices from query parameters. Production build and whitespace checks passed.
- Browser: OCC overview has only OCC/Outstation pending counts. The flight's Passenger view is a direct `/passenger?case=2` link with no generation modal. An unpublished flight shows the neutral waiting view.
- Browser: the homepage passenger tile opens `/passenger` immediately. Flight and onward-destination selection updates the fixed URL; reload and Back restore selections. Published content is visible at the same preview, and a 320 px viewport has no document overflow.
- The existing demo database was preserved when restarting the service. The new preview endpoints do not write passengers or audit events.
- Evidence: `artifacts/passenger-always-available.jpg`.

## Passenger travel guide, delay scenarios and promotions

- Backend: **45 passed**; frontend: **17 passed**; production build and `git diff --check`: passed. Backend APIs and running demo data were not changed for this feature.
- Guide import: rerunning the importer against the supplied Markdown generated byte-identical JSON. Checks cover 35 cities, 36 unique airports, 8 markets, complete bilingual fields and all supplied attractions, photo source metadata, exact IATA matching and seasonal flags.
- Scenario tests: all six bilingual explanations/FAQ, immutable preview overlays, scheduled-time offsets, bookmark restoration, unknown/prototype-name rejection and HKT notification examples. Preview is labelled as unpublished and does not invoke write APIs.
- Browser on the existing local demo (read-only): all six scenario titles/times/URLs changed correctly; clearing the scenario restored TW218's actual published 12:30 HKT history. Reload restored TECHNICAL; Back restored the previous scenario and closed the FAQ panel.
- Browser: Chinese technical FAQ and its already-added question/answer switched to English. Taiwan showed the Taiwan High Speed Rail card; Malaysia showed SZB/its distinction from KUL and Airport Express; Ishigaki showed ISG and a seasonal badge.
- Responsive: Chinese at 390 px and Chinese/English at 320 px had document width equal to the viewport; inspected local browser logs contained no warning/error entries. Temporary viewport overrides were reset.
- External links: clicking HK Express and MTR cards opened new tabs at the configured official HTTPS URLs. The MTR High Speed Rail Ticket Purchase page loaded normally. HK Express returned its own Access Denied page in this automated browser, despite its offers content being available to the web-research tool; access restrictions were not bypassed. Other official operator destinations were verified through web research, not actual booking.
- The synthetic fare/discount/hotel offers were replaced by official outbound promotional examples. No purchase, booking or commercial partnership was claimed. Photo source/attribution links were retained; original images are not embedded.
- Evidence: `artifacts/passenger-travel-guide.jpg`, `artifacts/passenger-promotions.jpg`, `artifacts/passenger-delay-scenario.jpg`.

## Development graph / guidance alignment and read-only connections

- `npm test`: **22 passed**. New coverage includes the 120-minute boundary, pending-time guidance, minimum connection time, cancellation/elapsed-departure handling, revised onward estimates, immutability, official departure-airport coverage and directing unready work orders to reissue.
- Backend: **51 passed**. New checks reject authorisation for Pending/Unavailable resources for both delay and boarding; ensure failed authorisation has no event/version/publication side effects; require/audit OCC custom-resource confirmation; allow a delayed flight with unknown time; and reject boarding without a departure time.
- Production build and `git diff --check`: passed. The existing Starlette/httpx deprecation warning remains; no dependency change was made.
- Browser mutation checks used the isolated `/private/tmp/twinomation-guidance-audit-20261115.sqlite3` through Vite at 5173 and a backend at 8001. Direct staff POSTs at 8001 were correctly rejected by the existing origin restriction; the normal permitted Vite origin was used without changing the allowlist.
- Browser workflow: TW310's unready v1 had a disabled publish tile and explicit reissue guidance. Reissuing made v2; NRT received it, selected five Ready answers, set Gate 42, answered the existing custom item and added `轮椅协助` with custom choices `已安排, 待安排`. OCC received both custom answers. Publication remained disabled until explicit custom readiness confirmation; after publication, the passenger view received the new cause/time/gate.
- Browser unknown-time flow: OCC published a WEATHER delay for TW218 with departure unconfirmed. The passenger headline showed `时间待定`, every prospective connection showed `待确认`, and KIX airport information appeared; no arrival estimate or viable connection was invented.
- Browser guidance: WEATHER +90 preview showed guide/airline promotions and no airport cards; the 220-minute published delay showed NRT dining/shopping cards and no airline ads. Detailed explanation opens directly from the short reason card.
- Responsive checks: OCC at 1440 px had document width 1440; outstation at 1440 px and in fresh 320 px Chinese/English views had no horizontal overflow. The resource reply form was exercised at 390 px. Passenger views at 390 and 320 px (Chinese/English) had matching document/viewport widths. Fixed mobile time wrapping: each departure is a single line. Viewport overrides were reset.
- Actual port-8000 built demo: connection list had **zero buttons**, three unavailable rows and four viable rows in the tested preview. Real-demo console had no warning/error entries in the inspected tab. Flight feasibility is clock-driven over a synthetic timetable; it is not a real airline status feed.
- The primary demo was restarted to load the backend rules. Database counts and every existing work-order ID/status/version were compared before/after and were unchanged. Test servers/tabs were stopped after QA; the primary demo remains running on 8000.
- Evidence: `artifacts/guidance-occ-resource-gate.jpg`, `artifacts/guidance-outstation-mobile.jpg`, `artifacts/guidance-airport-desktop.jpg`, `artifacts/guidance-connections-readonly.jpg`. Requirement mapping and logical data-flow graph: `docs/development-guidance-audit.md`.

## Transfer-time traffic-light colours

- Frontend: **23 tests passed**; build and whitespace check passed. Boundary tests cover exactly 30 and 60 minutes, either side of both boundaries, and the clock changing a row from green to amber to red after arrival.
- Available time is onward departure minus the later of estimated arrival and now. ≤30 minutes is red, >30 and <60 amber, ≥60 green. Unknown arrival remains neutral; cancelled/departed states take precedence. Minimum-connection feasibility remains separate from the colour warning.
- Row backgrounds, departure times and badges share the same tone; the list displays approximate available minutes and a colour key, and retains no selection buttons.
- Browser: OPERATIONAL preview shows TW816 with 35 minutes in amber, later flights in green and missed connections in red. Chinese at 390 px and English at 320 px had no horizontal overflow; English badges wrap without clipping. The viewport override and Chinese language were restored after checking.
- Evidence: `artifacts/connection-time-colours.jpg`.

## Warmer passenger assistant

- Frontend: **25 tests passed**; production build and whitespace checks passed. New coverage verifies bilingual concern prompts for every cause, next-step grounding, no invented connection for direct passengers, and distinct replies for tight, viable, cancelled and unknown-arrival connections.
- Rewrote all six reason-specific FAQ pairs and the meal/refund replies in Chinese/English: acknowledge the concern, explain confirmed information and offer a practical next step. Each cause has a tailored welcome. No new airline promise, automatic compensation, diagnosis, booking action or external AI service was added.
- Assistant shows flight number, route and estimated/pending departure, with an explicit published/scenario label. Two concern prompts precede the FAQ; connecting passengers get a reply matched to their actual visible booked connection.
- Browser: the technical-check greeting and anxious-wait response were displayed. A connecting passenger's reply named TW809 and explained that current connection time was tight without claiming rebooking. Switching Chinese/English preserved the question/answer and scrolled to the latest reply.
- The 320 px Chinese/English dialog stayed within the viewport without horizontal overflow; controls remained visible. Chinese and viewport settings were restored, the temporary test tab was closed, and the user's original passenger page was refreshed with the updated assistant open. No warning/error entries appeared in the inspected original tab.
- Evidence: `artifacts/passenger-gentle-assistant.jpg`. Backend and existing demo work orders were unchanged.

## Outstation timeline notice editor

- Backend: **58 passed**; frontend: **28 passed**; build/whitespace checks passed. Added notice publication/isolation, role/station restrictions, pause, stale case versions, idempotent replay/conflict, bilingual and single-language fallback, validation, post-cancellation notices and a legacy-database column migration check. Template tests ensure no internal notes, proposed times or unapproved gates enter defaults.
- Browser writes used only `/private/tmp/twinomation-notice-qa-20261115.sqlite3`, served through the normal Vite origin at 5173 with its isolated backend at 8001. No test notice was published to the existing demo database.
- KIX timeline: each event offered Edit passenger notice. Applied Meals/assistance, manually edited both languages, switched UI language without losing the draft, and previewed it. Publishing remained disabled while OCC paused publication.
- After OCC resumed, KIX explicitly published the notice. An already-open passenger page received both language versions through refresh/SSE without navigation or manual reload; its AWAITING flight state remained unchanged. The original event remained and both it and the new audit row showed the published-notice badge and further-edit action.
- Further editing restored the exact published copy. Applied another template, previewed, returned to editing and confirmed content remained intact. Fixed the Back button's reused-submit activation by preventing its default action; returning and previewing again now works.
- Layout: desktop 1440 px editor uses two language columns. Chinese at 390 px and English at 320 px use one column with a scrollable dialog, no horizontal overflow and usable preview/publish controls. UI-language and viewport settings were restored; temporary test tabs/servers were stopped after checking.
- Actual demo: new column migrated successfully; original Case versions/public fields, work-order IDs/status/versions, event/file counts and publication IDs/status/text were compared before/after and remained unchanged. The actual outstation editor was opened without submitting a notice; inspected console contained no warning/error entries.
- Evidence: `artifacts/outport-notice-editor.jpg`, `artifacts/outport-notice-preview.jpg`, `artifacts/outport-notice-mobile.jpg`.

## Regional broadcasts and simulated route weather

- Backend: **66 passed**; frontend: **30 passed**; production build and whitespace checks passed. New tests cover all/region/station audiences, actual recipient snapshots, station-scoped list/detail/acknowledgement, repeat acknowledgements, role/auth restrictions, replay/conflict, invalid audiences and passenger isolation.
- Weather tests cover seven explicit demo sources, seed preservation across restart, visibility m/km/zero, negative temperature, missing/out-of-range values, invalid timestamps/validity, route mismatch, preview without saving, own-station permissions, server-side re-extraction, stale saves, idempotent retries and retained source history. Samples are not live weather or METAR/TAF decoding.
- Browser writes used `/private/tmp/twinomation-station-services-qa-20261115.sqlite3`, via Vite 5173 and an isolated backend on 8001. OCC previewed and sent an important Japan-region broadcast. KIX received its pending banner; ICN's broadcast centre remained empty. KIX explicitly acknowledged it; the open OCC tab updated to **1 / 2** with KIX acknowledged and NRT pending. Passenger publishing was paused throughout this internal workflow.
- KIX weather initially displayed departure visibility **3.5 km**, HKG **10 km**, wind **80° / 12 kt**, gust **20 kt**, cloud base **1200 ft**, temperature/QNH and enroute details. Editing the source to **800 m**, extracting and saving updated both station and OCC views. OCC could switch to ICN's separate briefing.
- Responsive browser checks: the Chinese weather card at 390 px used two metric columns; the English editor and broadcast inbox at 320 px stayed within the document width with usable controls. UI language and viewport overrides were restored. No warning/error entries appeared in the inspected QA tabs.
- The actual built port-8000 demo was checked separately: All outstations lists seven recipients, Selected outstations can preview only ICN, and Back returns to the draft without sending. No test broadcast or edited weather was saved to the original database. The actual weather page displays its seeded 3.5 km sample on desktop/mobile.
- Restart comparison preserved all original rows in `cases` (9), `work_orders` (8), `case_events` (45), `passenger_updates` (11) and `passengers` (2). Startup added seven simulated weather records and empty broadcast tables. The old server's lingering SSE connections were closed; the current server runs with the normal loopback-only, no-access-log and bounded-shutdown flags. QA tabs/services were stopped; the primary demo stays on 8000.
- Evidence: `artifacts/occ-regional-broadcast.jpg` (isolated QA message and receipt), `artifacts/outstation-weather-desktop.jpg`, `artifacts/outstation-weather-mobile.jpg` (actual demo).

## Friend feature integration · 2026-11-15

- Final automated regression: **80 backend tests and 33 frontend tests passed**. Production build succeeded with role-based code splitting (largest JS bundle about285 KB, below Vite's default warning boundary). Existing tests were updated only for intentional public origin/terminal and expanded station/airport coverage.
- New backend coverage: Customer Care permissions and station scope; independent task versions; messages/receipts/replays; reply acknowledgement; persistent draft conflict/publication; immediate and scheduled notices; publishing pause; restart persistence; cancellation; no private email/internal handover leakage; approved-only boarding; automatic/manual recall; stage gates; concurrent scheduler delivery exactly once locally; 30-scenario import preserving existing rows; typed reset confirmation, backup and exact restore; outbound routes, normal-status authorisation and private-link onward network.
- New frontend coverage: explicit HKT controls across UTC midnight/month/leap day; overnight transfer, zero/negative margin and invalid inputs; unknown onward departure remains neutral; normal-status templates use only approved facts. Original30/60-minute boundary and clock tests remain green.
- Browser write verification used only `/private/tmp/twinomation-friend-integration-qa.sqlite3`, backend8001 through frontend5173. Loaded30 flights; verified tasks and free messages reaching OCC's inbox; scoped Customer Care's read-only controls; explicit notice drafts surviving reload; bilingual notice preview and locally simulated email history; departure confirmation and test recall; passenger modal/banner and the published-only nine-flight HKG outbound network. The original in-app browser was blocked by an old native test confirmation; verification continued in Chrome after replacing recall confirmation with an accessible in-app modal.
- Browser responsive checks: Chinese390 px Customer Care and English320 px manager boarding/time/notification forms and passenger thematic transport guide stayed within viewport width. The passenger list contains no selection/booking buttons and shows cross-day dates. Viewport overrides were reset. Evidence: `artifacts/integration-passenger-recall.jpg`, `artifacts/integration-station-mobile.jpg`, `artifacts/integration-boarding-mobile.jpg`, `artifacts/integration-passenger-mobile.jpg`.
- Original database startup comparison against `/private/tmp/twinomation-before-friend-integration.sqlite3`: all original columns/rows preserved in cases9, work_orders8, case_events45, passenger_updates11, passengers2, case_files1, idempotency_keys1, settings1 and seven prior weather briefings. Added4 station weather samples,9 empty operations workspaces and36 default independent ground tasks. No demo reset, test publication or optional30-flight load was performed on the original database.
- Primary demo remains loopback8000 with bounded shutdown and access logs off. Email, weather, timetable, recall tests and scenario fixtures remain local simulations; no real passenger or third-party notification was sent.

## Named passenger delay demonstrations and optional text

- Backend **82 passed**, frontend **33 passed**, production build passed. New regression checks cover exact45/180-minute published delays, bilingual history, no duplicate seed on restart, unchanged friend-scenario counter, optional Chinese flight labels/generated names, blank stop reasons/tasks/messages/notices/dispatches/broadcasts, and default weather-source persistence with idempotent replay.
- Original database backed up to `/private/tmp/twinomation-before-passenger-delay-demo.sqlite3`. Existing10 cases,11 work orders,71 events,15 updates, attachments and passenger links were preserved field-for-field. Startup appended only the two requested cases with authorised demo work orders and notices. On this database their URLs are `/passenger?case=11` and `/passenger?case=12`.
- Browser verified short45-minute weather content with one visible promotion widget/no airport widget; long180-minute aircraft-check content with one airport-service widget/no promotion widget. Long-delay destination content is expandable without promotional banners. The actual OCC creation dialog showed blank flight/description fields with `required=false`; date/time remained structured inputs. No test flight or message was submitted to the original database during browser checks. Inspected long-delay console had no warnings/errors.
- Evidence: `artifacts/passenger-short-delay-demo.jpg`, `artifacts/passenger-long-delay-demo.jpg`. Both passenger tabs remain available; primary demo continues on8000.
