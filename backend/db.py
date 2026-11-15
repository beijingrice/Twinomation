"""SQLite storage. All demo data stays in the ignored data directory."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONDITION_KEYS = ('fueling', 'ground_handling', 'catering', 'gate', 'counter')
# v2 work orders: preset items OCC can request, each answered with one of the preset statuses.
PRESET_ITEMS = (('fueling', 'Fueling'), ('ground_handling', 'Ground handling'), ('catering', 'Catering'), ('gate', 'Gate'), ('counter', 'Counter'), ('crew', 'Crew'))
PRESET_OPTIONS = ('Ready', 'Pending', 'Unavailable')
DELAY_CAUSES = ('WEATHER', 'TECHNICAL', 'ATC', 'LATE_AIRCRAFT', 'CREW', 'OPERATIONAL')
# Scheduled block time to HKG in minutes, used to estimate arrival for connecting passengers.
BLOCK_MINUTES = {'KIX': 270, 'NRT': 300, 'PVG': 165, 'PEK': 230, 'TPE': 110, 'KHH': 95, 'ICN': 240,'BKK':175,'SYX':105,'PKX':210,'CRK':130}
STATIONS = [
    {'code': 'KIX', 'name': 'Osaka', 'airport': 'Kansai International', 'country': 'Japan', 'region': 'JP', 'timezone': 'Asia/Tokyo'},
    {'code': 'NRT', 'name': 'Tokyo', 'airport': 'Narita International', 'country': 'Japan', 'region': 'JP', 'timezone': 'Asia/Tokyo'},
    {'code': 'PVG', 'name': 'Shanghai', 'airport': 'Pudong International', 'country': 'China', 'region': 'CN', 'timezone': 'Asia/Shanghai'},
    {'code': 'PEK', 'name': 'Beijing', 'airport': 'Capital International', 'country': 'China', 'region': 'CN', 'timezone': 'Asia/Shanghai'},
    {'code': 'TPE', 'name': 'Taipei', 'airport': 'Taoyuan International', 'country': 'Taiwan', 'region': 'TW', 'timezone': 'Asia/Taipei'},
    {'code': 'KHH', 'name': 'Kaohsiung', 'airport': 'Kaohsiung International', 'country': 'Taiwan', 'region': 'TW', 'timezone': 'Asia/Taipei'},
    {'code': 'ICN', 'name': 'Seoul', 'airport': 'Incheon International', 'country': 'South Korea', 'region': 'KR', 'timezone': 'Asia/Seoul'},
    {'code':'BKK','name':'Bangkok','airport':'Suvarnabhumi Airport','country':'Thailand','region':'TH','timezone':'Asia/Bangkok'},
    {'code':'SYX','name':'Sanya','airport':'Sanya Phoenix International','country':'China','region':'CN','timezone':'Asia/Shanghai'},
    {'code':'PKX','name':'Beijing Daxing','airport':'Beijing Daxing International','country':'China','region':'CN','timezone':'Asia/Shanghai'},
    {'code':'CRK','name':'Clark','airport':'Clark International','country':'Philippines','region':'PH','timezone':'Asia/Manila'},
]


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def encode(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect(path):
    db = sqlite3.connect(path, timeout=5, isolation_level=None, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=5000')
    db.execute('PRAGMA synchronous=NORMAL')
    return db


@contextmanager
def transaction(path):
    db = connect(path)
    try:
        db.execute('BEGIN IMMEDIATE')
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def event(db, case_id, event_type, actor, payload=None):
    return db.execute(
        'INSERT INTO case_events(case_id,type,actor_id,actor_role,payload,created_at) VALUES(?,?,?,?,?,?)',
        (case_id, event_type, actor['id'], actor['role'], encode(payload or {}), now()),
    ).lastrowid


def draft(db, case_id, event_id, topic, text):
    if topic != 'general':
        pending = db.execute("SELECT id FROM passenger_updates WHERE case_id=? AND topic=? AND status='PENDING'", (case_id, topic)).fetchall()
        for row in pending:
            db.execute("UPDATE passenger_updates SET status='SUPERSEDED',version=version+1 WHERE id=?", (row['id'],))
            event(db, case_id, 'UPDATE_SUPERSEDED', {'id': 'system', 'role': 'system'}, {'update_id': row['id']})
    update_id = db.execute('INSERT INTO passenger_updates(case_id,source_event_id,topic,draft_text,created_at) VALUES(?,?,?,?,?)', (case_id, event_id, topic, text, now())).lastrowid
    return update_id


def init_db(path, seed=True):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY, flight_no TEXT NOT NULL, flight_date TEXT NOT NULL,
      station TEXT NOT NULL, destination TEXT NOT NULL DEFAULT 'HKG', reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
      acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1)),
      readiness TEXT NOT NULL, conditions TEXT NOT NULL, original_departure TEXT NOT NULL,
      proposed_departure TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT 'Twinomation Air', aircraft TEXT NOT NULL DEFAULT '',
      flight_status TEXT NOT NULL DEFAULT 'DISRUPTED', public_departure TEXT, delay_cause TEXT, public_gate TEXT
    );
    CREATE TABLE IF NOT EXISTS case_events (
      id INTEGER PRIMARY KEY, case_id INTEGER REFERENCES cases(id), type TEXT NOT NULL,
      actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id,id);
    CREATE TABLE IF NOT EXISTS passenger_updates (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), source_event_id INTEGER REFERENCES case_events(id),
      topic TEXT NOT NULL CHECK(topic IN ('flight_status','counter','gate','general')),
      draft_text TEXT NOT NULL, final_text TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PUBLISHED','REJECTED','SUPERSEDED')),
      version INTEGER NOT NULL DEFAULT 1, send_email INTEGER NOT NULL DEFAULT 0,
      reviewed_by TEXT, review_note TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, published_at TEXT,
      invalidated_at TEXT, corrects_id INTEGER REFERENCES passenger_updates(id),
      CHECK(status!='PUBLISHED' OR (length(final_text)>0 AND reviewed_by IS NOT NULL AND published_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_updates_queue ON passenger_updates(status,created_at);
    CREATE INDEX IF NOT EXISTS idx_updates_case_topic ON passenger_updates(case_id,topic,status);
    CREATE TABLE IF NOT EXISTS passengers (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), token_hash TEXT NOT NULL UNIQUE,
      token_expires_at TEXT NOT NULL, token_revoked_at TEXT, connection TEXT
    );
    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), number INTEGER NOT NULL CHECK(number>0),
      status TEXT NOT NULL CHECK(status IN ('SENT','RECEIVED','RESPONDED','AUTHORIZED','REISSUED','ABORTED')),
      items TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', response_note TEXT NOT NULL DEFAULT '', proposed_departure TEXT,
      operator_checked INTEGER NOT NULL CHECK(operator_checked=1), decision_note TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL,
      sent_at TEXT NOT NULL, received_at TEXT, responded_at TEXT, decided_at TEXT,
      UNIQUE(case_id, number)
    );
    CREATE TABLE IF NOT EXISTS case_files (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), work_order_id INTEGER REFERENCES work_orders(id),
      name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE,
      uploaded_by TEXT NOT NULL, uploaded_role TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      actor_id TEXT NOT NULL, method TEXT NOT NULL, resource_path TEXT NOT NULL, key TEXT NOT NULL,
      request_hash TEXT NOT NULL, http_status INTEGER NOT NULL, response_body TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY(actor_id,method,resource_path,key)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,scope TEXT NOT NULL,
      targets TEXT NOT NULL,priority TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broadcast_recipients (
      broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id),station TEXT NOT NULL,
      acknowledged_at TEXT,acknowledged_by TEXT,PRIMARY KEY(broadcast_id,station)
    );
    CREATE INDEX IF NOT EXISTS idx_broadcast_station ON broadcast_recipients(station,broadcast_id);
    CREATE TABLE IF NOT EXISTS weather_briefings (
      id INTEGER PRIMARY KEY,station TEXT NOT NULL,source_name TEXT NOT NULL,raw_text TEXT NOT NULL,
      parsed_json TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weather_station ON weather_briefings(station,id);
    ''')
    # Older databases: add v2 columns in place.
    for table, column, ddl in [('cases', 'operator', "TEXT NOT NULL DEFAULT 'Twinomation Air'"), ('cases', 'aircraft', "TEXT NOT NULL DEFAULT ''"),
                               ('cases', 'flight_status', "TEXT NOT NULL DEFAULT 'DISRUPTED'"), ('cases', 'public_departure', 'TEXT'),
                               ('cases', 'delay_cause', 'TEXT'), ('cases', 'public_gate', 'TEXT'), ('passengers', 'connection', 'TEXT'),
                               ('passenger_updates', 'final_text_zh', 'TEXT'),('cases','origin',"TEXT NOT NULL DEFAULT ''"),('cases','scenario_key','TEXT'),('cases','public_terminal','TEXT')]:
        if column not in {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}')
    db.execute("UPDATE cases SET origin=station WHERE origin=''")
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_case_scenario ON cases(scenario_key) WHERE scenario_key IS NOT NULL')
    db.execute("INSERT OR IGNORE INTO settings VALUES('kill_switch','true',1,?,'system')", (now(),))
    db.close()
    if seed:
        seed_demo(path)
        seed_work_orders(path)
        from .weather_briefings import seed_weather_briefings
        seed_weather_briefings(path)
    from .extended_ops import init_extended
    init_extended(path)
    if seed:
        from .demo_scenarios import seed_passenger_delays
        seed_passenger_delays(path)


def seed_demo(path):
    actor = {'id': 'demo.occ', 'role': 'occ'}
    with transaction(path) as db:
        if db.execute('SELECT 1 FROM cases LIMIT 1').fetchone():
            return
        flights = [('KIX','TW218','09:40',3), ('KIX','TW602','14:15',1), ('NRT','TW310','10:20',4), ('PVG','TW126','11:50',2), ('PEK','TW808','13:35',0), ('TPE','TW512','12:10',5), ('KHH','TW516','16:30',2), ('ICN','TW730','15:45',1)]
        for i, (station, flight, departure, confirmed) in enumerate(flights):
            departure_at = datetime.fromisoformat(f'2026-11-15T{departure}:00+08:00').astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            conditions = {k: {'status': 'CONFIRMED' if j < confirmed else 'PENDING', 'note': ''} for j, k in enumerate(CONDITION_KEYS)}
            readiness = {'counters': ['A1', 'A2'] if confirmed == 5 else [], 'gates': ['18'] if confirmed >= 4 else [], 'note': ''}
            stamp = now()
            cid = db.execute('''INSERT INTO cases(flight_no,flight_date,station,reason,acknowledged,readiness,conditions,original_departure,proposed_departure,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)''', (flight, '2026-11-15', station, ['Aircraft rotation disruption', 'Weather disruption', 'Operational disruption'][i % 3], int(confirmed > 0), encode(readiness), encode(conditions), departure_at, None, stamp, stamp)).lastrowid
            eid = event(db, cid, 'CASE_OPENED', actor, {'summary': 'Cancellation coordination opened', 'snapshot': {'version': 1, 'status': 'OPEN', 'readiness': readiness, 'conditions': conditions, 'original_departure': departure_at, 'proposed_departure': None}})
            uid = draft(db, cid, eid, 'flight_status', f'Demo update: flight {flight} on 15 November has been cancelled. Further information will be published here after review.')
            if confirmed:
                event(db, cid, 'ACKNOWLEDGED', {'id': f'demo.outport.{station}', 'role': 'outport'}, {'summary': 'Outport acknowledged the case'})
            if i == 0:
                eid = event(db, cid, 'COUNTER_UPDATED', {'id': 'demo.outport.KIX', 'role': 'outport'}, {'summary': 'Assistance counters A1–A2 proposed'})
                db.execute('UPDATE cases SET readiness=? WHERE id=?', (encode({'counters': ['A1', 'A2'], 'gates': [], 'note': ''}), cid))
                draft(db, cid, eid, 'counter', f'Demo update: the assistance counter for flight {flight} is awaiting confirmation.')


def preset_items(keys, statuses=None):
    """Work-order items for the given preset keys; `statuses` optionally pre-answers them (seed only)."""
    labels = dict(PRESET_ITEMS)
    return [{'key': k, 'label': labels[k], 'kind': 'preset', 'options': list(PRESET_OPTIONS), 'status': (statuses or {}).get(k), 'note': ''} for k in keys]


def seed_work_orders(path):
    """v2 demo: work orders in every state so each client has something to do."""
    occ = {'id': 'demo.occ', 'role': 'occ'}
    aircraft = {'TW218': 'A330-300 · B-TWA', 'TW602': 'A321neo · B-TWC', 'TW310': 'A350-900 · B-TWF', 'TW126': 'A321neo · B-TWD',
                'TW808': 'A330-300 · B-TWB', 'TW512': 'A321neo · B-TWE', 'TW516': 'A320 · B-TWG', 'TW730': 'A330-300 · B-TWH'}
    standard = ['fueling', 'ground_handling', 'catering', 'gate', 'counter']
    with transaction(path) as db:
        if db.execute('SELECT 1 FROM work_orders LIMIT 1').fetchone():
            return
        for row in db.execute('SELECT id,flight_no,station,original_departure FROM cases ORDER BY id').fetchall():
            db.execute('UPDATE cases SET aircraft=? WHERE id=?', (aircraft.get(row['flight_no'], 'A321neo'), row['id']))
            base = datetime.fromisoformat(row['original_departure'].replace('Z', '+00:00'))
            proposed = (base + timedelta(minutes={'TW218': 170, 'TW310': 220, 'TW126': 95, 'TW730': 60}.get(row['flight_no'], 120))).isoformat().replace('+00:00', 'Z')
            outport = {'id': f"demo.outport.{row['station']}", 'role': 'outport'}

            def add(number, status, items, response_note='', received=False, responded=False, note='Please confirm resources for the proposed departure.'):
                stamp = now()
                wid = db.execute('INSERT INTO work_orders(case_id,number,status,items,note,response_note,proposed_departure,operator_checked,created_by,sent_at,received_at,responded_at,decided_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?)',
                                 (row['id'], number, status, encode(items), note, response_note, proposed, occ['id'], stamp, stamp if received else None, stamp if responded else None,
                                  stamp if status in ('REISSUED', 'ABORTED', 'AUTHORIZED') else None)).lastrowid
                event(db, row['id'], 'WORK_ORDER_SENT', occ, {'summary': f'Work order v{number} sent', 'work_order_id': wid})
                if received:
                    event(db, row['id'], 'WORK_ORDER_RECEIVED', outport, {'summary': f'Work order v{number} received', 'work_order_id': wid})
                if responded:
                    event(db, row['id'], 'WORK_ORDER_RESPONDED', outport, {'summary': f'Reply to v{number} sent to OCC', 'work_order_id': wid})
                return wid

            ready = {k: 'Ready' for k in standard}
            flight = row['flight_no']
            if flight == 'TW218':      # everything ready: OCC can authorise and publish
                items = preset_items(standard, ready)
                items[3]['note'], items[4]['note'] = 'Gate 18', 'Counters A1–A2'
                add(1, 'RESPONDED', items, 'All resources confirmed with ground teams.', True, True)
            elif flight == 'TW602':    # just sent: the KIX chime should ring
                add(1, 'SENT', preset_items(standard))
            elif flight == 'TW310':    # reply has gaps: OCC should reissue
                items = preset_items(standard, {**ready, 'catering': 'Pending', 'gate': 'Unavailable'})
                items[3]['note'] = 'All gates occupied until 15:30'
                items.append({'key': 'custom-1', 'label': 'De-icing', 'kind': 'custom', 'options': ['Booked', 'Waiting list', 'Not needed'], 'status': 'Waiting list', 'note': ''})
                add(1, 'RESPONDED', items, 'Gate is the blocker. Catering reloading in progress.', True, True)
            elif flight == 'TW126':    # v1 reissued, v2 received and being worked on
                add(1, 'REISSUED', preset_items(standard, {**ready, 'fueling': 'Pending'}), 'Fuel truck delayed.', True, True)
                add(2, 'RECEIVED', preset_items(standard), received=True, note='New time — please reconfirm fueling first.')
            elif flight == 'TW730':    # reply with a custom item
                items = preset_items(standard + ['crew'], {**ready, 'crew': 'Ready'})
                items[3]['note'], items[4]['note'] = 'Gate 251', 'Row K'
                items.append({'key': 'custom-1', 'label': 'Wheelchair assistance', 'kind': 'custom', 'options': ['Arranged', 'Requested', 'Not available'], 'status': 'Arranged', 'note': '3 passengers'})
                add(1, 'RESPONDED', items, 'Ready. Special assistance arranged.', True, True)
            elif flight == 'TW516':
                add(1, 'SENT', preset_items(standard + ['crew']))
            # TW808 and TW512 start with no work order so OCC can create one.
