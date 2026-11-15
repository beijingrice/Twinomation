"""v2: work orders between OCC and outstation managers, file transfer, and the automated passenger feed."""
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app, passenger_text_zh

STANDARD = ['fueling', 'ground_handling', 'catering', 'gate', 'counter']


@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path / 'demo.db')
    with TestClient(app, headers={'X-Twinomation-Client': 'local-demo'}) as client:
        def login(role, station='KIX'):
            response = client.post('/api/session', json={'role': role, 'station': station})
            assert response.status_code == 200
            return {'Authorization': 'Bearer ' + response.json()['token']}
        yield client, app, login


def new_case(client, occ):
    body = {'flight_no': 'TW999', 'station': 'KIX', 'flight_date': '2026-11-15', 'reason': 'Synthetic test disruption', 'original_departure': '2026-11-15T10:00:00+08:00'}
    response = client.post('/api/cases', headers={**occ, 'Idempotency-Key': 'wo-case'}, json=body)
    assert response.status_code == 201, response.text
    return response.json()['id']


def send(client, occ, case_id, items=STANDARD, **extra):
    return client.post(f'/api/cases/{case_id}/work-orders', headers=occ, json={'items': items, 'operator_checked': True, 'proposed_departure': '2026-11-15T12:30:00+08:00', **extra})


def wo(client, headers, case_id):
    return client.get(f'/api/cases/{case_id}', headers=headers).json()['work_orders'][0]


def reply(order, status='Ready', custom=None):
    items = [{'key': i['key'], 'label': i['label'], 'kind': 'preset', 'options': i['options'], 'status': status, 'note': 'Gate 18' if i['key'] == 'gate' else ''} for i in order['items'] if i['kind'] == 'preset']
    return {'version': order['version'], 'items': items + (custom or []), 'note': 'Checked with ground teams'}


def enable_publishing(client, occ):
    state = client.get('/api/kill-switch', headers=occ).json()
    assert client.put('/api/kill-switch', headers=occ, json={'active': False, 'version': state['version']}).status_code == 200


def link(client, occ, case_id, connection=None):
    response = client.post('/api/demo/passenger-link', headers=occ, json={'case_id': case_id, 'connection': connection})
    assert response.status_code == 200, response.text
    return response.json()['path'].split('#')[1]


def test_full_cycle_from_work_order_to_passenger_feed(env):
    client, _, login = env
    occ, kix = login('occ'), login('outport', 'KIX')
    case_id = new_case(client, occ)
    token = link(client, occ, case_id)

    assert send(client, occ, case_id, operator_checked=False).status_code == 422
    created = send(client, occ, case_id)
    assert created.status_code == 201 and created.json()['number'] == 1 and created.json()['status'] == 'SENT'

    order = wo(client, kix, case_id)
    assert client.post(f'/api/work-orders/{order["id"]}/receive', headers=kix, json={'version': order['version']}).status_code == 200
    order = wo(client, kix, case_id)
    custom = [{'key': 'custom-1', 'label': 'De-icing', 'kind': 'custom', 'options': ['Booked', 'Not needed'], 'status': 'Booked'}]
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order, custom=custom)).status_code == 200
    order = wo(client, occ, case_id)
    assert order['status'] == 'RESPONDED' and order['items'][-1]['label'] == 'De-icing'

    # Internal proposal never reaches passengers before authorisation.
    passenger = client.get(f'/api/passenger/{token}').json()
    assert passenger['status']['status'] == 'AWAITING' and passenger['status']['departure'] is None

    body = {'version': order['version'], 'flight_status': 'DELAYED', 'departure': '2026-11-15T12:30:00+08:00', 'cause': 'WEATHER', 'gate': '18', 'custom_items_reviewed': True}
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json=body).json()['error']['code'] == 'KILL_SWITCH_ACTIVE'
    enable_publishing(client, occ)
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json={**body, 'cause': None}).status_code == 422
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json=body).status_code == 200

    passenger = client.get(f'/api/passenger/{token}').json()
    assert passenger['status']['status'] == 'DELAYED' and passenger['status']['cause'] == 'WEATHER' and passenger['status']['gate'] == '18'
    assert passenger['status']['departure'] == '2026-11-15T04:30:00Z'
    assert passenger['timeline'][0]['text'].startswith('Flight TW999 is delayed')
    assert passenger['timeline'][0]['text_zh'] == '航班 TW999 已延误，新的起飞时间为香港时间 12:30。登机口：18。'
    assert 'Checked with ground teams' not in str(passenger) and 'De-icing' not in str(passenger)


