"""SQLite storage. All demo data stays in the ignored data directory."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONDITION_KEYS = ('fueling', 'ground_handling', 'catering', 'gate', 'counter')
STATIONS = [
    {'code': 'KIX', 'name': 'Osaka', 'airport': 'Kansai International', 'country': 'Japan', 'region': 'JP', 'timezone': 'Asia/Tokyo'},
    {'code': 'NRT', 'name': 'Tokyo', 'airport': 'Narita International', 'country': 'Japan', 'region': 'JP', 'timezone': 'Asia/Tokyo'},
    {'code': 'PVG', 'name': 'Shanghai', 'airport': 'Pudong International', 'country': 'China', 'region': 'CN', 'timezone': 'Asia/Shanghai'},
    {'code': 'PEK', 'name': 'Beijing', 'airport': 'Capital International', 'country': 'China', 'region': 'CN', 'timezone': 'Asia/Shanghai'},
    {'code': 'TPE', 'name': 'Taipei', 'airport': 'Taoyuan International', 'country': 'Taiwan', 'region': 'TW', 'timezone': 'Asia/Taipei'},
    {'code': 'KHH', 'name': 'Kaohsiung', 'airport': 'Kaohsiung International', 'country': 'Taiwan', 'region': 'TW', 'timezone': 'Asia/Taipei'},
    {'code': 'ICN', 'name': 'Seoul', 'airport': 'Incheon International', 'country': 'South Korea', 'region': 'KR', 'timezone': 'Asia/Seoul'},
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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
      token_expires_at TEXT NOT NULL, token_revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      actor_id TEXT NOT NULL, method TEXT NOT NULL, resource_path TEXT NOT NULL, key TEXT NOT NULL,
      request_hash TEXT NOT NULL, http_status INTEGER NOT NULL, response_body TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY(actor_id,method,resource_path,key)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
    ''')
    db.execute("INSERT OR IGNORE INTO settings VALUES('kill_switch','true',1,?,'system')", (now(),))
    db.close()
    if seed:
        seed_demo(path)


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
            if i in (0, 2, 5):
                db.execute("UPDATE passenger_updates SET status='PUBLISHED',final_text=draft_text,reviewed_by='demo.cs',reviewed_at=?,published_at=?,version=2 WHERE id=?", (stamp, stamp, uid))
                event(db, cid, 'UPDATE_PUBLISHED', {'id': 'demo.cs', 'role': 'cs'}, {'summary': 'Demo cancellation notice approved', 'update_id': uid})
            if i == 0:
                eid = event(db, cid, 'COUNTER_UPDATED', {'id': 'demo.outport.KIX', 'role': 'outport'}, {'summary': 'Assistance counters A1–A2 proposed'})
                db.execute('UPDATE cases SET readiness=? WHERE id=?', (encode({'counters': ['A1', 'A2'], 'gates': [], 'note': ''}), cid))
                draft(db, cid, eid, 'counter', f'Demo update: the assistance counter for flight {flight} is awaiting confirmation.')
