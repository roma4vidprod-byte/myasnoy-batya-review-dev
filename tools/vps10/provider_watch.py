"""Local health gate for the real Yandex scheduler. No DB/provider access."""
import json
import os
import socket
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path

RECEIPT = Path('/var/lib/review-activator-ops/VPS09_LAST_SYNC.json')
TIMER = 'review-activator-yandex-sync.timer'
SERVICE = 'review-activator-yandex-sync.service'
MAX_AGE_SECONDS = 3 * 3600


class SafeFailure(Exception):
    pass


def need(value, code):
    if not value:
        raise SafeFailure(code)


def age_seconds(value, now=None):
    need(isinstance(value, str), 'PROVIDER_TIMESTAMP_INVALID')
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        raise SafeFailure('PROVIDER_TIMESTAMP_INVALID') from None
    need(stamp.tzinfo is not None, 'PROVIDER_TIMESTAMP_INVALID')
    current = now or datetime.now(timezone.utc)
    age = int(current.timestamp() - stamp.timestamp())
    need(0 <= age <= MAX_AGE_SECONDS, 'PROVIDER_RECEIPT_STALE')
    return age
def validate_receipt(value, now=None):
    need(isinstance(value, dict), 'PROVIDER_RECEIPT_INVALID')
    need(value.get('last_sync_result') == 'PASS'
         and value.get('sync_failure') is None, 'PROVIDER_LAST_SYNC_FAILED')
    count = value.get('real_review_count')
    need(type(count) is int and count >= 0, 'PROVIDER_RECEIPT_INVALID')
    read_age = age_seconds(value.get('last_successful_provider_read'), now)
    persist_age = age_seconds(value.get('last_successful_persistence'), now)
    return {'real_review_count': count, 'read_age_seconds': read_age,
            'persistence_age_seconds': persist_age}


def systemctl(unit, prop):
    try:
        p = subprocess.run(
            ['/usr/bin/systemctl', 'show', unit, '-p', prop, '--value'],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, timeout=10, check=False,
            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SafeFailure('PROVIDER_UNIT_QUERY_FAILED') from None
    need(p.returncode == 0, 'PROVIDER_UNIT_QUERY_FAILED')
    return p.stdout.strip()


def main():
    expected = os.environ.get('RA_EXPECTED_HOSTNAME')
    need(os.geteuid() == 0 and expected and socket.gethostname() == expected,
         'HOST_ROOT_GUARD')
    try:
        s = RECEIPT.lstat()
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0
             and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size < 8192,
             'PROVIDER_RECEIPT_INVALID')
        value = json.loads(RECEIPT.read_text())
    except (OSError, ValueError, TypeError):
        raise SafeFailure('PROVIDER_RECEIPT_INVALID') from None
    summary = validate_receipt(value)
    need(systemctl(TIMER, 'ActiveState') == 'active'
         and systemctl(TIMER, 'UnitFileState') == 'enabled',
         'PROVIDER_TIMER_NOT_ACTIVE')
    need(systemctl(SERVICE, 'Result') == 'success',
         'PROVIDER_SERVICE_FAILED')
    print(json.dumps({'status': 'PASS', **summary,
                      'timer': 'active/enabled', 'service_result': 'success'},
                     separators=(',', ':')))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SafeFailure as error:
        print(json.dumps({'status': 'FAIL', 'error': str(error)},
                         separators=(',', ':')))
        raise SystemExit(1)
