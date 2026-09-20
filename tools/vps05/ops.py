"""Fixed synthetic LAB operations. No credentials, external endpoints or business jobs.

Run explicitly as root on hiplet-120706. Dumps stay root-only on that host.
All child errors are reduced to fixed codes; never emit stderr/body/config.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone

DB = 'review_activator_lab'
RESTORE = 'review_activator_restore_test'
PG = '/usr/lib/postgresql/17/bin/'
ROOT = Path('/var/backups/review-activator')
STATE = Path('/var/lib/review-activator-ops')
RELEASE = Path('/opt/review-activator-lab/releases/vps04-initial')
SCHEMAS = ['auth', 'cron', 'public', 'review_private', 'vps_lab_private']
SERVICES = ['postgresql@17-main.service', 'review-lab-auth.service',
            'review-lab-api.service', 'review-activator-foundation.service']
RUNTIME_ROLES = ['anon', 'authenticated', 'service_role',
                 'ra_lab_authenticator', 'supabase_auth_admin']
MIN_FREE = 5 * 1024**3
stage = 'GUARD'


class SafeFailure(Exception):
    def __init__(self, code, exit_code=None):
        self.code, self.exit_code = code, exit_code


def need(condition, code):
    if not condition:
        raise SafeFailure(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def utc():
    return datetime.now(timezone.utc).isoformat()


def run(args, *, data=None, stdout=subprocess.PIPE, timeout=90, code='COMMAND_FAILED'):
    # No inherited PG options, cloud credentials or environment-based network routing.
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8',
           'PGHOST': '/var/run/postgresql', 'PGPORT': '5432', 'PGCONNECT_TIMEOUT': '5'}
    try:
        p = subprocess.run(args, input=data, stdout=stdout, stderr=subprocess.PIPE,
                           env=env, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SafeFailure(code) from None
    if p.returncode:
        raise SafeFailure(code, p.returncode)
    return p.stdout or b''


def pg(command, args, **kwargs):
    return run(['/usr/sbin/runuser', '-u', 'postgres', '--', PG + command, *args], **kwargs)


def sql(database, query, readonly=True):
    need(database in (DB, RESTORE, 'postgres'), 'DB_NOT_ALLOWLISTED')
    text = ('begin read only;\n' + query + '\nrollback;' if readonly else query)
    return pg('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-d', database],
              data=text.encode(), code='SQL_FAILED').decode().strip()


def query_json(database, query):
    return json.loads(sql(database, query))


def qident(s):
    return '"' + s.replace('"', '""') + '"'


def root_dir(path):
    if not path.exists():
        path.mkdir(mode=0o700, parents=True)
    st = path.lstat()
    need(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o700,
         'DIRECTORY_PERMISSIONS_INVALID')


def write_json(path, data, *, replace=False):
    with open(path, 'w' if replace else 'x', encoding='utf8', opener=lambda p, f: os.open(p, f, 0o600)) as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write('\n')


def metadata(path):
    st = path.lstat()
    need(stat.S_ISREG(st.st_mode), 'REGULAR_FILE_REQUIRED')
    return {'path': str(path), 'uid': st.st_uid, 'gid': st.st_gid,
            'mode': oct(stat.S_IMODE(st.st_mode)), 'size': st.st_size, 'sha256': file_hash(path)}


def guard():
    need(sys.platform == 'linux' and os.geteuid() == 0 and socket.gethostname() == 'hiplet-120706',
         'HOST_ROOT_GUARD')
    need(sql(DB, "select version from vps_lab_private.version;") == 'vps04-auth-api-v1',
         'LAB_VERSION_REQUIRED')
    need(sql(DB, "show server_version_num;") == '170011', 'PG_VERSION_GUARD')
    os.umask(0o077)
    root_dir(ROOT)
    root_dir(STATE)


def normalize_schema(data):
    # PG17.11 generates a random psql restriction token. Exclude only the two
    # corresponding client-control lines, not SQL/comments/ACL/owners/policies.
    return b'\n'.join(line for line in data.replace(b'\r\n', b'\n').split(b'\n')
                      if not line.startswith((b'\\restrict ', b'\\unrestrict ')))


def snapshot(database):
    schema = pg('pg_dump', ['--schema-only', '--no-password', database])
    tables = query_json(database, """
