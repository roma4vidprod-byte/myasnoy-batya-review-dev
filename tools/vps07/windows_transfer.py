"""One-time administration bridge; never part of normal server runtime.

SSH verifies the already-pinned host key. Secrets travel only via binary stdin.
Key and archive output files inherit the pre-provisioned Windows private ACL.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from crypto_backup import AESGCM, verify_cipher, Refused

REPO = Path(__file__).resolve().parents[2]
LOCAL = Path('C:/Users/tasfo/Review-Activator-Recovery/VPS07-20260919')
REPORT = Path('C:/Users/tasfo/BusinessOS/Review-Activator-Tools/reports/vps07-20260919')
SSH = ['ssh.exe', '-4', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'UserKnownHostsFile=C:/Users/tasfo/BusinessOS/Review-Activator-Tools/vps/known_hosts',
       '-o', 'KexAlgorithms=curve25519-sha256', '-i', 'C:/Users/tasfo/BusinessOS/Review-Activator-Tools/vps/reviewadmin_ed25519',
       'reviewadmin@141.98.87.15']
REMOTE = '/opt/review-activator-lab/ops/'
INCOMING = '/var/backups/review-activator-dr/retrieved-vps07/'


def ssh(command, data=None, timeout=300):
    result = subprocess.run([*SSH, command], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Only fixed safe DR JSON, never arbitrary shell stderr or response bodies.
        try:
            obj = json.loads(result.stdout)
            safe = {k: obj[k] for k in ('status', 'stage', 'code') if k in obj and isinstance(obj[k], str)
                    and all(c.isupper() or c.isdigit() or c == '_' for c in obj[k])}
            print(json.dumps(safe))
        except (ValueError, TypeError):
            pass
        raise Refused('SSH_OPERATION_FAILED')
    return result.stdout


def upload(path, data, mode=0o600, replace=False):
    if not path.startswith(('/opt/review-activator-lab/ops/', '/etc/review-activator-dr/', INCOMING)) or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-' for c in path):
        raise Refused('UPLOAD_PATH_DENIED')
    code = f"import os,pathlib; p=pathlib.Path('{path}'); p.parent.mkdir(mode=0o700,parents=True,exist_ok=True); f=open(p,'{'wb' if replace else 'xb'}',opener=lambda p,f:os.open(p,f,{mode})); f.write(__import__('sys').stdin.buffer.read()); f.close(); os.chmod(p,{mode})"
    ssh('sudo /usr/bin/python3 -c "' + code + '"', data)


def write_report(name, obj):
    with (REPORT / name).open('x', encoding='utf8') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


def install():
    if not LOCAL.is_dir() or not REPORT.is_dir():
        raise Refused('PRIVATE_DIRECTORIES_MUST_BE_PROVISIONED')
    # Caller must first restrict Windows ACL; refuse when it is not protected.
    acl = subprocess.run(['icacls.exe', str(LOCAL)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout.decode(errors='replace')
    if '(I)' in acl or 'S-1-1-0' in acl or 'Everyone' in acl:
        raise Refused('WINDOWS_ACL_UNVERIFIED')
    key = AESGCM.generate_key(bit_length=256)
    with (LOCAL / 'keys/backup.key').open('xb') as f:
        f.write(key)
    upload('/etc/review-activator-dr/backup.key', key)
    del key
    for name in ('crypto_backup.py', 'dr.py', 'test_dr.py'):
        upload(REMOTE + 'vps07/' + name, (REPO / 'tools/vps07' / name).read_bytes(), 0o644)
    # Preserve the previous monitor source before the scoped extension.
    old = ssh('sudo /usr/bin/cat ' + REMOTE + 'vps05/ops.py')
    upload(REMOTE + 'vps05/ops.py.vps06', old)
    upload(REMOTE + 'vps05/ops.py', (REPO / 'tools/vps05/ops.py').read_bytes(), 0o644, replace=True)
    print('INSTALL_PASS')


def export():
    result = json.loads(ssh('sudo /usr/bin/python3 -B ' + REMOTE + 'vps07/dr.py build'))
    write_report('export-command.json', result)
    print(json.dumps(result))


def transfer():
    exported = json.loads((REPORT / 'export-command.json').read_text())
    remote = exported['directory'] + '/backup.aead'
    if not remote.startswith('/var/backups/review-activator-dr/') or any(c not in '0123456789TZ/abcdefghijklmnopqrstuvwxyz-.' for c in remote):
        raise Refused('DOWNLOAD_PATH_DENIED')
    data = ssh('sudo /usr/bin/cat ' + remote)
    verify_cipher(data, exported['sha256'], exported['size'])
    target = LOCAL / 'archives/backup.aead'
    with target.open('xb') as f:
        f.write(data)
    del data
    # Reopen independently; do not treat upload/download success as integrity.
    retrieved = target.read_bytes()
    verify_cipher(retrieved, exported['sha256'], exported['size'])
    receipt = {'destination_type': 'TEMPORARY_WINDOWS', 'independent_readback': True,
               'size': len(retrieved), 'sha256': hashlib.sha256(retrieved).hexdigest(),
               'archive_path': str(target), 'windows_acl': 'CURRENT_USER_AND_SYSTEM_ONLY',
               'automation': 'NOT_CONFIGURED'}
    upload(INCOMING + 'backup.aead', retrieved)
    upload(INCOMING + 'recovery.key', (LOCAL / 'keys/backup.key').read_bytes())
    upload(INCOMING + 'receipt.json', json.dumps(receipt).encode())
    write_report('transfer.json', receipt)
    print(json.dumps({'status': 'TRANSFER_AND_READBACK_PASS', 'size': len(retrieved), 'sha256': receipt['sha256']}))


def restore():
    result = json.loads(ssh('sudo /usr/bin/python3 -B ' + REMOTE + 'vps07/dr.py restore-retrieved'))
    write_report('restore-command.json', result)
    print(json.dumps(result))


def reports():
    for name in ('VPS07_EXPORT', 'VPS07_RESTORE', 'VPS07_OFFHOST', 'VPS05_MONITOR'):
        obj = json.loads(ssh('sudo /usr/bin/cat /var/lib/review-activator-ops/' + name + '.json'))
        write_report(name + '.json', obj)
    print('REPORTS_SAVED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=('install', 'export', 'transfer', 'restore', 'reports'))
    args = parser.parse_args()
    try:
        globals()[args.phase]()
    except Exception:
        print(json.dumps({'status': 'FAIL', 'phase': args.phase, 'code': 'TRANSFER_STOPPED_NO_RETRY'}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
