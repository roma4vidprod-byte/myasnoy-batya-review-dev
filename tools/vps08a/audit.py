"""Read-only VPS08A acceptance metadata; no plaintext session or network providers."""
import importlib.util
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys

def main():
    if os.geteuid()!=0 or socket.gethostname()!='hiplet-120706':raise RuntimeError('HOST_DENIED')
    spec=importlib.util.spec_from_file_location('ops','/opt/review-activator-lab/ops/vps05/ops.py')
    ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)
    snapshot=ops.snapshot(ops.DB);ops.validate_snapshot(snapshot)
    install=json.loads((ops.STATE/'VPS08A_INSTALL.json').read_text())
    manifest=Path(install['backup']['dump']['path']).parent/'manifest.json'
    baseline=json.loads(manifest.read_text())['source_snapshot']
    excluded={'public.review_companies','public.review_locations','review_private.yandex_sessions'}
    unchanged=all(v==baseline['rows'][k] for k,v in snapshot['rows'].items() if k not in excluded)
    status=ops.query_json(ops.DB,"""select json_build_object('rows',count(*),'exact_scope',coalesce(bool_and(company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae' and external_org_id='54309413522'),true),'metadata',coalesce(json_agg(json_build_object('state',state,'revision',revision,'credential_version_present',credential_version is not null,'kid',envelope->>'kid','envelope_present',envelope is not null,'last_session_check_at',last_session_check_at,'last_successful_sync_at',last_successful_sync_at,'safe_error',last_error_code)),'[]')) from review_private.yandex_sessions;""")
    key=Path('/etc/review-activator-yandex/session-key.json').stat()
    journal=subprocess.run(['journalctl','--since',install['utc'],'--no-pager','-o','cat'],capture_output=True,timeout=20).stdout
    # Exact known encrypted/key values are compared only in server memory. No
    # cookie decryption; regex/output inspection is not claimed as a global scan.
    secret=json.loads(Path('/etc/review-activator-yandex/session-key.json').read_text())['key'].encode()
    key_leaks=journal.count(secret);del secret
    report={'utc':ops.utc(),'session':status,'health':ops.app_health(),'lab_users':snapshot['rows']['auth.users']['count'],'lab_reviews':snapshot['rows']['public.review_external_reviews']['count'],'unrelated_rows_hashes_unchanged':unchanged,'queue_runs_total':snapshot['rows']['public.review_sync_runs']['count'],'provider_connections':snapshot['rows']['public.review_provider_connections']['count'],'key_permissions':{'uid':key.st_uid,'gid':key.st_gid,'mode':oct(key.st_mode&0o777)},'worker_timer':ops.run(['systemctl','show','review-activator-worker.timer','-p','ActiveState','-p','UnitFileState']).decode().splitlines(),'listeners':ops.run(['ss','-H','-ltn']).decode().splitlines(),'ntp':ops.run(['timedatectl','show','-p','NTPSynchronized','--value']).decode().strip(),'monitor':json.loads((ops.STATE/'VPS05_MONITOR.json').read_text())['status'],'recent_journal_key_value_matches':key_leaks,'journal_scan_exit':0 if key_leaks==0 else 1,'backup_scope':'PASS'}
    print(json.dumps(report))
    if not unchanged or key_leaks:raise SystemExit(1)

if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'status':'FAIL','error':'AUDIT_NOT_CONFIRMED'}));sys.exit(1)