def test_roles_and_station_scoping(env):
    client, _, login = env
    occ, kix, nrt = login('occ'), login('outport', 'KIX'), login('outport', 'NRT')
    case_id = new_case(client, occ)
    assert send(client, kix, case_id).status_code == 403
    order = send(client, occ, case_id).json()
    assert client.post(f'/api/work-orders/{order["id"]}/receive', headers=nrt, json={'version': 1}).status_code == 404
    assert client.post(f'/api/work-orders/{order["id"]}/receive', headers=occ, json={'version': 1}).status_code == 403
    assert client.post(f'/api/work-orders/{order["id"]}/abort', headers=kix, json={'version': 1, 'reason': 'x'}).status_code == 403


def test_reply_validation_and_one_active_order(env):
    client, _, login = env
    occ, kix = login('occ'), login('outport', 'KIX')
    case_id = new_case(client, occ)
    order = send(client, occ, case_id).json()
    assert send(client, occ, case_id).json()['error']['code'] == 'WORK_ORDER_ACTIVE'
    # Must receive before replying.
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order)).status_code == 409
    client.post(f'/api/work-orders/{order["id"]}/receive', headers=kix, json={'version': 1})
    order = wo(client, kix, case_id)
    partial = reply(order)
    partial['items'] = partial['items'][1:]
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=partial).status_code == 422
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order, status='Maybe')).status_code == 422
    bad_custom = [{'key': 'fueling-2', 'label': 'X', 'kind': 'custom', 'options': ['A', 'B'], 'status': 'A'}]
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order, custom=bad_custom)).status_code == 422
    stale = {**reply(order), 'version': order['version'] + 5}
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=stale).json()['error']['code'] == 'VERSION_CONFLICT'


def test_reissue_creates_next_version_with_previous_answers(env):
    client, _, login = env
    occ, kix = login('occ'), login('outport', 'KIX')
    case_id = new_case(client, occ)
    order = send(client, occ, case_id).json()
    client.post(f'/api/work-orders/{order["id"]}/receive', headers=kix, json={'version': 1})
    order = wo(client, kix, case_id)
    client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order, status='Pending'))
    order = wo(client, occ, case_id)
    response = client.post(f'/api/work-orders/{order["id"]}/reissue', headers=occ, json={'version': order['version'], 'note': 'Reconfirm catering'})
    assert response.status_code == 201
    orders = client.get(f'/api/cases/{case_id}', headers=occ).json()['work_orders']
    assert [(o['number'], o['status']) for o in orders] == [(2, 'SENT'), (1, 'REISSUED')]
    assert all(i['status'] is None and i['previous'] == 'Pending' for i in orders[0]['items'])


def test_abort_and_cancel_flight(env):
    client, _, login = env
    occ = login('occ')
    case_id = new_case(client, occ)
    token = link(client, occ, case_id)
    order = send(client, occ, case_id).json()
    assert client.post(f'/api/work-orders/{order["id"]}/abort', headers=occ, json={'version': 1, 'reason': 'Aircraft swap'}).status_code == 200
    assert wo(client, occ, case_id)['status'] == 'ABORTED'
    second = send(client, occ, case_id).json()
    assert second['number'] == 2
    enable_publishing(client, occ)
    case = client.get(f'/api/cases/{case_id}', headers=occ).json()
    assert client.post(f'/api/cases/{case_id}/cancel-flight', headers=occ, json={'version': case['version'], 'cause': 'TECHNICAL'}).status_code == 200
    case = client.get(f'/api/cases/{case_id}', headers=occ).json()
    assert case['status'] == 'CLOSED' and case['flight_status'] == 'CANCELLED' and case['work_orders'][0]['status'] == 'ABORTED'
    assert client.get(f'/api/passenger/{token}').json()['status']['status'] == 'CANCELLED'
    assert send(client, occ, case_id).json()['error']['code'] == 'CASE_CLOSED'


