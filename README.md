# Twinomation

A local airline disruption coordination demo: React + Vite, FastAPI and SQLite.

The index, OCC, outstation and passenger pages support **中文 / EN**. The initial choice follows the browser language; the switch in each page header (and inside dialogs) persists the choice across reloads and synchronises other tabs on the same origin. Switching does not reset form inputs or change API status values. Preset labels, actions, dates, system events and canned passenger Q&A are localised. User-authored notes, custom items/options and filenames retain their original text. Recognised server-generated v2 passenger publications include an optional `text_zh` display field; their original English history is preserved. Arbitrary CS publications are not automatically translated.

Work-order badges describe the current workflow stage (awaiting station receipt, awaiting station reply, awaiting OCC review, or approved and published). The work-order version appears separately. Next-action text names OCC or the specific station rather than using “You”; resource readiness and custom items requiring manual review appear below it. Mobile flight lists retain the status and version.

**Current v2 flow:** OCC sends a versioned work order → the outstation receives it and replies → OCC reviews the reply and explicitly authorises publication → the passenger page refreshes. Reissuing, stopping a work order and cancelling a flight are separate actions.

Outstation managers can also publish **passenger notices** from a flight's History events: **Edit passenger notice → apply a template or edit Chinese/English → Preview notice → Publish to passengers**. Templates cover current public arrangements, waiting reminders, connections and meals/assistance, with a blank custom option. The original event is retained, and the notice appears in passenger history with an audit link. **Edit another notice** brings back the published copy and publishes a new notice when confirmed. This notification flow leaves the work-order/operational state under its existing OCC controls. OCC's publishing pause applies to these notices too.

OCC can send **internal broadcasts** to all seven outstations, one or more regions, or individually selected stations. Preview lists the actual recipients before sending. Receiving managers see a pending badge/banner and explicitly acknowledge receipt; OCC sees acknowledgements per station. Viewing a message alone does not acknowledge it. These are internal coordination messages, separate from passenger publishing and its pause switch.

Each station also has a **simulated route weather briefing**, visible on its station page and under Route weather. Seven editable placeholder briefings cover the departure airport, HKG and enroute notes. Cards extract visibility, wind/gusts, cloud base, temperature, QNH, turbulence, icing, thunderstorms and issue/validity times. **Edit demo briefing → Extract key fields → Save weather summary** preserves the source text and appends a new summary. This is an explicit sample text format, not a METAR/TAF decoder or live weather service; missing/invalid fields show “—”.

## Run

