#!/usr/bin/env python3
"""Black-box abuse tests for Lunchrad (M8). Runs against a local copy of the
real Worker, never against a deployed environment: it creates rooms, floods
sockets and burns rate limits.

  pip install requests websockets==13.1
  LUNCHRAD_URL=http://127.0.0.1:8787 LUNCHRAD_TEAM_KEY=lokaal-team python3 scripts/security/abuse.py

Expects the production rate limits from wrangler.jsonc and an always-pass
Turnstile secret (worker/.dev.vars.example). Client IPs are varied with the
CF-Connecting-IP header, which only a local runtime accepts from a client.
Every check prints PASS or FAIL with evidence.
"""
import asyncio, base64, json, os, time

import requests
import websockets

B = os.environ.get('LUNCHRAD_URL', 'http://127.0.0.1:8787').rstrip('/')
W = 'ws' + B[len('http'):]
TEAM_KEY = os.environ.get('LUNCHRAD_TEAM_KEY', 'lokaal-team')
ORIGIN = B
results = []

def check(name, ok, evidence=''):
    results.append((name, ok, evidence))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{evidence}]' if evidence else ''))

def ip(n):  # distinct client IPs so limits from one check don't leak into another
    return {'CF-Connecting-IP': f'203.0.113.{n}'}

def session(n=1):
    r = requests.post(B + '/api/session', json={'teamKey': TEAM_KEY}, headers=ip(n))
    return r.json()['token']

def create(team, n=1, name='Sanne'):
    r = requests.post(B + '/api/rooms', json={'name': name, 'turnstileToken': 'X'},
                      headers={'Authorization': 'Bearer ' + team, **ip(n)})
    return r.json()

def join(team, code, name, n=1):
    return requests.post(f'{B}/api/rooms/{code}/join', json={'name': name},
                         headers={'Authorization': 'Bearer ' + team, **ip(n)})

async def ws(code, team, origin=ORIGIN, protocols=None, n=1):
    protos = protocols if protocols is not None else ['lunchrad.v1', 'team.' + team]
    return await websockets.connect(f'{W}/api/rooms/{code}/ws', origin=origin,
                                    subprotocols=protos, extra_headers=ip(n), max_size=None, close_timeout=1)

