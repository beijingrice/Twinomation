# Twinomation

A local airline disruption coordination demo. Python + FastAPI + SQLite, with a React frontend.

OCC opens a case → the outport confirms resources → customer service reviews a draft → the passenger page receives the approved update.

## Run

Requires Python 3.11+ and Node.js 20.19+ or 22.12+ (verified locally with Python 3.14 and Node.js 26).

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
npm ci
./scripts/run.sh
```

Open [OCC](http://127.0.0.1:8000), [Outport](http://127.0.0.1:8000/outport), or [Customer service](http://127.0.0.1:8000/review). Use the **Passenger preview** action inside an OCC case to issue an eight-hour private link. A new link revokes the previous link for that case.

For development with hot reload, run `./scripts/dev.sh`, then open [the Vite frontend](http://127.0.0.1:5173). The backend remains on port 8000; Vite proxies `/api` requests.

The first startup creates eight synthetic cases across seven outports in the ignored `data/demo.sqlite3` database. Later starts preserve changes. The scenario flight date is 15 November 2026; timestamps and version history reflect actual demo interactions. All displayed schedule times use HKT.

## Demo flow

1. In OCC, select **Japan → Osaka → TW218**. The case includes Conditions, a proposed departure time, passenger updates and a version history.
2. Publishing starts paused on a new database. Use **Resume publishing** on the OCC overview when ready to test. This permits CS publication; it does not publish drafts automatically.
3. Open the case's **Outport demo**. Confirm a gate and counter, enter their locations, and save readiness. OCC updates automatically.
4. Open the **CS workspace**, edit a pending message, select **Review & publish**, and confirm the exact text.
5. The passenger page updates automatically. Unreviewed drafts and internal proposals are absent from its API and SSE feed.
6. Change a published gate at the outport. The old passenger instruction becomes historical immediately; the new gate is withheld until reviewed.
7. Close a case in OCC. Old pending drafts are superseded; CS can still publish or reject the closing notice.

Use **Create case** for a clean, unpublished scenario. Demo flight numbers use `TW` plus 2–4 digits. Conditions are Fueling, Ground handling, Catering, Gate availability and Counter availability. Confirming a gate/counter requires a location. `UNAVAILABLE` means coordination is required; it is not a completed resource check.

## Implemented

- OCC: region/outport drill-down, case search and filters, case creation/closure, internal departure proposals, notes, version snapshots, activity timeline, publishing pause control.
- Outport: station-scoped access, acknowledgement, five resource checks, gate/counter changes, internal notes; mobile layout.
- CS: source event type, editable passenger draft, final preview, approve/reject, superseded draft protection.
- Passenger: private expiring links, published-only response models, current status and history, stale location warnings; mobile layout.
- Backend: short SQLite write transactions, optimistic versions, scoped idempotency keys, append-only application events, SSE refresh signals and periodic GET recovery.

`/api/docs` provides a self-contained API reference; `/api/openapi.json` is the OpenAPI schema. Employee calls use a simulated server-issued bearer session. JSON writes also require `X-Twinomation-Client: local-demo`. This header is a cross-origin request barrier, not employee authentication.

Two UI extensions to the handoff contract are implemented: `PUT /api/cases/{id}/schedule` (OCC-only internal proposal, with version and note), and `conditions` in `PUT /api/cases/{id}/readiness` (all five known resource keys, each with status and optional note). `POST /api/demo/passenger-link` separately issues a demo link without putting raw tokens into idempotency responses. The schema is authoritative for exact request shapes.

## Boundaries

This application **only accepts local loopback clients**. Role and outport selection intentionally simulate identity. Do not expose it through a public bind, tunnel, reverse proxy, or LAN: it has no production login system. Browser tabs keep independent bearer sessions in sessionStorage so the role demos can run together.

No real airline integration, bookings, refunds, passenger records or emails are used. External email requests are rejected atomically; no SMTP credentials, notification worker, or background delivery system is configured. The publish confirmation is a web-message preview, not an email-send feature. Automatic publishing is absent.

The kill switch blocks new publications; it does not hide published history or retract a message already viewed. Safe invalidation of an old location still works while paused. Token hashes, expiration and revocation are stored server-side; raw tokens are only returned at issuance. The browser page carries the token in its fragment, and the backend runs without URL access logs. Do not enable URI logging for token-bearing API paths.

SQLite, sessions and SSE are designed for a **single local process**. Sessions expire after eight hours and are lost on restart. SSE allows at most four simultaneous streams per loopback client, reserving browser HTTP/1.1 connections for normal requests. Additional tabs use 30-second refresh and retry live mode periodically. The server applies periodic token/session validation; disconnected clients re-fetch on reconnect and poll every 30 seconds. No durable event replay, high availability, delivery guarantee, production security certification, or performance claim is made. Demo snapshots are bounded: up to 100 cases and 200 updates/events per response; full pagination and long-term history browsing are deferred.

The app has input limits, object authorization, request limits, a restrictive CSP, no third-party runtime assets, and no-store/referrer protections. No real personal data should be imported. Local runtime databases, environment files and logs are ignored by Git.

## Verification

```bash
.venv/bin/python -m pytest backend/tests -q
npm run build
```

The API tests exercise anonymous and cross-station access, role restrictions, idempotency, concurrent publication, kill-switch defaults and conflicts, unpublished data isolation, link revocation/expiry, superseding, stale public guidance, resource validation, internal scheduling, note rejection and the closing-notice exception.

Manual browser checks cover region → station → case navigation, publishing controls, mobile readiness editing, CS editing/approval, automatic updates in OCC and passenger views, and the passenger/outport layouts at a 390 px viewport. Desktop OCC is checked at 1440 px; outport and passenger layouts are also checked at 320 px. Verification details are maintained in `VERIFICATION.md`.

The architecture uses the official [FastAPI lifespan/testing guidance](https://fastapi.tiangolo.com/advanced/events/) and [React/Vite setup](https://react.dev/learn/build-a-react-app-from-scratch). Visual references requested by the team: [Linear](https://linear.app/), [Apple](https://www.apple.com/) and [Aesop](https://www.aesop.com/). Local CSS takes its layout cues from the macOS Weather app (location list sidebar, centred hero figure, glass widget grid) on a dark sky with a #702B91 brand accent, using system fonts; no reference-site assets are copied.