Requires Python 3.11+ and Node.js 20.19+ or 22.12+.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm ci
./scripts/run.sh
```

Open [the workspace index](http://127.0.0.1:8000), [OCC](http://127.0.0.1:8000/occ), or [KIX outstation](http://127.0.0.1:8000/outport?station=KIX). The logo returns to the index. The [passenger preview](http://127.0.0.1:8000/passenger) is always available while the local demo is running. Choose a flight and a direct/connecting view there, or use **Passenger view** inside any OCC flight to open its preview directly. Addresses such as `/passenger?case=1` are stable: no link generation, expiry or replacement step is needed.

For hot reload, run `./scripts/dev.sh` and open [Vite](http://127.0.0.1:5173). Vite proxies `/api` to the backend on port 8000. The normal run script builds and serves the frontend on port 8000.

The first startup creates eight synthetic flights across seven outstations in ignored `data/demo-v2.sqlite3`. Later starts preserve changes. `TWINOMATION_DB` can select a separate database; attached files are stored in a `files/` directory beside it. v1's `data/demo.sqlite3` is not the default and is not deleted. The synthetic flight date is 15 November 2026; interaction timestamps are actual times. UI schedule times use HKT.

## Demo walkthrough

1. Open **OCC → Japan → Osaka → TW602**, and open KIX in another tab or on a narrow window. TW602 starts with a sent work order.
2. At KIX, open TW602 and **Receive work order v1**. Answer each requested item, add gate/counter notes and optionally add a custom item with 2–6 choices. Select **Send to OCC**.
3. Share one or more files through **Add Word, PDF…** or drag and drop. Both employee workspaces can download them. Each file must be 1 byte–5 MB; supported extensions are PDF, Office documents, TXT/CSV and PNG/JPEG. Files remain internal.
4. OCC sees the reply, custom answers and files. All preset resources must be Ready before **Authorise & publish** becomes available; otherwise reissue the work order. Review custom answers and confirm they meet requirements. Choose the departure, gate and status, and choose a cause for a delay. A delay can have an unconfirmed departure time; boarding requires a time. Publishing starts paused on a fresh database; use **Resume** inside the dialog or the header control.
5. Confirm publication. The already-open passenger preview receives the approved status, time, gate and cause at the same address. Internal work-order notes, answers and files are excluded.
6. Alternatively, **Reissue as v2** sends a new work order, retaining the previous answers for reference and requiring fresh answers. **Stop v1** stops coordination without cancelling the flight. **Cancel flight** explicitly publishes a cancellation and closes the case.
7. Use **New flight case** for a clean scenario, then create a work order. The operator-information check is required before sending.

Other seeded scenarios: TW218 is ready for OCC review; TW310 has resource gaps and a custom item; TW126 has a replaced v1 and received v2; TW730 includes special assistance; TW808 and TW512 have no work order yet.

## Current capabilities

- **OCC:** region/station navigation, search and filters, case creation, resource requests, review of station replies, authorisation, reissue, stop, cancellation and publishing pause.
- **Outstation:** server-enforced station scope, receipt, preset/custom responses, shared files, a timeline-based bilingual passenger-notice editor with templates/preview/publication, and an optional sound alarm for newly arriving work orders. Browsers require a user gesture to enable sound.
- **Passenger:** always-available previews with flight/view selection, approved updates, a brief reason and detailed bilingual FAQ, history, a 35-city bilingual guide and read-only connecting flights. Short delays show destination/airline/rail promotions; delays of 120 minutes or more prioritise departure-airport dining/shopping directories. Unknown times show waiting information without an invented arrival forecast. Connection rows update with time and have no select/book/change actions. The scenario selector is an explicitly labelled local overlay; it does not publish or change OCC data.
- **Consistency:** SQLite write transactions, version conflicts, one active work order per flight, stopped orders on case closure, superseded legacy drafts after v2 publication, and invalidation of an old public gate when the next station reply changes its gate answer. The new gate still requires OCC authorisation. Cancellation clears the old public gate/departure.
- **Refresh:** scoped SSE signals plus GET on connection, reconnect, return to the foreground and every 30 seconds.

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

The v2 endpoints cover `/api/cases/{id}/work-orders`, `/api/work-orders/{id}/{receive,respond,authorize,reissue,abort}`, `/api/cases/{id}/cancel-flight`, `/api/cases/{id}/files` and `/api/files/{id}`. Mutations use the relevant case or work-order version where defined. Case creation and legacy CS publication additionally support scoped idempotency keys; v2 work-order actions use status/version checks, not a general retry cache.

Broadcast endpoints: `GET/POST /api/broadcasts`, `GET /api/broadcasts/{id}` and `POST /api/broadcasts/{id}/acknowledge`. Only OCC can send; managers can list/read/acknowledge their own station's messages. POST creation requires an `Idempotency-Key` and `{title,body,scope,targets,priority}`; scopes are `all` (empty targets), `regions` (`JP`, `CN`, `TW`, `KR`) and `stations` (station codes).

Weather endpoints are under `/api/stations/{station}/weather-briefings`: `GET /latest`, `GET /sample`, `POST /parse` for a read-only preview and `POST` at the base path to save. OCC can access every station; managers only their own. Save requires `source_name`, `raw_text`, the latest `previous_id` and an `Idempotency-Key`. It reparses the raw source on the server, rejects stale edits and retains earlier records. New tables and missing station samples are added at startup without replacing existing flights or publications. Both services emit scoped staff refresh signals and stay out of the passenger model.

Outstation notices use `POST /api/cases/{case_id}/events/{event_id}/passenger-notices` with a case `version`, optional `text_zh` / `text_en` (at least one required), a template identifier and an `Idempotency-Key`. Publication is scoped to the manager's station and checks the pause/version. Stored Chinese copy is explicit human-edited text; a missing language falls back to the supplied original, with no automatic translation. Internal event text, proposed times and unapproved gates are not automatically copied into templates.

The v1 readiness, schedule, notes, close and CS draft-review APIs remain for compatibility and regression testing. There is **no separate CS workspace in the current frontend**; `/review` shows the index. In v2, OCC's explicit **Authorise & publish** is the human review. This differs from the original four-workspace baseline in `Twinomation_Handoff.md`. Publishing a v2 update supersedes pending legacy drafts on that case to prevent old instructions being published afterward. Avoid mixing v1 and v2 workflows during a demo.

## Local demo boundaries

The server accepts only local loopback clients. Roles and stations simulate identity; there is no production login. Do not expose this demo through a public bind, tunnel, reverse proxy or LAN. No real airline, booking, passenger, email or AI service is connected. `send_email=true` is rejected by the legacy publication API; v2 publication updates only the local passenger page.

Employee tabs keep independent bearer sessions in `sessionStorage`. Sessions last eight hours and are lost on server restart. The current local passenger preview needs no session or token, exposes only the published passenger read model and basic synthetic flight identifiers, and keeps the same URL across server restarts. It does not expose employee notes, pending updates or files. Legacy private-token APIs and their eight-hour expiry/revocation rules remain for compatibility; the frontend no longer issues these links. Server access logs remain disabled.

Publishing pause blocks new publications, including cancellation; coordination and safe invalidation of old guidance continue. It does not retract history or a message someone already viewed. There is no automatic publication, actual rebooking, external delivery or guaranteed notification.

SQLite, sessions and SSE use one local process. At most four SSE streams per loopback client are allowed; extra tabs fall back to polling and retry live mode. No durable event replay, high availability or production performance claim is made. Lists/history are bounded (100 cases, 200 updates/events and 100 files per detail response). Files have a per-file limit, not a total storage quota or malware scanning. No real personal data should be imported.

## Verification

```bash
.venv/bin/python -m pytest backend/tests -q
npm test
npm run build
```

The latest review passed 66 backend tests, 30 frontend tests and the production build. Checks include work-order safeguards, passenger notices, scoped broadcasts/receipts, demo weather extraction/edit conflicts, bilingual content and connection guidance. Browser evidence and earlier file-transfer checks are recorded in [VERIFICATION.md](VERIFICATION.md).

## Friend implementation integration

OCC → **Demo scenarios** loads 30 additional synthetic UO flights without changing existing cases. The 11-station network now supports flights in both directions. The same screen offers an explicit, database-backed reset/restore flow; reset creates a backup first.

Each flight now has **Tasks & messages**, **Passenger care**, and an OCC-only **OCC handover** tab. Independent five-state ground tasks and messages support daily handover; formal work-order resource replies still require OCC review. Customer Care is a scoped, separate demo identity with read-only task/boarding controls and passenger notice/dispatch permissions. Messages and broadcasts share an inbox, receipts and overdue warnings.

Passenger care supports saved bilingual notice drafts, immediate/scheduled notices, **locally simulated email**, and boarding reminders 30 minutes before confirmed departure. Reminders require the matching OCC-authorised departure. The passenger page adds five-stage progress, recall dialogs, cancellation assistance, a published-only HKG onward network, a manual transfer calculator and four-airport thematic maps/transport guides. Existing 30/60-minute colours remain unchanged.

See [feature integration and boundaries](docs/friend-feature-integration.md). All new business records live in SQLite, including scheduled dispatches. A two-second server worker delivers due jobs while the local demo is running; there is no real email, airline, weather or booking integration.

## Short / long passenger delay demo

The passenger flight selector now includes **短延误** (45-minute weather delay) and **长延误** (180-minute aircraft-check delay). Both are pre-approved synthetic flights with bilingual announcements. Short delays show destination/airline/rail promotions; long delays show airport dining/shopping first, with destination content expandable and promotional banners hidden. Selecting another flight clears a previous local scenario overlay.

Free-text fields are optional in this demo. Blank descriptions/reissue/stop notes are accepted; empty flight names get a generated `DEMO…` label; empty custom tasks/items get a default name; blank notices use a reviewed-flight template or a generic waiting message; blank simulated email recipients use `demo@example.test`; blank weather text loads an explicit demo sample. Dates, times, structured selections, maximum lengths, publication pause and resource authorisation remain enforced.