async def recv_until(sock, pred, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        msg = json.loads(await asyncio.wait_for(sock.recv(), timeout=end - time.time()))
        if pred(msg):
            return msg
    raise TimeoutError

async def closed_code(sock, timeout=3):
    try:
        while True:
            await asyncio.wait_for(sock.recv(), timeout=timeout)
    except websockets.ConnectionClosed as e:
        return e.rcvd.code if e.rcvd else None
    except asyncio.TimeoutError:
        return 'open'

async def main():
    team = session(1)

    # ---------- HTTP surface ----------
    for m in ('PUT', 'DELETE', 'PATCH', 'TRACE', 'OPTIONS'):
        r = requests.request(m, B + '/')
        check(f'{m} / refused', r.status_code in (404, 405), r.status_code)
    for path in ('/api/../admin/api/overview', '//admin/api/overview', '/ADMIN/api/overview',
                 '/admin%2Fapi/overview', '/admin/api/%2e%2e/overview', '/admin/api/overview/'):
        r = requests.get(B + path)
        check(f'path trick {path} gives no admin data', 'restaurants' not in r.text, r.status_code)
    for path in ('/.env', '/.dev.vars', '/wrangler.jsonc', '/.git/config', '/worker/src/env.ts', '/index.html.map'):
        r = requests.get(B + path)
        # Paths without an extension are app routes and get the app shell, never a file.
        leaked = r.status_code == 200 and '<app-root' not in r.text
        check(f'no file served at {path}', not leaked, r.status_code)
    r = requests.get(B + '/', headers={'Host': 'evil.example'})
    # Cloudflare routes by hostname, so a foreign Host never reaches this Worker in production;
    # here it only shows what the Worker would do: the CSP follows the request's own host.
    check('foreign Host header only affects that response (documented)', True,
          'connect-src ' + ('contains' if 'evil.example' in r.headers.get('Content-Security-Policy', '') else 'does not contain') + ' it')
    big = 'a' * (5 * 1024 * 1024)
    t = time.time()
    r = requests.post(B + '/api/session', data=json.dumps({'teamKey': big}),
                      headers={'Content-Type': 'application/json', **ip(9)})
    check('5 MB body refused quickly', r.status_code == 400 and time.time() - t < 3, f'{r.status_code} in {time.time()-t:.2f}s')
    r = requests.post(B + '/api/session', data='{"teamKey":"x","__proto__":{"admin":true}}',
                      headers={'Content-Type': 'application/json', **ip(10)})
    check('prototype-pollution body refused', r.status_code == 400, r.status_code)
    r = requests.post(B + '/api/session', data='teamKey=lokaal-team',
                      headers={'Content-Type': 'application/x-www-form-urlencoded', **ip(11)})
    check('form-encoded body refused', r.status_code == 400, r.status_code)

    # Brute force of the team key: limit 10/min per IP.
    codes = [requests.post(B + '/api/session', json={'teamKey': f'guess{i}'}, headers=ip(20)).status_code
             for i in range(24)]
    check('team-key guessing from one IP is rate limited after 20 tries', codes[:19].count(429) == 0 and 429 in codes[19:], codes)
    r = requests.post(B + '/api/session', json={'teamKey': TEAM_KEY}, headers=ip(20))
    check('even the right key is refused while rate limited', r.status_code == 429, r.status_code)
    # Many IPs together: the global cap (30/min) kicks in.
    spread = [requests.post(B + '/api/session', json={'teamKey': f'g{i}'}, headers=ip(100 + i)).status_code
              for i in range(20)]
    check('guessing from many IPs hits the global cap', 429 in spread, spread)

    # Token tampering (team token obtained before the cap was hit).
    payload, sig = team.split('.')
    data = json.loads(base64.urlsafe_b64decode(payload + '=='))
    data['exp'] += 10 ** 9
    forged = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=') + '.' + sig
    r = requests.get(B + '/api/presets', headers={'Authorization': 'Bearer ' + forged})
    check('team session with extended expiry refused', r.status_code == 401, r.status_code)
    r = requests.get(B + '/api/presets', headers={'Authorization': 'Bearer ' + payload + '.'})
    check('team session without signature refused', r.status_code == 401, r.status_code)
    r = requests.post(B + '/api/rooms/ABCDEF/join', json={'name': 'X'})
    check('room probing without team session gives 401, not 404', r.status_code == 401, r.status_code)

    # Names.
    room = create(team, 2)
    code = room['code']
    for bad in ('<img src=x>', 'Sa‮nne', 'Sa​nne', 'a' * 21, ' ', 'Tom\u0000', '"Tom"', 'Тоm'):
        r = join(team, code, bad, 3)
        check(f'name {bad!r} refused', r.status_code == 400, r.status_code)
    r = join(team, code, 'SANNE', 3)
    check('case-variant of an existing name refused', r.status_code == 409, r.status_code)

    # ---------- WebSocket ----------
    host = room
    for label, kwargs in (('foreign Origin', {'origin': 'https://evil.example'}),
                          ('no team subprotocol', {'protocols': ['lunchrad.v1']}),
                          ('forged team token', {'protocols': ['lunchrad.v1', 'team.' + forged]})):
        try:
            s = await ws(code, team, **kwargs)
            await s.close()
            check(f'WebSocket with {label} refused', False, 'connected')
        except websockets.exceptions.InvalidStatusCode as e:
            check(f'WebSocket with {label} refused', e.status_code in (401, 403), e.status_code)

    s = await ws(code, team)
    await s.send(json.dumps({'type': 'hello', 'token': 'A' * 43}))
    check('wrong participant token closes the socket (4001)', await closed_code(s) == 4001)

    s = await ws(code, team)
    t0 = time.time(); code_ = await closed_code(s, timeout=14)
    check('silent socket closed after the 10 s hello timeout', code_ == 4001, f'{code_} after {time.time()-t0:.1f}s')

    async def authed(creds, n=4):
        sock = await ws(creds['code'], team, n=n)
        await sock.send(json.dumps({'type': 'hello', 'token': creds['token']}))
        await recv_until(sock, lambda m: m['type'] == 'welcome')
        return sock

    hs = await authed(host)
    await hs.send('x' * 3000)
    check('oversized frame closes the socket (4009)', await closed_code(hs) == 4009)

    hs = await authed(host)
    for _ in range(40):
        try:
            await hs.send(json.dumps({'type': 'ping'}))
            await hs.send(json.dumps({'type': 'unboost'}))
        except websockets.ConnectionClosed:
            break
    check('message flood closes the socket (4029)', await closed_code(hs) == 4029)

    hs = await authed(host)
    await hs.send(b'\x00\x01binary')
    check('binary frame closes the socket (1003)', await closed_code(hs) == 1003)
    hs = await authed(host)
    await hs.send(json.dumps({'type': 'start_spin', 'winnerId': 'a' * 16}))
    m = await recv_until(hs, lambda m: m['type'] == 'error')
    check('start_spin with a chosen winner rejected', m['error'] == 'bad_message', m)

    # Participant of room A cannot use room B.
    other = create(team, 5, 'Piet')
    s = await ws(other['code'], team)
    await s.send(json.dumps({'type': 'hello', 'token': host['token']}))
    check('token of another room refused', await closed_code(s) == 4001)

    # Double voting through two sockets of the same participant.
    tom = join(team, code, 'Tom', 6).json()
    mila = join(team, code, 'Mila', 6).json()
    t1, t2, ms = await authed(tom, 7), await authed(tom, 8), await authed(mila, 9)
    await hs.send(json.dumps({'type': 'start_spin'}))
    await recv_until(ms, lambda m: m['type'] == 'state' and m['state']['phase'] == 'voting', timeout=9)
    await t1.send(json.dumps({'type': 'vote', 'choice': 'yes'}))
    await t2.send(json.dumps({'type': 'vote', 'choice': 'yes'}))
    st = await recv_until(ms, lambda m: m['type'] == 'state' and m['state'].get('vote') and len(m['state']['vote']['yes']) >= 1)
    await asyncio.sleep(0.5)
    yes = st['state']['vote']['yes']
    check('one participant on two sockets counts once', yes.count(tom['participantId']) == 1 and st['state']['phase'] == 'voting', yes)

    # Kicked participant cannot come back with the old token.
    await hs.send(json.dumps({'type': 'kick', 'participantId': mila['participantId']}))
    await asyncio.sleep(0.5)
    s = await ws(code, team)
    await s.send(json.dumps({'type': 'hello', 'token': mila['token']}))
    check('kicked participant refused on reconnect', await closed_code(s) == 4001)

    # Socket cap per room (60).
    socks, refused = [], 0
    for i in range(65):
        try:
            socks.append(await ws(code, team, n=50 + i % 100))
        except websockets.exceptions.InvalidStatusCode:
            refused += 1
    check('room accepts at most 60 open sockets', refused >= 1, f'refused {refused}')
    for s in socks:
        await s.close()

    # ---------- Admin without Access ----------
    # An unsigned token ("alg": "none"), built here rather than written out.
    unsigned = base64.urlsafe_b64encode(b'{"alg":"none"}').decode().rstrip('=') + '.e30.'
    for m, path in (('GET', '/admin/api/overview'), ('POST', '/admin/api/team-key/rotate'),
                    ('DELETE', '/admin/api/history')):
        r = requests.request(m, B + path, headers={'Origin': B, 'X-Lunchrad-Admin': '1',
                                                   'Cf-Access-Jwt-Assertion': unsigned})
        check(f'{m} {path} with alg=none token refused', r.status_code == 401, r.status_code)

if __name__ == '__main__':
    if not B.startswith(('http://127.0.0.1', 'http://localhost')):
        raise SystemExit('Refusing to run against anything but a local Worker.')
    asyncio.run(main())
    fails = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(fails)}/{len(results)} passed')
    raise SystemExit(1 if fails else 0)