def test_file_transfer_scoped_typed_and_bounded(env):
    client, _, login = env
    occ, kix, nrt = login('occ'), login('outport', 'KIX'), login('outport', 'NRT')
    case_id = new_case(client, occ)
    pdf = b'%PDF-1.4 synthetic'
    response = client.post(f'/api/cases/{case_id}/files?name=load-sheet.pdf', headers={**occ, 'Content-Type': 'application/octet-stream'}, content=pdf)
    assert response.status_code == 201, response.text
    file_id = response.json()['id']
    up = client.post(f'/api/cases/{case_id}/files?name=..%2F..%2Fgate-plan.docx', headers={**kix, 'Content-Type': 'application/octet-stream'}, content=b'docx')
    assert up.status_code == 201 and up.json()['name'] == 'gate-plan.docx'

    download = client.get(f'/api/files/{file_id}', headers=kix)
    assert download.status_code == 200 and download.content == pdf and 'attachment' in download.headers['content-disposition']
    assert client.get(f'/api/files/{file_id}', headers=nrt).status_code == 404
    assert client.post(f'/api/cases/{case_id}/files?name=run.exe', headers=occ, content=b'MZ').status_code == 422
    big = client.post(f'/api/cases/{case_id}/files?name=big.pdf', headers=occ, content=b'0' * (5 * 1024 * 1024 + 1))
    assert big.status_code == 413
    # The larger limit applies only to the upload route.
    assert client.post('/api/cases', headers=occ, content=b'{' + b' ' * 20000 + b'}').status_code == 413
    assert len(client.get(f'/api/cases/{case_id}', headers=occ).json()['files']) == 2


def test_connecting_passenger_link_and_per_type_revocation(env):
    client, _, login = env
    occ = login('occ')
    direct = link(client, occ, 1)
    connecting = link(client, occ, 1, 'LHR')
    assert client.get(f'/api/passenger/{direct}').status_code == 200
    data = client.get(f'/api/passenger/{connecting}').json()
    assert data['connection']['destination'] == 'LHR' and len(data['connection']['flights']) == 7
    assert data['connection']['booked'] in {f['flight_no'] for f in data['connection']['flights']}
    replacement = link(client, occ, 1, 'LHR')
    assert client.get(f'/api/passenger/{connecting}').status_code == 404
    assert client.get(f'/api/passenger/{replacement}').status_code == 200
    assert client.get(f'/api/passenger/{direct}').status_code == 200
    assert client.post('/api/demo/passenger-link', headers=occ, json={'case_id': 1, 'connection': 'XXX'}).status_code == 422


def test_seed_has_work_orders_in_several_states(env):
    client, _, login = env
    states = {c['flight_no']: (c['work_order'] or {}).get('status') for c in client.get('/api/cases', headers=login('occ')).json()}
    assert states['TW218'] == 'RESPONDED' and states['TW602'] == 'SENT' and states['TW808'] is None


@pytest.mark.parametrize('resource_status', ['Pending','Unavailable'])
@pytest.mark.parametrize('flight_status', ['DELAYED','BOARDING'])
def test_unready_resources_cannot_be_published_and_require_new_round(env, resource_status, flight_status):
    client, _, login = env
    occ, kix = login('occ'), login('outport')
    cid = new_case(client, occ)
    order = send(client, occ, cid).json()
    client.post(f'/api/work-orders/{order["id"]}/receive', headers=kix, json={'version':order['version']})
    order = wo(client, kix, cid)
    client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order,status=resource_status))
    order = wo(client, occ, cid)
    before = client.get(f'/api/cases/{cid}',headers=occ).json()
    enable_publishing(client, occ)
    response = client.post(f'/api/work-orders/{order["id"]}/authorize',headers=occ,json={
        'version':order['version'],'flight_status':flight_status,'cause':'WEATHER',
        'departure':'2026-11-15T12:30:00+08:00'})
    assert response.status_code == 409 and response.json()['error']['code'] == 'RESOURCES_NOT_READY'
    after = client.get(f'/api/cases/{cid}',headers=occ).json()
    assert after['version'] == before['version'] and after['events'] == before['events']
    assert client.get(f'/api/demo/passenger/{cid}').json()['timeline'] == []
    second = client.post(f'/api/work-orders/{order["id"]}/reissue',headers=occ,json={'version':order['version'],'note':'Please reconfirm resources'})
    assert second.status_code == 201 and second.json()['number'] == 2


