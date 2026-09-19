"""Additional native RPC edge cases; fixture mutations are confined to VPS06 UUIDs."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys

spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('native.py'))
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)


def main():
    assert os.geteuid() == 0 and socket.gethostname() == 'hiplet-120706'
    result = []
    try:
        n.fixture(jobs=1, due=True)
        stamp = n.sql(f"select next_sync_at from public.review_provider_connections where id='{n.CONNECTION}';")
        for _ in range(2):
            assert n.sql(f"select public.review_enqueue_due_syncs('{n.COMPANY}');",worker=True) == '0'
        assert n.counts()['queued'] == 1
        assert stamp == n.sql(f"select next_sync_at from public.review_provider_connections where id='{n.CONNECTION}';")
        result.append({'name':'due_active_job_dedupe','status':'PASS','new_jobs':0,'next_sync_unchanged':True})
        claimed = json.loads(n.sql(f"select public.review_claim_next_sync_run('{n.COMPANY}');",worker=True))
        assert claimed['claimed']
        failed = json.loads(n.sql(f"select public.review_fail_sync_run('{n.COMPANY}','{n.RUN}','SYNC_OPERATION_FAILED');",worker=True))
        assert failed['status'] == 'FAILED'
        assert n.sql(f"select public.review_fail_sync_run('{n.COMPANY}','{n.RUN}','SYNC_OPERATION_FAILED');",worker=True,expected=1) == 'DENIED'
        assert n.counts()['failed'] == 1
        result.append({'name':'fail_once_duplicate_denied','status':'PASS'})
        n.fixture(jobs=1)
        n.sql(f"select public.review_claim_next_sync_run('{n.COMPANY}');",worker=True)
        summary = '{"pages_fetched":0,"fetched_count":0,"inserted":0,"updated":0,"unchanged":0,"seen":0}'
        for query in [f"select public.review_complete_sync_run('{n.COMPANY}','{n.RUN}',null);",
            f"select public.review_complete_sync_run(null,'{n.RUN}','{summary}');",
            f"select public.review_complete_sync_run('10000000-0000-4000-8000-000000000001','{n.RUN}','{summary}');"]:
            assert n.sql(query,worker=True,expected=1) == 'DENIED'
        assert n.counts()['running'] == 1 and n.counts()['succeeded'] == 0
        result.append({'name':'complete_null_wrong_scope_denied','status':'PASS','denials':3})
        # No provider fixture keys can be modified by the worker's least-privilege role.
        assert n.sql(f"update public.review_provider_connections set config='{{}}' where id='{n.CONNECTION}';",worker=True,expected=1) == 'DENIED'
        result.append({'name':'worker_cannot_change_provider_config','status':'PASS'})
    finally:
        n.clean()
        n.system('start',n.UNIT)
    Path('/var/lib/review-activator-ops/vps06/contracts.json').write_text(json.dumps({'status':'PASS','tests':result},indent=2))
    print(json.dumps({'status':'PASS','tests':len(result),'cleanup':n.counts()}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        print('{"status":"FAIL","code":"NATIVE_CONTRACT_ASSERTION_FAILED"}')
        sys.exit(1)
