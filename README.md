# Twinomation

A local airline disruption coordination demo: React 19 + Vite, FastAPI and SQLite.

Current implementation: [workspace-index](https://github.com/beijingrice/Twinomation/tree/workspace-index).

The index, OCC, outstation and passenger pages support **中文 / EN**. The initial choice follows the browser language; the switch in each page header (and inside dialogs) persists the choice across reloads and synchronises other tabs on the same origin. Switching does not reset form inputs or change API status values. Preset labels, actions, dates, system events and canned passenger Q&A are localised. User-authored notes, custom items/options and filenames retain their original text. Recognised server-generated v2 passenger publications include an optional `text_zh` display field; their original English history is preserved. Arbitrary CS publications are not automatically translated.

Work-order badges describe the current workflow stage (awaiting station receipt, awaiting station reply, awaiting OCC review, or approved and published). The work-order version appears separately. Next-action text names OCC or the specific station rather than using “You”; resource readiness and custom items requiring manual review appear below it. Mobile flight lists retain the status and version.

**Current v2 flow:** OCC sends a versioned work order → the outstation receives it and replies → OCC reviews the reply and explicitly authorises publication → the passenger page refreshes. Reissuing, stopping a work order and cancelling a flight are separate actions.

Outstation managers can also publish **passenger notices** from a flight's History events: **Edit passenger notice → apply a template or edit Chinese/English → Preview notice → Publish to passengers**. Templates cover current public arrangements, waiting reminders, connections and meals/assistance, with a blank custom option. The original event is retained, and the notice appears in passenger history with an audit link. **Edit another notice** brings back the published copy and publishes a new notice when confirmed. This notification flow leaves the work-order/operational state under its existing OCC controls. OCC's publishing pause applies to these notices too.

OCC can send **internal broadcasts** to all 11 outstations, one or more regions, or individually selected stations. Preview lists the actual recipients before sending. Receiving managers see a pending badge/banner and explicitly acknowledge receipt; OCC sees acknowledgements per station. Viewing a message alone does not acknowledge it. These are internal coordination messages, separate from passenger publishing and its pause switch.

Each station also has a **simulated route weather briefing**, visible on its station page and under Route weather. Eleven editable placeholder briefings cover the departure airport, HKG and enroute notes. Cards extract visibility, wind/gusts, cloud base, temperature, humidity, QNH, turbulence, icing, thunderstorms and issue/validity times. **Edit demo briefing → Extract key fields → Save weather summary** preserves the source text and appends a new summary. This is an explicit sample text format, not a METAR/TAF decoder or live weather service; missing/invalid fields show “—”.

## Run

Requires Python 3.11+ and Node.js 20.x (20.19+) or Node.js 22.12+.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm ci
./scripts/run.sh
```

Open [the workspace index](http://127.0.0.1:8000), [OCC](http://127.0.0.1:8000/occ), [KIX outstation](http://127.0.0.1:8000/outport?station=KIX), or [KIX Customer Care](http://127.0.0.1:8000/outport?station=KIX&care=1). The logo returns to the index. The [passenger preview](http://127.0.0.1:8000/passenger) is always available while the local demo is running. Choose a flight and a direct/connecting view there, or use **Passenger view** inside any OCC flight to open its preview directly. Addresses such as `/passenger?case=1` are stable: no link generation, expiry or replacement step is needed.

For hot reload, run `./scripts/dev.sh` and open [Vite](http://127.0.0.1:5173). Vite proxies `/api` to the backend on port 8000. The normal run script builds and serves the frontend on port 8000.

A fresh database contains **10 synthetic flights**: eight original TW work-order examples and two already-published passenger examples named **短延误** and **长延误**. The network has **11 outstations**: KIX, NRT, PVG, PEK, TPE, KHH, ICN, BKK, SYX, PKX and CRK. The four added stations initially have weather samples but no flight cases; the optional 30-flight scenario pack adds flights for them.

Business records and audit logs persist in ignored `data/demo-v2.sqlite3`; attached files live in a `files/` directory beside the selected database. Later starts preserve existing edits and add missing demo examples without duplication. `TWINOMATION_DB` selects another database, for example `TWINOMATION_DB=/tmp/twinomation-rehearsal.sqlite3 ./scripts/run.sh` after stopping the existing server on port 8000. v1's `data/demo.sqlite3` is retained separately.

The eight original TW examples use **15 November 2026**. The two named delay flights and the optional UO pack calculate dates/times when first added; their saved schedules do not move forward on later starts. Audit timestamps are actual times. Schedule inputs and passenger times use HKT; the OCC handover also labels estimated arrival in the destination's local timezone.

## Demo walkthrough

These steps describe the original seed state. If a flight has already been handled, create a new case or use a separate rehearsal database; restarting does not reset its work order.

1. Open **OCC → Japan → Osaka → TW602**, and open KIX in another tab or on a narrow window. TW602 starts with a sent work order.
2. At KIX, open TW602 and **Receive work order v1**. Answer each requested item, add gate/counter notes and optionally add a custom item with 2–6 choices. Select **Send to OCC**.
3. Share one or more files through **Add Word, PDF…** or drag and drop. Both employee workspaces can download them. Each file must be 1 byte–5 MB; supported extensions are PDF, Office documents, TXT/CSV and PNG/JPEG. Files remain internal.
4. OCC sees the reply, custom answers and files. All preset resources must be Ready before **Authorise & publish** becomes available; otherwise reissue the work order. Review custom answers and confirm they meet requirements. Choose the departure, gate and status, and choose a cause for a delay. A delay can have an unconfirmed departure time; boarding requires a time. Publishing starts paused on a fresh database; use **Resume** inside the dialog or the header control.
5. Confirm publication. The already-open passenger preview receives the approved status, time, gate and cause at the same address. Internal work-order notes, answers and files are excluded.
6. Alternatively, **Reissue as v2** sends a new work order, retaining the previous answers for reference and requiring fresh answers. **Stop v1** stops coordination without cancelling the flight. **Cancel flight** explicitly publishes a cancellation and closes the case.
7. Use **New flight case** for a clean scenario, then create a work order. The operator-information check is required before sending.

Other seeded scenarios: TW218 is ready for OCC review; TW310 has resource gaps and a custom item; TW126 has a replaced v1 and received v2; TW730 includes special assistance; TW808 and TW512 have no work order yet.

## Current capabilities

- **OCC:** region/station navigation, flight search/filter/sort, delay metrics, weather overview, case creation, resource requests, reply review, authorisation, reissue, stop, cancellation, internal handover presets and publishing pause. Broadcasts can target all stations, regions or a selected combination.
- **Outstation manager:** server-enforced station scope, work-order receipt and preset/custom replies, shared files, independent five-state ground tasks, free collaboration messages, progress notes and receipts. Passenger care includes bilingual notice drafts/templates, immediate or scheduled notifications, simulated email records, and authorised boarding reminders. Optional new-work-order sound requires a browser user gesture.
- **Customer Care:** a separate station-scoped identity available from the index or the outstation workspace selector. Ground tasks and boarding controls are read-only; staff can save and publish passenger notices and dispatches. This is distinct from the legacy `cs` review API.
- **Passenger:** always-available previews with flight/view selection, approved updates, a brief reason and bilingual FAQ, published history, five-stage journey progress/recall, cancellation-assistance links, a 35-city guide, four-airport thematic map guides, read-only onward flights and a manual transfer calculator. Short delays show destination/airline/rail promotions; delays of 120 minutes or more prioritise departure-airport dining/shopping directories. Unknown times show waiting information without an invented arrival forecast. Connection rows update with time and have no select/book/change actions. The scenario selector is an explicitly labelled local overlay; it does not publish or change OCC data.
- **Consistency and logs:** SQLite transactions, version conflicts, scoped idempotency where implemented, and persisted work-order/event history. One active work order is allowed per flight. Independent ground-task completion does not replace a formal resource reply. Changed gate answers invalidate old public location guidance and require OCC authorisation. Cancellation closes the case, stops active work orders, clears public gate/terminal/departure and recall, and cancels queued notifications. Unsaved-form guards retain employee input when remote changes arrive.
- **Refresh:** scoped SSE signals plus GET on connection, reconnect, return to the foreground and every 30 seconds.

An amber left edge on a flight row means the **current workspace owns the next action**. A **New update** badge separately indicates an unacknowledged incoming message or a collaboration message within the last five minutes. Work-order badges, flight status and these attention indicators have different meanings.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the source map and state flow, and [VERIFICATION.md](VERIFICATION.md) for actual checks.

## Passenger travel content and scenarios

Open [a technical-delay example](http://127.0.0.1:8000/passenger?case=1&scenario=TECHNICAL). The scenario selector includes weather, aircraft technical checks, late inbound aircraft, air traffic control, crew arrangements and ground/operational arrangements. Each has a fixed bilingual explanation, next steps, passenger advice, FAQ and example notification. Switch back to **Use published flight updates** to see the actual approved state/history. The preview reason is kept in the URL across reloads and history navigation; its sample departure is scheduled time plus the preset delay, not a forecast.

The travel guide covers the supplied 35 cities / 36 airports across 8 countries and regions. Country/city selectors expose descriptions, all supplied attractions, food, suggested stays, airport tips and photo source/attribution links; Chinese and English switch together. The initial city uses an exact airport match from the selected flight when available. Short-delay promotions link to official HK Express offers, Hong Kong cross-border high-speed rail ticketing information, and contextual Japan/Taiwan rail or Airport Express information. They contain no invented discount, price or availability. Long-delay and unknown-time views prioritise official dining/shopping directories for the departure airport; their destination guide remains available in an expandable section.

Connecting flights are a synthetic timetable, not a live airline feed. A 15-second clock recomputes departure/transfer feasibility; the existing 30-second refresh and SSE update published data. Available transfer time is measured from the later of estimated arrival and the current time: ≤30 minutes is red, >30 and <60 is amber, and ≥60 is green. Unknown times stay neutral. No selection, booking or rebooking is performed. See the [development graph and guidance audit](docs/development-guidance-audit.md) for the requirement-by-requirement review and remaining real-service boundaries.

The assistant uses a warmer bilingual greeting and replies that acknowledge worry before explaining known facts and practical next steps. Concern buttons include an anxious wait and, for connecting passengers, a connection worry matched to the current arrival/connection information. Its flight-context card distinguishes published updates from scenario previews; it does not infer emotions or call an external LLM.

See [content sources and maintenance](docs/passenger-content-sources.md) for provenance, official URLs and the import command. Destination/rail availability must still be checked with each operator; these cards are promotional examples, not evidence of a commercial partnership.

## API and v1 compatibility

[API reference](http://127.0.0.1:8000/api/docs) is self-contained; [OpenAPI](http://127.0.0.1:8000/api/openapi.json) defines exact request shapes. Staff requests require a simulated server-issued bearer session. Writes also require `X-Twinomation-Client: local-demo`, a cross-origin request barrier rather than authentication.

The local preview endpoints are `GET /api/demo/passenger/cases` (basic flight identifiers only), `GET /api/demo/passenger/{case_id}` (optional `connection=LHR`, `SYD`, `SIN`, `BKK` or `YVR`) and its `/stream` endpoint. They are read-only, share the published-only passenger model, and never create or revoke credentials.

The v2 endpoints cover `/api/cases/{id}/work-orders`, `/api/work-orders/{id}/{receive,respond,authorize,reissue,abort}`, `/api/cases/{id}/cancel-flight`, `/api/cases/{id}/files` and `/api/files/{id}`. Mutations use the relevant case or work-order version where defined. Case creation, legacy CS publication, passenger notices, broadcasts, weather saves, messages, new ground tasks and notification dispatches use scoped idempotency keys; v2 work-order actions use status/version checks, not a general retry cache.

Broadcast endpoints: `GET/POST /api/broadcasts`, `GET /api/broadcasts/{id}` and `POST /api/broadcasts/{id}/acknowledge`. Only OCC can send; managers and Customer Care can list/read/acknowledge their own station's broadcasts. POST creation requires an `Idempotency-Key` and a valid `scope`; `title`, `body`, `targets` and `priority` have defaults. Scopes are `all` (empty targets), `regions` (`JP`, `CN`, `TW`, `KR`, `TH`, `PH`) and `stations` (station codes).

Weather endpoints are under `/api/stations/{station}/weather-briefings`: `GET /latest`, `GET /sample`, `POST /parse` for a read-only preview and `POST` at the base path to save. OCC can access every station; managers can edit only their own, and Customer Care has read access to its own station. Saving uses the latest `previous_id` and an `Idempotency-Key`. `source_name` and `raw_text` are optional; blank input uses a clearly labelled demo briefing. It reparses the raw source on the server, rejects stale edits and retains earlier records. New tables and missing station samples are added at startup without replacing existing flights or publications. Both services emit scoped staff refresh signals and stay out of the passenger model.

Outstation notices use `POST /api/cases/{case_id}/events/{event_id}/passenger-notices` with a case `version`, optional `text_zh` / `text_en`, a template identifier and an `Idempotency-Key`. Managers and Customer Care can publish for their own station; the pause and case version are checked. If both texts are blank, the editor previews the current flight-arrangement template; direct API calls use a generic bilingual waiting notice. Stored Chinese copy comes from the reviewed text or template; a missing language falls back to the supplied original, with no automatic translation. Internal event text, proposed times and unapproved gates are not automatically copied into templates.

Additional current API groups include:

- `/api/inbox` and `/api/inbox/{id}/acknowledge` for incoming message receipts.
- `/api/cases/{id}/{messages,tasks,operations,boarding,recall,notice-draft,dispatches}` for the internal flight workspace; methods, versions and role restrictions are defined in OpenAPI.
- `/api/demo/scenarios`, `/api/demo/scenarios/load`, `/api/demo/reset` and `/api/demo/restore/{backup_id}` for OCC rehearsal controls.
- `/api/demo/network-connections/{case_id}` and `/api/passenger/{token}/network-connections` for published-only onward flight lists.

The v1 readiness, schedule, notes, close and CS draft-review APIs remain for compatibility and regression testing. There is **no standalone legacy `cs` review workspace**; `/review` shows the index. The current **Customer Care** workspace uses the separate `care` role at `/outport?station=KIX&care=1`; it is not the old draft-review queue. In v2, OCC's explicit **Authorise & publish** is the human review. This differs from the original four-workspace baseline in `Twinomation_Handoff.md`. Publishing a v2 update supersedes pending legacy drafts on that case to prevent old instructions being published afterward. Avoid mixing v1 and v2 workflows during a demo.

## Local demo boundaries

The server accepts only local loopback clients. Roles and stations simulate identity; there is no production login. Do not expose this demo through a public bind, tunnel, reverse proxy or LAN. No real airline, booking, passenger, email or AI service is connected. `send_email=true` is rejected by the legacy publication API; v2 publication updates only the local passenger page.

Employee tabs keep independent bearer sessions in `sessionStorage`. Sessions last eight hours and are lost on server restart. The current local passenger preview needs no session or token, exposes only the published passenger read model and basic synthetic flight identifiers, and keeps the same URL across server restarts. It does not expose employee notes, pending updates or files. Legacy private-token APIs and their eight-hour expiry/revocation rules remain for compatibility; the frontend no longer issues these links. Server access logs remain disabled.

Publishing pause blocks new passenger publication, including cancellation, direct notices, journey-stage changes and recall. Internal coordination and safe invalidation of old guidance continue. Future notifications can be queued while paused and wait for publication to resume. Existing published history is not retracted.

A server worker checks scheduled notifications and automatic boarding recall every two seconds. Delivery requires the server to be running; persisted due notifications are processed when it starts again and publishing is enabled. Recall requires an open flight, the latest authorised work order and a matching OCC-approved departure. The worker does not independently approve operational changes. Email is a local simulation record; no external delivery, actual rebooking or guaranteed passenger alert is provided. Templates and Q&A are fixed presets; historical cases are not automatically summarised or turned into reusable resolutions.

SQLite, sessions and SSE use one local process. At most four SSE streams per loopback client are allowed; extra tabs fall back to polling and retry live mode. No durable event replay, high availability or production performance claim is made. Lists/history are bounded (100 cases, 200 updates/events and 100 files per detail response). Files have a per-file limit, not a total storage quota or malware scanning. No real personal data should be imported.

## Verification

```bash
.venv/bin/python -m pytest backend/tests -q
npm test
npm run build
```

The latest recorded verification passed **82 backend tests, 33 frontend tests and the production build**. Checks include work-order safeguards, named delay seeds, optional text/defaults, Customer Care permissions, messaging/receipts, saved drafts, scheduling/recall gates, concurrent local delivery, reset/restore, broadcasts, weather extraction, bilingual content and connection guidance. Browser evidence and earlier file-transfer checks are recorded in [VERIFICATION.md](VERIFICATION.md).

## Friend implementation integration

OCC → **Demo scenarios** can load **30 additional synthetic UO flights**, in both directions, without changing existing cases. Repeated loading does not duplicate them or overwrite edits. A fresh database with this pack has 40 flights; an existing database may contain additional user-created cases.

**Back up and reset demo** requires typing `RESET DEMO`. It backs up the SQLite database under `demo-backups/` beside the database, then replaces the demo records with the default 10 flights plus the 30-flight pack. **Restore selected backup** requires typing `RESTORE DEMO` and replaces the current database state with the selected snapshot. Uploaded files remain on disk. These are global local-demo operations: use them when nobody else is editing. To preserve attachments when copying a demo to another location, retain both the database and its adjacent `files/` directory.

Each flight now has **Tasks & messages**, **Passenger care**, and an OCC-only **OCC handover** tab. Independent five-state ground tasks and messages support daily handover; formal work-order resource replies still require OCC review. Customer Care is a scoped, separate demo identity with read-only task/boarding controls and passenger notice/dispatch permissions. Messages and broadcasts share an inbox, receipts and overdue warnings.

Passenger care supports saved bilingual notice drafts, immediate/scheduled notices, **locally simulated email**, and boarding reminders 30 minutes before confirmed departure. Reminders require the matching OCC-authorised departure. The passenger page adds five-stage progress, recall dialogs, cancellation assistance, a published-only HKG onward network, a manual transfer calculator and four-airport thematic maps/transport guides. Existing 30/60-minute colours remain unchanged.

See [feature integration and boundaries](docs/friend-feature-integration.md). All new business records live in SQLite, including scheduled dispatches. A two-second server worker delivers due jobs while the local demo is running; there is no real email, airline, weather or booking integration.

## Short / long passenger delay demo

Open the [passenger preview](http://127.0.0.1:8000/passenger) and select **短延误** (45-minute weather delay) or **长延误** (180-minute aircraft-check delay). Case IDs depend on the existing database, so use the flight names to find these examples. Both are pre-approved synthetic flights with bilingual announcements. Short delays show destination/airline/rail promotions; long delays show airport dining/shopping first, with destination content expandable and promotional banners hidden. Selecting another flight clears a previous local scenario overlay.

Free-text fields are optional in this demo. Blank descriptions/reissue/stop notes are accepted; empty flight names get a generated `DEMO…` label; empty custom tasks/items get a default name; blank notices use a reviewed-flight template or a generic waiting message; blank simulated email recipients use `demo@example.test`; blank weather text loads an explicit demo sample. Dates, times, structured selections, maximum lengths, publication pause and resource authorisation remain enforced.