def test_custom_readiness_requires_explicit_occ_review_and_audits_confirmation(env):
    client, _, login = env
    occ = login('occ')
    enable_publishing(client, occ)
    order = wo(client, occ, 8)  # Fully custom labels/options have no automatic ready meaning.
    body = {'version':order['version'],'flight_status':'BOARDING','departure':'2026-11-15T17:00:00+08:00'}
    response = client.post(f'/api/work-orders/{order["id"]}/authorize',headers=occ,json=body)
    assert response.status_code == 422 and response.json()['error']['code'] == 'CUSTOM_REVIEW_REQUIRED'
    assert wo(client, occ, 8)['status'] == 'RESPONDED'
    assert client.post(f'/api/work-orders/{order["id"]}/authorize',headers=occ,json={**body,'custom_items_reviewed':True}).status_code == 200
    events = client.get('/api/cases/8',headers=occ).json()['events']
    assert next(e for e in events if e['type']=='WORK_ORDER_AUTHORIZED')['payload']['custom_items_reviewed'] is True


def test_delayed_flight_can_publish_unknown_time_but_boarding_requires_time(env):
    client, _, login = env
    occ = login('occ')
    enable_publishing(client, occ)
    order = wo(client, occ, 1)
    base = {'version':order['version'],'departure':None}
    response = client.post(f'/api/work-orders/{order["id"]}/authorize',headers=occ,json={**base,'flight_status':'BOARDING'})
    assert response.status_code == 422 and response.json()['error']['code'] == 'DEPARTURE_REQUIRED'
    assert client.post(f'/api/work-orders/{order["id"]}/authorize',headers=occ,json={**base,'flight_status':'DELAYED','cause':'WEATHER'}).status_code == 200
    public = client.get('/api/demo/passenger/1?connection=LHR').json()
    assert public['status']['departure'] is None and public['status']['status'] == 'DELAYED'
    assert public['timeline'][0]['text_zh'] == '航班 TW218 已延误，起飞时间待确认。'
    assert 'awaiting confirmation' in public['timeline'][0]['text']


@pytest.mark.parametrize('initial', ['SENT', 'RECEIVED', 'RESPONDED'])
def test_closing_case_stops_work_order_and_rejects_further_actions(env, initial):
    client, _, login = env
    occ, kix = login('occ'), login('outport')
    cid = new_case(client, occ)
    order = send(client, occ, cid).json()
    if initial != 'SENT':
        assert client.post(f'/api/work-orders/{order["id"]}/receive', headers=kix, json={'version': order['version']}).status_code == 200
        order = wo(client, kix, cid)
    if initial == 'RESPONDED':
        assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=reply(order)).status_code == 200
        order = wo(client, kix, cid)
    case = client.get(f'/api/cases/{cid}', headers=occ).json()
    assert client.post(f'/api/cases/{cid}/close', headers=occ, json={'version': case['version']}).status_code == 200
    closed = client.get(f'/api/cases/{cid}', headers=occ).json()
    assert closed['work_orders'][0]['status'] == 'ABORTED'
    assert any(e['type'] == 'WORK_ORDER_ABORTED' for e in closed['events'])
    actions = [('receive', kix, {}), ('respond', kix, reply(order)),
               ('authorize', occ, {'flight_status': 'BOARDING', 'departure': '2026-11-15T12:30:00+08:00'}),
               ('reissue', occ, {'note': 'Reconfirm'}), ('abort', occ, {'reason': 'Stop'})]
    for action, headers, body in actions:
        response = client.post(f'/api/work-orders/{order["id"]}/{action}', headers=headers, json={**body, 'version': order['version']})
        assert response.status_code == 409 and response.json()['error']['code'] == 'CASE_CLOSED'


def test_authorization_supersedes_legacy_draft_and_boarding_clears_delay_reason(env):
    client, _, login = env
    occ, cs = login('occ'), login('cs')
    token = link(client, occ, 1)
    legacy = client.get('/api/updates?case_id=1&status=PENDING', headers=cs).json()[0]
    enable_publishing(client, occ)
    order = wo(client, occ, 1)
    body = {'version': order['version'], 'flight_status': 'BOARDING', 'departure': '2026-11-15T12:30:00+08:00', 'gate': '18'}
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json=body).status_code == 200
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json=body).status_code == 409
    response = client.post(f'/api/updates/{legacy["id"]}/publish', headers={**cs, 'Idempotency-Key': 'obsolete'}, json={'version': legacy['version']})
    assert response.status_code == 409
    detail = client.get('/api/cases/1', headers=occ).json()
    assert next(u for u in detail['updates'] if u['status'] == 'PUBLISHED')['source_type'] == 'WORK_ORDER_AUTHORIZED'
    public = client.get(f'/api/passenger/{token}').json()
    assert public['status']['status'] == 'BOARDING' and public['status']['cause'] is None
    assert len(public['timeline']) == 1


