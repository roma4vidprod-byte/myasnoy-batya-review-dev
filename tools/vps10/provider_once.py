"""One real Yandex review sync iteration for the VDSina VPS.

No retry loop, no Yandex writes, no notifications. Uses the already accepted
private session.mjs manual-replay path and writes only a safe aggregate receipt.
"""
import fcntl
import json
import os
import socket
import subprocess
from datetime import datetime, timezone
from pathlib import Path

STATE = Path('/var/lib/review-activator-ops')
LOCK = STATE / 'yandex-sync.lock'
RECEIPT = STATE / 'VPS09_LAST_SYNC.json'
NODE = '/opt/node/bin/node'
SESSION = '/opt/review-activator-yandex/tools/vps08a/session.mjs'
C = '13f3cb80-487a-4a19-96a1-fb3103200230'
L = '9a95f63b-18e6-447b-a449-8530b67ddbae'
ORG = '54309413522'


class SafeFailure(Exception):
    pass


def need(value, code):
    if not value:
        raise SafeFailure(code)
def utc():
    return datetime.now(timezone.utc).isoformat()


def run(args, *, timeout=75):
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
    try:
        return subprocess.run(
            args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, env=env, timeout=timeout,
            check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SafeFailure('CHILD_EXECUTION_FAILED') from None


def one_json(text):
    need(isinstance(text, str) and len(text) < 65536, 'CHILD_OUTPUT_INVALID')
    lines = [line for line in text.splitlines() if line.strip()]
    need(len(lines) == 1, 'CHILD_OUTPUT_INVALID')
    try:
        value = json.loads(lines[0])
    except (ValueError, TypeError):
        raise SafeFailure('CHILD_OUTPUT_INVALID') from None
    need(isinstance(value, dict), 'CHILD_OUTPUT_INVALID')
    return value
def session_args(mode):
    return [
        '/usr/sbin/runuser', '-u', 'review-yandex-reader', '--',
        '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin',
        'RA_RUNTIME_PROFILE=vps-lab', 'RA_YANDEX_MODE=read-only-admin',
        NODE, SESSION, mode
    ]


def session_status():
    p = run(session_args('status'), timeout=25)
    need(p.returncode == 0, 'SESSION_STATUS_FAILED')
    value = one_json(p.stdout)
    row = value.get('session')
    need(value.get('ok') is True and isinstance(row, dict), 'SESSION_STATUS_FAILED')
    need(row.get('state') == 'READY' and row.get('revision') == 4,
         'SESSION_NOT_READY_REV4')
    need(row.get('last_error_code') is None, 'SESSION_STATUS_FAILED')
    return row


def db_summary():
    sql = f"""select json_build_object(
'real',count(*) filter(where company_id='{C}'),
'synthetic',count(*) filter(where company_id in
 ('10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002')),
'duplicates',(select count(*) from (
 select company_id,location_id,provider,external_review_id
 from public.review_external_reviews group by 1,2,3,4 having count(*)>1) d),
'scope_valid',coalesce(bool_and(location_id='{L}' and provider='yandex'
 and external_location_id='{ORG}') filter(where company_id='{C}'),true),
'ratings_valid',coalesce(bool_and(rating between 1 and 5)
 filter(where company_id='{C}'),true))
from public.review_external_reviews;"""
    p = run([
        '/usr/sbin/runuser', '-u', 'postgres', '--',
        '/usr/lib/postgresql/17/bin/psql', '-XqAtw',
        '-v', 'ON_ERROR_STOP=1', '-d', 'review_activator_lab', '-c', sql
    ], timeout=25)
    need(p.returncode == 0, 'DB_SUMMARY_FAILED')
    value = one_json(p.stdout)
    need(type(value.get('real')) is int and value['real'] >= 0,
         'DB_SUMMARY_INVALID')
    need(value.get('synthetic') == 2 and value.get('duplicates') == 0,
         'DB_SUMMARY_INVALID')
    need(value.get('scope_valid') is True and value.get('ratings_valid') is True,
         'DB_SUMMARY_INVALID')
    return value


def validate_sync(value, before, after):
    need(value.get('ok') is True and value.get('operation') == 'manual-replay',
         'SYNC_RESULT_INVALID')
    need(value.get('state_before') == 'READY' and value.get('revision_before') == 4,
         'SYNC_SESSION_INVALID')
    need(value.get('revision') == 4 and value.get('session_mutations') == 'OFF',
         'SYNC_SESSION_INVALID')
    need(value.get('review_persistence') == 'SUCCESS'
         and value.get('notifications') == 'OFF', 'SYNC_PERSISTENCE_INVALID')
    need(value.get('scope_valid') is True and value.get('contract_valid') is True,
         'SYNC_CONTRACT_INVALID')
    attempted, completed = value.get('attempted'), value.get('completed')
    need(type(attempted) is int and 1 <= attempted <= 8 and completed == attempted,
         'SYNC_HTTP_INVALID')
    statuses = value.get('http_statuses')
    need(isinstance(statuses, list) and len(statuses) == attempted
         and all(x == 200 for x in statuses), 'SYNC_HTTP_INVALID')
    report = value.get('pagination_report')
    need(isinstance(report, dict), 'SYNC_PAGINATION_INVALID')
    need(report.get('classification') in
         ('STRICT_STABLE_COMPLETE', 'MUTABLE_TOTAL_COMPLETE'),
         'SYNC_PAGINATION_INVALID')
    need(report.get('duplicates') == 0
         and report.get('terminal_page_observed') is True,
         'SYNC_PAGINATION_INVALID')
    result = value.get('persistence_result')
    need(isinstance(result, dict), 'SYNC_PERSISTENCE_INVALID')
    unique = value.get('unique')
    need(type(unique) is int and unique >= 0 and result.get('seen') == unique,
         'SYNC_PERSISTENCE_INVALID')
    counts = [result.get(k) for k in ('inserted', 'updated', 'unchanged')]
    need(all(type(x) is int and x >= 0 for x in counts)
         and sum(counts) == unique, 'SYNC_PERSISTENCE_INVALID')
    need(after['real'] == before['real'] + result['inserted'],
         'SYNC_DB_COUNT_INVALID')
    need(after['synthetic'] == before['synthetic'] == 2
         and after['duplicates'] == 0, 'SYNC_DB_COUNT_INVALID')
    return {
        'unique': unique, 'pages': value.get('pages'),
        'inserted': result['inserted'], 'updated': result['updated'],
        'unchanged': result['unchanged'], 'real_review_count': after['real']
    }


def prior_receipt():
    try:
        value = json.loads(RECEIPT.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}
def write_receipt(ok, count):
    prior = prior_receipt()
    now = utc()
    prior_count = prior.get('real_review_count', 0)
    if type(prior_count) is not int or prior_count < 0:
        prior_count = 0
    data = {
        'last_sync_result': 'PASS' if ok else 'FAIL',
        'real_review_count': count if type(count) is int and count >= 0
                             else prior_count,
        'sync_failure': None if ok else 'SYNC_NOT_CONFIRMED',
        'last_successful_provider_read':
            now if ok else prior.get('last_successful_provider_read'),
        'last_successful_persistence':
            now if ok else prior.get('last_successful_persistence')
    }
    tmp = STATE / 'vps10-receipt-pending.json'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf8') as stream:
        json.dump(data, stream, separators=(',', ':'))
        stream.write('\n')
    os.chmod(tmp, 0o600)
    os.replace(tmp, RECEIPT)
    os.chmod(RECEIPT, 0o600)


def acquire_lock():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o600)
    os.chmod(LOCK, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    return fd
def main():
    expected = os.environ.get('RA_EXPECTED_HOSTNAME')
    need(os.geteuid() == 0 and expected and socket.gethostname() == expected,
         'HOST_ROOT_GUARD')
    lock_fd = acquire_lock()
    if lock_fd is None:
        print(json.dumps({'status': 'ALREADY_RUNNING', 'provider_requests': 0}))
        return 0
    count = None
    try:
        session_status()
        before = db_summary()
        count = before['real']
        child = run(session_args('manual-replay'), timeout=70)
        need(child.returncode == 0, 'SYNC_CHILD_FAILED')
        value = one_json(child.stdout)
        session_status()
        after = db_summary()
        count = after['real']
        summary = validate_sync(value, before, after)
        write_receipt(True, count)
        print(json.dumps({
            'status': 'PASS', **summary,
            'provider_requests': value.get('attempted'),
            'yandex_writes': 0, 'notifications': 'OFF',
            'session_revision': 4
        }, separators=(',', ':')))
        return 0
    except SafeFailure as error:
        try:
            count = db_summary()['real']
        except SafeFailure:
            pass
        write_receipt(False, count)
        print(json.dumps({
            'status': 'FAIL', 'error': str(error),
            'retry': 'FORBIDDEN_AUTOMATICALLY',
            'yandex_writes': 0, 'notifications': 'OFF'
        }, separators=(',', ':')))
        return 1
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


if __name__ == '__main__':
    raise SystemExit(main())