select json_agg(json_build_object('schema',n.nspname,'table',c.relname,
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
 order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and n.nspname in ('auth','cron','public','review_private','vps_lab_private');
""")
    rows = {}
    for t in tables:
        name = t['schema'] + '.' + t['table']
        ident = qident(t['schema']) + '.' + qident(t['table'])
        # Compute inside DB; plaintext/credential hashes never leave as row values.
        rows[name] = query_json(database, f"""select json_build_object('count',count(*),
 'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex'))
 from (select encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') h from {ident} t) s;""")
    counts = query_json(database, """
select json_build_object(
 'schemas',(select json_agg(nspname order by nspname) from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema'),
 'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','cron','public','review_private','vps_lab_private')),
 'constraints',(select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('auth','cron','public','review_private','vps_lab_private')),
 'indexes',(select count(*) from pg_indexes where schemaname in ('auth','cron','public','review_private','vps_lab_private')),
 'version',(select version from vps_lab_private.version),
 'synthetic_users_only',(select count(*)=3 and bool_and(lower(email) in ('owner@vps04.invalid','nonadmin@vps04.invalid','company-b@vps04.invalid')) from auth.users),
 'auth_users_valid',(select count(*) in (3,4)
   and count(*) filter(where lower(email)='owner@vps04.invalid')=1
   and count(*) filter(where lower(email)='nonadmin@vps04.invalid')=1
   and count(*) filter(where lower(email)='company-b@vps04.invalid')=1
   and count(*) filter(where lower(email)='tas.food@yandex.ru') in (0,1)
   and bool_and(lower(email) in ('owner@vps04.invalid','nonadmin@vps04.invalid','company-b@vps04.invalid','tas.food@yandex.ru'))
   from auth.users),
 'operator_enabled',(select count(*)=1 from auth.users where lower(email)='tas.food@yandex.ru'),
 'operator_scope_valid',(select case
   when exists(select 1 from auth.users where lower(email)='tas.food@yandex.ru') then
     (select count(*)=1 and bool_and(a.role='owner' and a.active and lower(a.email)='tas.food@yandex.ru')
      from public.review_admins a join auth.users u on u.id=a.user_id where lower(u.email)='tas.food@yandex.ru')
     and
     (select count(*)=1 and bool_and(m.company_id='13f3cb80-487a-4a19-96a1-fb3103200230')
      from vps_lab_private.memberships m join auth.users u on u.id=m.user_id where lower(u.email)='tas.food@yandex.ru')
   else true end),
 'synthetic_reviews_only',(select count(*)=2 and bool_and(external_location_id in ('lab-org-a','lab-org-b') and company_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')) from public.review_external_reviews));
""")
    # VPS08A adds ONLY the approved catalog scope and encrypted session. Preserve
    # the synthetic-user/review guard and all other empty-business-table guards.
    if 'vps_yandex_private' in counts['schemas']:
        counts['vps08a_scope'] = query_json(database, """select json_build_object(
 'companies_valid',(select count(*)=3 and bool_and(id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','13f3cb80-487a-4a19-96a1-fb3103200230')) from public.review_companies),
 'locations_valid',(select count(*)=1 and bool_and(company_id='13f3cb80-487a-4a19-96a1-fb3103200230') from public.review_locations where id='9a95f63b-18e6-447b-a449-8530b67ddbae'),
 'session_count',(select count(*) from review_private.yandex_sessions),
 'session_scope_valid',(select coalesce(bool_and(company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae' and external_org_id='54309413522'),true) from review_private.yandex_sessions));""")
        if sql(database,"select to_regprocedure('vps_yandex_private.persist_call(uuid,uuid,text,text,bigint,text,jsonb)') is not null;") == 't':
            counts['vps09_persistence'] = query_json(database, """with classified as (
 select *, (company_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')
   and external_location_id in ('lab-org-a','lab-org-b')) as synthetic,
 (company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'
   and provider='yandex' and external_location_id='54309413522') as approved_real from public.review_external_reviews
) select json_build_object('synthetic_count',count(*) filter(where synthetic),
 'real_count',count(*) filter(where approved_real),'unexpected_count',count(*) filter(where (synthetic or approved_real) is not true),
 'ratings_valid',coalesce(bool_and(rating between 1 and 5) filter(where approved_real),true)) from classified;""")
    counts['reply_actions_scope'] = query_json(database, """select json_build_object(
 'count',count(*),
 'scope_valid',coalesce(bool_and(
   a.company_id='13f3cb80-487a-4a19-96a1-fb3103200230'
   and a.provider='yandex'
   and r.id=a.external_review_row_id
   and r.company_id=a.company_id
   and r.location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'
   and r.provider=a.provider
   and r.external_location_id='54309413522'
   and r.external_review_id=a.external_review_id
 ),true),
 'status_valid',coalesce(bool_and(a.status in ('DRAFT','QUEUED','SENDING','SENT','FAILED','CANCELLED')),true),
 'active_count',count(*) filter(where a.status in ('DRAFT','QUEUED','SENDING'))
) from public.review_reply_actions a
left join public.review_external_reviews r on r.id=a.external_review_row_id;""")
    return {'schema_sha256': sha(normalize_schema(schema)), 'tables': tables,
            'rows': rows, 'catalog': counts}


def validate_snapshot(s):
    extra = s['catalog'].get('vps08a_scope')
    schemas = SCHEMAS + (['vps_yandex_private'] if extra is not None else [])
    need(s['catalog']['schemas'] == schemas and s['catalog']['version'] == 'vps04-auth-api-v1', 'SCHEMA_SCOPE_FAILED')
    real = s['catalog'].get('vps09_persistence')
    operator_enabled = s['catalog'].get('operator_enabled', False)
    auth_users_valid = s['catalog'].get('auth_users_valid', s['catalog'].get('synthetic_users_only') is True)
    operator_scope_valid = s['catalog'].get('operator_scope_valid', not operator_enabled)
    need(auth_users_valid and type(operator_enabled) is bool and operator_scope_valid is True,
         'AUTH_SCOPE_FAILED')
    reply_row_count = s.get('rows', {}).get('public.review_reply_actions', {}).get('count', 0)
    reply_scope = s['catalog'].get('reply_actions_scope')
    if reply_scope is None:
        reply_scope = {'count': reply_row_count, 'scope_valid': reply_row_count == 0,
                       'status_valid': reply_row_count == 0, 'active_count': 0}
    need(type(reply_row_count) is int and reply_row_count >= 0 and
         type(reply_scope.get('count')) is int and reply_scope['count'] == reply_row_count and
         reply_scope.get('scope_valid') is True and reply_scope.get('status_valid') is True and
         type(reply_scope.get('active_count')) is int and
         0 <= reply_scope['active_count'] <= reply_row_count,
         'REPLY_ACTION_SCOPE_FAILED')
    if real is None:
        need(s['catalog']['synthetic_reviews_only'], 'SYNTHETIC_SCOPE_FAILED')
    else:
        need(extra is not None and real['synthetic_count']==2 and real['unexpected_count']==0 and
             type(real['real_count']) is int and real['real_count']>=0 and real['ratings_valid'] is True,
             'VPS09_REVIEW_SCOPE_FAILED')
    operator_delta = 1 if operator_enabled else 0
    expected = {'auth.users': 3 + operator_delta, 'public.review_companies': 2, 'public.review_locations': 2,
                'public.review_admins': 2 + operator_delta, 'public.review_external_reviews': 2,
                'public.review_provider_connections': 0, 'public.review_sync_runs': 0,
                'review_private.yandex_sessions': 0, 'cron.job': 0}
    if extra is not None:
        need(extra['companies_valid'] is True and extra['locations_valid'] is True and
             extra['session_scope_valid'] is True and type(extra['session_count']) is int and
             extra['session_count'] in (0, 1), 'VPS08A_SCOPE_FAILED')
        expected.update({'public.review_companies': 3, 'public.review_locations': 3,
                         'review_private.yandex_sessions': extra['session_count']})
    if real is not None:
        expected['public.review_external_reviews'] = 2 + real['real_count']
    if 'public.review_reply_actions' in s['rows']:
        expected['public.review_reply_actions'] = reply_row_count
    for name, count in expected.items():
        need(s['rows'][name]['count'] == count, 'ROW_COUNTS_FAILED')
    nonempty_app = {'public.review_companies', 'public.review_locations', 'public.review_admins',
                    'public.review_external_reviews', 'public.review_reply_actions'}
    if extra is not None:
        nonempty_app.add('review_private.yandex_sessions')
    for name, info in s['rows'].items():
        if name.startswith(('public.', 'review_private.', 'cron.')) and name not in nonempty_app:
            need(info['count'] == 0, 'UNEXPECTED_BUSINESS_ROWS')
    for t in s['tables']:
        if t['schema'] in ('public', 'review_private', 'vps_lab_private'):
            need(t['rls'] and t['owner'] == 'postgres', 'APP_RLS_OWNER_FAILED')
        if t['schema'] == 'review_private':
            need(t['force'], 'PRIVATE_FORCE_RLS_FAILED')
        if t['schema'] == 'auth':
            need(t['owner'] == 'supabase_auth_admin', 'AUTH_OWNER_FAILED')


def normalize_snapshot_contract(s):
    # Backward-compatible with pre-VPS11 backup manifests: the approved operator
    # fields are additive and default to the historical synthetic-only state.
    catalog = dict(s['catalog'])
    catalog.setdefault('auth_users_valid', catalog.get('synthetic_users_only') is True)
    catalog.setdefault('operator_enabled', False)
    catalog.setdefault('operator_scope_valid', True)
    reply_count = s.get('rows', {}).get('public.review_reply_actions', {}).get('count', 0)
    catalog.setdefault('reply_actions_scope', {
        'count': reply_count,
        'scope_valid': reply_count == 0,
        'status_valid': reply_count == 0,
        'active_count': 0,
    })
    return {**s, 'catalog': catalog}


def compare(source, restored):
    source = normalize_snapshot_contract(source)
    restored = normalize_snapshot_contract(restored)
    validate_snapshot(source)
    validate_snapshot(restored)
    need(source == restored, 'RESTORE_SNAPSHOT_MISMATCH')
    return {'schema_equal': True, 'catalog_owners_acl_rls_equal': True, 'all_table_counts_hashes_equal': True,
            'source_schema_sha256': source['schema_sha256'], 'restored_schema_sha256': restored['schema_sha256'],
            'schema_exclusions': ['psql restriction control token lines'],
            'data_exclusions': [], 'database_name_oid_and_database_connect_acl': 'SEPARATE_TARGET_NOT_COMPARED'}


def disk_guard(free, db_size):
    # Reserve 5 GiB after conservative twice-database-size budget (+256 MiB).
    need(free - (2 * db_size + 256 * 1024**2) >= MIN_FREE, 'BACKUP_DISK_GUARD')


def http_status(path):
    need(path in ('/healthz', '/readyz'), 'HTTP_PATH_DENIED')
    conn = http.client.HTTPConnection('127.0.0.1', 13000, timeout=5)
    try:
        conn.request('GET', path)
        r = conn.getresponse()
        return r.status  # Never read or print body; no redirect/proxy/retry.
    except (OSError, http.client.HTTPException):
        return None
    finally:
        conn.close()


def app_health():
    return {p[1:]: http_status(p) for p in ('/healthz', '/readyz')}


def inventory():
    secret_paths = [Path('/etc/review-activator-lab') / n for n in
                    ('auth.env', 'api.env', 'node.env', 'bootstrap.json', 'synthetic-users.json')]
    secrets = [metadata(p) for p in secret_paths]
    need(all(x['uid'] == 0 and x['mode'] == '0o600' for x in secrets), 'CONFIG_PERMISSIONS_FAILED')
    services = {}
    for service in SERVICES:
        properties = run(['systemctl', 'show', service, '-p', 'User', '-p', 'FragmentPath',
                          '-p', 'DropInPaths', '-p', 'WorkingDirectory', '-p', 'ActiveState', '-p', 'UnitFileState']).decode()
        services[service] = dict(line.split('=', 1) for line in properties.splitlines() if '=' in line)
    roles = query_json(DB, """select json_agg(json_build_object('name',rolname,'login',rolcanlogin,
 'superuser',rolsuper,'bypassrls',rolbypassrls,'createdb',rolcreatedb,'createrole',rolcreaterole,
 'inherit',rolinherit) order by rolname) from pg_roles where rolname not like 'pg_%';""")
    members = query_json(DB, """select coalesce(json_agg(json_build_object('role',r.rolname,'member',m.rolname,
 'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) order by r.rolname,m.rolname),'[]')
 from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member
 where m.rolname not like 'pg_%';""")
    return {'profile': 'vps-lab', 'release_path': str(RELEASE), 'active_release': str(RELEASE.resolve()),
            'services': services, 'secret_config_metadata_only': secrets, 'roles_without_passwords': roles,
            'role_memberships': members, 'node': run(['/opt/node/bin/node', '--version']).decode().strip(),
            'auth': run(['/opt/review-activator-lab/components/auth-v2.196.0/auth', 'version']).decode().strip(),
            'postgrest': run(['/opt/review-activator-lab/components/postgrest-v14.17/postgrest', '--version']).decode().strip(),
            'pg_dump': pg('pg_dump', ['--version']).decode().strip(), 'server_version_num': sql(DB, 'show server_version_num;'),
            'listeners': run(['ss', '-H', '-lnt']).decode().splitlines()}


def backup():
    global stage
    stage = 'BACKUP_PREFLIGHT'
    before = snapshot(DB)
    validate_snapshot(before)
    free = shutil.disk_usage(ROOT).free
    size = int(sql(DB, 'select pg_database_size(current_database());'))
    disk_guard(free, size)
    dest = ROOT / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    dest.mkdir(mode=0o700)  # collision refuses; no overwrite, retention or delete
    stage = 'DUMP'
    dump = dest / 'review_activator_lab.dump'
    with open(dump, 'xb', opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        pg('pg_dump', ['--format=custom', '--no-password', '--lock-wait-timeout=5s', DB], stdout=stream, timeout=180, code='DUMP_FAILED')
    need(shutil.disk_usage(ROOT).free >= MIN_FREE, 'POST_BACKUP_DISK_GUARD')
    stage = 'CONFIG_MANIFEST'
    inv = inventory()
    manifest = json.loads((RELEASE / 'VPS04_RELEASE.json').read_text())
    for entry in manifest['files']:
        p = RELEASE / entry['path']
        need(p.resolve().is_relative_to(RELEASE) and not p.is_symlink() and file_hash(p) == entry['sha256'], 'RELEASE_HASH_FAILED')
    # Copy only the verified application release; never /etc or credentials.
    with tarfile.open(dest / 'release.tar.gz', 'x:gz') as tar:
        for e in manifest['files']:
            tar.add(RELEASE / e['path'], arcname=e['path'], recursive=False)
        tar.add(RELEASE / 'VPS04_RELEASE.json', arcname='VPS04_RELEASE.json', recursive=False)
    os.chmod(dest / 'release.tar.gz', 0o600)
    config = []
    for svc, props in inv['services'].items():
        for p in [props['FragmentPath'], *props.get('DropInPaths', '').split()]:
            if not p:
                continue
            # Preserve safe structural systemd directives, never inline environment.
            lines = Path(p).read_text().splitlines()
            safe_keys = ('[', 'Description=', 'After=', 'Before=', 'Requires=', 'Wants=', 'User=',
                         'Group=', 'WorkingDirectory=', 'EnvironmentFile=', 'MemoryMax=', 'Type=',
                         'Restart=', 'WantedBy=', 'ProtectSystem=', 'ProtectHome=', 'PrivateTmp=',
                         'NoNewPrivileges=', 'IPAddressAllow=', 'IPAddressDeny=', 'ReadWritePaths=')
            config.append({'service': svc, **metadata(Path(p)),
                           'safe_directives': [x for x in lines if x.startswith(safe_keys)],
                           'full_secret_free_unit_restore': 'MANUAL_REVIEW_REQUIRED'})
    write_json(dest / 'configuration.json', {'inventory': inv, 'units': config})
    for name in ('VPS04_SCHEMA.json', 'components/VPS04_COMPONENTS.json'):
        p = Path('/opt/review-activator-lab') / name
        # Existing safe provenance manifests only; no bootstrap/env/user material.
        write_json(dest / p.name, json.loads(p.read_text()))
    after = snapshot(DB)
    need(before == after, 'SOURCE_CHANGED_DURING_BACKUP')
    result = {'status': 'BACKUP_CREATED_RESTORE_PENDING', 'utc': utc(), 'database': DB, 'format': 'custom',
              'dump': metadata(dump), 'release_archive': metadata(dest / 'release.tar.gz'), 'directory_mode': '0o700',
              'disk_free_before': free, 'disk_free_after': shutil.disk_usage(ROOT).free,
              'database_size': size, 'source_snapshot': before, 'inventory': inv,
              'classification': 'LOCAL_BACKUP_ONLY', 'disaster_recovery': 'NOT_CONFIGURED',
              'data_classification': 'SENSITIVE'}
    write_json(dest / 'manifest.json', result)
    write_json(STATE / 'VPS05_BACKUP.json', result, replace=True)
    return result


def restored_security():
    roles = query_json(RESTORE, """select json_agg(json_build_object('role',rolname,
 'safe',not(rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)) order by rolname)
 from pg_roles where rolname in ('anon','authenticated','service_role','ra_lab_authenticator','supabase_auth_admin');""")
    need(len(roles) == 5 and all(r['safe'] for r in roles), 'RUNTIME_ROLE_PRIVILEGES_FAILED')
    acl = query_json(RESTORE, """select json_build_object(
 'private_schema_denied',not exists(select 1 from unnest(array['anon','authenticated','service_role','ra_lab_authenticator']) r where has_schema_privilege(r,'review_private','USAGE')),
 'recovery_execute_denied',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role','ra_lab_authenticator']) r where n.nspname='review_private' and has_function_privilege(r,p.oid,'EXECUTE')),
 'auth_table_denied',not has_table_privilege('authenticated','auth.users','SELECT'),
 'private_memberships_denied',not has_table_privilege('authenticated','vps_lab_private.memberships','SELECT'),
 'raw_payload_denied',not has_column_privilege('authenticated','public.review_external_reviews','raw_payload','SELECT'));
""")
    need(all(acl.values()), 'RESTORE_ACL_FAILED')
    no_subject_rows = int(sql(RESTORE, 'set local role authenticated; select count(id) from public.review_external_reviews;'))
    need(no_subject_rows == 0, 'RLS_NO_SUBJECT_FAILED')
    denied = {}
    for role in ('anon', 'authenticated', 'service_role'):
        # Actual read-only permission refusal, not calling any recovery function.
        p = subprocess.run(['/usr/sbin/runuser', '-u', 'postgres', '--', PG+'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
                            '-v', 'VERBOSITY=sqlstate', '-h', '/var/run/postgresql', '-p', '5432', '-d', RESTORE],
                           input=f'begin read only; set local role {role}; select count(*) from review_private.yandex_sessions; rollback;'.encode(),
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
                           env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        denied[role] = p.returncode != 0 and b'42501' in p.stderr
    need(all(denied.values()), 'PRIVATE_READ_DENIAL_FAILED')
    return {'roles': roles, 'acl': acl, 'rls_no_subject_rows': no_subject_rows, 'actual_private_select_denied': denied}


def checked_manifest(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve().parent.parent == ROOT and path.name == 'manifest.json'
         and not path.is_symlink(), 'BACKUP_PATH_INVALID')
    root_dir(path.parent)
    m = json.loads(path.read_text())
    need(m['database'] == DB and m['format'] == 'custom', 'MANIFEST_SCOPE_INVALID')
    dump = path.parent / 'review_activator_lab.dump'
    actual = metadata(dump)
    need(actual == m['dump'] and actual['uid'] == 0 and actual['mode'] == '0o600', 'BACKUP_HASH_OR_PERMISSIONS_FAILED')
    return m, dump


def restore(path):
    global stage
    stage = 'RESTORE_GUARD'
    manifest, dump = checked_manifest(path)
    need(sql('postgres', f"select count(*) from pg_database where datname='{RESTORE}';") == '0', 'RESTORE_TARGET_EXISTS')
    source = snapshot(DB)
    compare(manifest['source_snapshot'], source)
    disk_guard(shutil.disk_usage(ROOT).free, manifest['database_size'])
    result = {'utc': utc(), 'source_database': DB, 'target_database': RESTORE, 'backup_sha256': manifest['dump']['sha256'],
              'status': 'FAIL', 'cleanup': 'NOT_CREATED'}
    created = False
    try:
        stage = 'CREATE_ISOLATED_DB'
        pg('createdb', ['--template=template0', '--owner=postgres', RESTORE])
        created = True
        sql(RESTORE, f'REVOKE ALL ON DATABASE {RESTORE} FROM PUBLIC;', readonly=False)
        stage = 'RESTORE'
        # Root opens sensitive dump; postgres only receives inherited stdin, not path access.
        with open(dump, 'rb') as stream:
            p = subprocess.run(['/usr/sbin/runuser', '-u', 'postgres', '--', PG+'pg_restore', '--exit-on-error',
                                '--single-transaction', '--no-password', '-h', '/var/run/postgresql', '-p', '5432', '-d', RESTORE],
                               stdin=stream, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                               env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        result['restore_exit_code'] = p.returncode
        need(p.returncode == 0, 'RESTORE_COMMAND_FAILED')
        stage = 'VERIFY_RESTORE'
        restored = snapshot(RESTORE)
        result['comparison'] = compare(source, restored)
        result['security'] = restored_security()
        result['restored_snapshot'] = restored
        result['status'] = 'PASS'
    except SafeFailure as e:
        result['error'] = e.code
        result['failure_stage'] = stage
    finally:
        if created:
            # Fixed freshly-created target only, never --force or source DB.
            pg('dropdb', ['--no-password', RESTORE], code='RESTORE_CLEANUP_FAILED')
            result['cleanup'] = 'PASS' if sql('postgres', f"select count(*) from pg_database where datname='{RESTORE}';") == '0' else 'FAIL'
        after = snapshot(DB)
        result['source_unchanged'] = source == after
        result['health'] = app_health()
        if not result['source_unchanged'] or result['cleanup'] != 'PASS' or any(v != 200 for v in result['health'].values()):
            result['status'] = 'FAIL'
        write_json(STATE / 'VPS05_RESTORE.json', result)
        if 'comparison' in result:
            write_json(STATE / 'VPS05_SCHEMA_COMPARE.json', result['comparison'])
    need(result['status'] == 'PASS', result.get('error', 'RESTORE_ACCEPTANCE_FAILED'))
    return result


def listener_evaluation(lines):
    expected_internal = {('127.0.0.1', p) for p in (5432, 19999, 13001, 13000)}
    allowed = expected_internal | {('127.0.0.53', 53), ('127.0.0.54', 53), ('0.0.0.0', 22), ('::', 22), ('*', 22)}
    observed = set()
    for line in lines:
        fields = line.split()
        need(len(fields) >= 5, 'LISTENER_PARSE_FAILED')
        address, port = fields[3].rsplit(':', 1)
        address = address.strip('[]').split('%')[0]
        observed.add((address, int(port)))
    return not (observed - allowed) and expected_internal <= observed and any(p == 22 for _, p in observed)


def worker_observation():
    """Read status only; never start/trigger the worker or query queue/database."""
    unit = 'review-activator-worker.service'
    if run(['systemctl', 'show', unit, '-p', 'LoadState', '--value']).decode().strip() == 'not-found':
        return {'installed': False}
    def prop(name, key):
        return run(['systemctl', 'show', name, '-p', key, '--value']).decode().strip()
    def read_status(name):
        try:
            value = json.loads((Path('/var/lib/review-activator-worker') / name).read_text())
            stamp = value.get('finished_at')
            if not isinstance(stamp, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', stamp):
                return {}
            return {'finished_at': stamp, 'ok': value.get('ok') is True,
                    'lock_refused': value.get('code') == 'ALREADY_RUNNING'}
        except (OSError, ValueError, TypeError):
            return {}
    latest, success = read_status('latest.json'), read_status('success.json')
    return {'installed': True, 'service_result': prop(unit, 'Result'),
            'service_state': prop(unit, 'ActiveState'),
            'timer_state': prop('review-activator-worker.timer', 'ActiveState'),
            'timer_enabled': prop('review-activator-worker.timer', 'UnitFileState'),
            'last_execution': latest.get('finished_at'), 'last_ok': latest.get('ok'),
            'lock_refused': latest.get('lock_refused'),
            'last_success': success.get('finished_at')}


def offhost_observation():
    """Last verified receipt, not a live remote check. Never read key contents."""
    key = Path('/etc/review-activator-dr/backup.key')
    receipt = STATE / 'VPS07_OFFHOST.json'
    if not key.parent.exists() and not receipt.exists():
        return {'configured': False}
    result = {'configured': True, 'mode': 'TEMPORARY_MANUAL', 'automation': 'NOT_CONFIGURED',
              'remote_presence': 'NOT_LIVE_CHECKED', 'key_metadata_ok': False,
              'receipt_present': False, 'hash_verified': False, 'restore_pass': False, 'age_seconds': None}
    try:
        st = key.lstat()
        result['key_metadata_ok'] = stat.S_ISREG(st.st_mode) and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o600 and st.st_size == 32
        r = receipt.lstat()
        need(stat.S_ISREG(r.st_mode) and r.st_uid == 0 and stat.S_IMODE(r.st_mode) == 0o600 and r.st_size < 16384, 'OFFHOST_RECEIPT_INVALID')
        value = json.loads(receipt.read_text())
        stamp = datetime.fromisoformat(value['verified_at'])
        need(stamp.tzinfo is not None, 'OFFHOST_TIMESTAMP_INVALID')
        result.update(receipt_present=True, hash_verified=value.get('hash_verified') is True,
                      restore_pass=value.get('restore') == 'PASS' and value.get('status') == 'PASS',
                      age_seconds=int(time.time()-stamp.timestamp()))
    except (OSError, ValueError, KeyError, SafeFailure):
        pass
    return result


def provider_observation():
    # Root-owned aggregate receipt only. No DB/provider requests, no raw rows.
    path = STATE / 'VPS09_LAST_SYNC.json'
    if not path.exists(): return {'configured': False}
    result = {'configured': True, 'receipt_valid': False}
    try:
        s=path.lstat()
        need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<8192,'PROVIDER_RECEIPT_INVALID')
        value=json.loads(path.read_text())
        for key in ('last_successful_provider_read','last_successful_persistence'):
            stamp=value.get(key)
            if stamp is not None: need(isinstance(stamp,str) and datetime.fromisoformat(stamp).tzinfo is not None,'PROVIDER_RECEIPT_INVALID')
            result[key]=stamp
        need(value.get('last_sync_result') in ('PASS','FAIL','IN_PROGRESS'),'PROVIDER_RECEIPT_INVALID')
        need(type(value.get('real_review_count')) is int and value['real_review_count']>=0,'PROVIDER_RECEIPT_INVALID')
        need(value.get('sync_failure') in (None,'SYNC_NOT_CONFIRMED'),'PROVIDER_RECEIPT_INVALID')
        result.update({k:value[k] for k in ('last_sync_result','real_review_count','sync_failure')})
        result['receipt_valid']=True
    except (OSError,ValueError,KeyError,TypeError,SafeFailure): pass
    return result


def evaluate_monitor(sample):
    failures = []
    rules = {'DISK_LOW': sample['disk_free'] >= MIN_FREE, 'RAM_LOW': sample['ram_available'] >= 256*1024**2,
             'LOAD_HIGH': sample['load1'] <= sample['cpus'] * 2, 'FAILED_UNITS': sample['failed_units'] == 0,
             'SERVICE_DOWN': all(v == 'active' for v in sample['services'].values()),
             'HEALTHZ_FAILED': sample['health']['healthz'] == 200, 'READYZ_FAILED': sample['health']['readyz'] == 200,
             'LISTENER_MISMATCH': listener_evaluation(sample['listeners']),
             'BACKUP_GROWTH': sample['backup_bytes'] <= 5*1024**3,
             'BACKUP_STALE': sample['backup_age_seconds'] is not None and sample['backup_age_seconds'] <= 36*3600}
    worker = sample.get('worker', {})
    provider = sample.get('provider', {})
    if provider.get('configured'):
        rules['PROVIDER_SYNC_RECEIPT'] = provider.get('receipt_valid') is True
        rules['PROVIDER_SYNC_FAILED'] = provider.get('last_sync_result') == 'PASS' and provider.get('sync_failure') is None
    offhost = sample.get('offhost', {})
    if offhost.get('configured'):
        rules['OFFHOST_KEY_CONFIG'] = offhost.get('key_metadata_ok') is True and offhost.get('receipt_present') is True
        rules['OFFHOST_VERIFY_FAILED'] = offhost.get('hash_verified') is True and offhost.get('restore_pass') is True
        age = offhost.get('age_seconds')
        rules['OFFHOST_BACKUP_STALE'] = isinstance(age, int) and 0 <= age <= 36*3600
    if worker.get('installed'):
        rules['WORKER_FAILED'] = worker.get('service_result') == 'success' and worker.get('last_ok') is True
        # Disabled timer is the intended safe business state, not a monitoring failure.
        rules['WORKER_TIMER_STATE'] = worker.get('timer_state') in ('active', 'inactive')
    failures.extend(k for k, passed in rules.items() if not passed)
    return {'status': 'PASS' if not failures else 'FAIL', 'codes': failures, 'checks': rules, 'sample': sample}


def monitor():
    # No DB connection or secret config read; metrics and two fixed local HTTP endpoints.
    need(sys.platform == 'linux' and os.geteuid() == 0 and socket.gethostname() == 'hiplet-120706', 'HOST_ROOT_GUARD')
    root_dir(ROOT)
    root_dir(STATE)
    mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    files = [p for p in ROOT.rglob('*') if p.is_file() and not p.is_symlink()]
    manifests = [p for p in files if p.name == 'manifest.json']
    services = {}
    for name in SERVICES:
        # systemctl show returns a status string even for an inactive service.
        services[name] = run(['systemctl', 'show', name, '-p', 'ActiveState', '--value']).decode().strip()
    sample = {'utc': utc(), 'disk_free': shutil.disk_usage(ROOT).free,
              'ram_available': int(mem['MemAvailable'].split()[0])*1024, 'load1': os.getloadavg()[0], 'cpus': os.cpu_count(),
              'failed_units': len(run(['systemctl', '--failed', '--no-legend', '--plain', '--no-pager']).decode().splitlines()),
              'services': services, 'health': app_health(), 'listeners': run(['ss', '-H', '-lnt']).decode().splitlines(),
              'backup_bytes': sum(p.stat().st_size for p in files),
              'backup_age_seconds': int(time.time()-max(p.stat().st_mtime for p in manifests)) if manifests else None,
              'worker': worker_observation(), 'offhost': offhost_observation(), 'provider': provider_observation()}
    result = evaluate_monitor(sample)
    # Atomic replacement avoids readers seeing a partially-written monitor status.
    temp = STATE / 'monitor-pending.json'
    write_json(temp, result, replace=True)
    os.replace(temp, STATE / 'VPS05_MONITOR.json')
    return result


def main():
    global stage
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=('backup', 'restore', 'monitor'))
    parser.add_argument('--manifest')
    args = parser.parse_args()
    try:
        if args.operation == 'monitor':
            result = monitor()
        else:
            guard()
            result = backup() if args.operation == 'backup' else restore(args.manifest or '')
        # Reports are safe; never dump subprocess output/config/database payload.
        print(json.dumps({'operation': args.operation, 'status': result['status'],
                          'codes': result.get('codes', []), 'external_actions': 0}))
        return 0 if result['status'] in ('PASS', 'BACKUP_CREATED_RESTORE_PENDING') else 1
    except SafeFailure as e:
        print(json.dumps({'status': 'FAIL', 'stage': stage, 'code': e.code, 'exit_code': e.exit_code}))
        return 1
    except Exception:
        print(json.dumps({'status': 'FAIL', 'stage': stage, 'code': 'OPS_INTERNAL_FAILURE'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