def test_gate_change_invalidates_previous_guidance_even_while_paused(env):
    client, _, login = env
    occ, kix = login('occ'), login('outport')
    token = link(client, occ, 1)
    enable_publishing(client, occ)
    order = wo(client, occ, 1)
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json={
        'version': order['version'], 'flight_status': 'DELAYED', 'cause': 'WEATHER',
        'departure': '2026-11-15T12:30:00+08:00', 'gate': '18'}).status_code == 200
    switch = client.get('/api/kill-switch', headers=occ).json()
    client.put('/api/kill-switch', headers=occ, json={'version': switch['version'], 'active': True})
    order = send(client, occ, 1).json()
    client.post(f'/api/work-orders/{order["id"]}/receive', headers=kix, json={'version': order['version']})
    order = wo(client, kix, 1)
    body = reply(order)
    next(i for i in body['items'] if i['key'] == 'gate')['note'] = 'Gate 99'
    assert client.post(f'/api/work-orders/{order["id"]}/respond', headers=kix, json=body).status_code == 200
    public = client.get(f'/api/passenger/{token}').json()
    assert public['status']['gate'] is None and public['status']['status'] == 'DELAYED'
    assert public['timeline'][0]['invalidated'] is True
    assert '99' not in str(public)
    order = wo(client, occ, 1)
    enable_publishing(client, occ)
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json={
        'version': order['version'], 'flight_status': 'BOARDING',
        'departure': '2026-11-15T12:30:00+08:00', 'gate': '99'}).status_code == 200
    public = client.get(f'/api/passenger/{token}').json()
    assert public['status']['gate'] == '99' and public['status']['cause'] is None
    assert public['timeline'][0]['invalidated'] is False


def test_cancellation_clears_gate_time_and_all_pending_drafts(env):
    client, _, login = env
    occ = login('occ')
    token = link(client, occ, 1)
    enable_publishing(client, occ)
    order = wo(client, occ, 1)
    assert client.post(f'/api/work-orders/{order["id"]}/authorize', headers=occ, json={
        'version': order['version'], 'flight_status': 'BOARDING',
        'departure': '2026-11-15T12:30:00+08:00', 'gate': '18'}).status_code == 200
    order = send(client, occ, 1).json()
    case = client.get('/api/cases/1', headers=occ).json()
    assert client.post('/api/cases/1/cancel-flight', headers=occ, json={'version': case['version'], 'cause': 'TECHNICAL'}).status_code == 200
    assert client.get('/api/updates?case_id=1&status=PENDING', headers=occ).json() == []
    public = client.get(f'/api/passenger/{token}').json()
    assert public['status']['status'] == 'CANCELLED'
    assert public['status']['gate'] is None and public['status']['departure'] is None
    assert public['timeline'][0]['text'].startswith('Flight TW218 has been cancelled')
    assert public['timeline'][1]['invalidated'] is True
    case = client.get('/api/cases/1', headers=occ).json()
    assert case['work_orders'][0]['status'] == 'ABORTED'
    assert any(e['type'] == 'WORK_ORDER_ABORTED' and e['payload']['work_order_id'] == order['id'] for e in case['events'])


@pytest.mark.parametrize('source,text,expected', [
    ('WORK_ORDER_AUTHORIZED', 'Flight TW218 is delayed. New departure time 12:30 HKT. Gate 18.', '航班 TW218 已延误，新的起飞时间为香港时间 12:30。登机口：18。'),
    ('WORK_ORDER_AUTHORIZED', 'Flight TW218 is ready. Boarding for departure at 12:30 HKT.', '航班 TW218 已准备登机，起飞时间为香港时间 12:30。'),
    ('FLIGHT_CANCELLED', 'Flight TW218 has been cancelled. Please contact the airline desk for assistance. (Demo.)', '航班 TW218 已取消，请联系航空公司柜台寻求协助。（演示）'),
    ('NOTE_ADDED', 'Flight TW218 is delayed. New departure time 12:30 HKT. Gate 18.', None),
])
def test_only_known_reviewed_system_publications_have_chinese_copy(source, text, expected):
    row = {'source_type': source, 'final_text': text}
    assert passenger_text_zh(row) == expected
    assert row['final_text'] == text
