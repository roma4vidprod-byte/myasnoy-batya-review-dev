"""Pinned official static artifacts only; no container daemon, DB or service changes."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

DEST = Path('/opt/review-activator-lab/components')
AUTH_INDEX = 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'
AUTH_MANIFEST = 'sha256:7e813221b93fbf54b515036438550e483bfaf057b9db52fe9bc1ce91c47e817e'
PGRST_SHA = 'd6e13926457487c99b77366d795dcfa32700554d08d418131d9a4ea3f6ca25e3'

def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=90) as r:
        return r.read(180_000_000)

def verify(data, digest):
    assert hashlib.sha256(data).hexdigest() == digest.removeprefix('sha256:'), 'ARTIFACT_DIGEST_MISMATCH'
    return data

def save(rel, data, executable=False):
    target = DEST / rel
    assert not target.exists(), 'ARTIFACT_ALREADY_EXISTS'
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    with target.open('xb') as f:
        f.write(data)
    target.chmod(0o755 if executable else 0o644)
    return {'path': rel, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}

def main():
    assert os.geteuid() == 0
    assert not DEST.exists(), 'COMPONENT_DIRECTORY_ALREADY_EXISTS'
    mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    assert int(mem['MemAvailable'].split()[0]) > 2_000_000, 'RESOURCE_GATE_RAM'
    assert os.statvfs('/opt').f_bavail * os.statvfs('/opt').f_frsize > 5_000_000_000, 'RESOURCE_GATE_DISK'
    token = json.loads(get('https://auth.docker.io/token?service=registry.docker.io&scope=repository:supabase/gotrue:pull'))['token']
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.oci.image.manifest.v1+json,application/vnd.oci.image.index.v1+json'}
    base = 'https://registry-1.docker.io/v2/supabase/gotrue/'
    index = json.loads(verify(get(base + 'manifests/' + AUTH_INDEX, headers), AUTH_INDEX))
    assert any(m['digest'] == AUTH_MANIFEST and m['platform'] == {'architecture': 'amd64', 'os': 'linux'} for m in index['manifests'])
    manifest = json.loads(verify(get(base + 'manifests/' + AUTH_MANIFEST, headers), AUTH_MANIFEST))
    config = json.loads(verify(get(base + 'blobs/' + manifest['config']['digest'], headers), manifest['config']['digest']))
    assert config['architecture'] == 'amd64' and config['os'] == 'linux'
    files = []
    for layer in manifest['layers']:
        data = verify(get(base + 'blobs/' + layer['digest'], headers), layer['digest'])
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as tar:
            for member in tar:
                p = PurePosixPath(member.name)
                if '..' in p.parts or p.is_absolute() or not member.isfile():
                    continue
                name = str(p)
                if name == 'usr/local/bin/auth':
                    files.append(save('auth-v2.196.0/auth', tar.extractfile(member).read(), True))
                elif name.startswith('usr/local/etc/auth/migrations/') and name.endswith('.sql'):
                    files.append(save('auth-v2.196.0/migrations/' + p.name, tar.extractfile(member).read()))
    token = headers = None
    assert any(f['path'].endswith('/auth') for f in files) and len(files) > 50, 'AUTH_FILES_INCOMPLETE'
    data = verify(get('https://github.com/PostgREST/postgrest/releases/download/v14.17/postgrest-v14.17-linux-static-x86-64.tar.xz'), PGRST_SHA)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:xz') as tar:
        binaries = [m for m in tar if m.isfile() and PurePosixPath(m.name).name == 'postgrest']
        assert len(binaries) == 1
        files.append(save('postgrest-v14.17/postgrest', tar.extractfile(binaries[0]).read(), True))
    report = {'auth_tag': 'v2.196.0', 'auth_commit': '0204331ca41a5b49f076b6fa3dc6c0d20b996590',
              'auth_image': 'supabase/gotrue', 'auth_index_digest': AUTH_INDEX, 'auth_linux_amd64_digest': AUTH_MANIFEST,
              'postgrest_tag': 'v14.17', 'postgrest_commit': '064e5fea7bde63b0424fab53a0109c6f6016e95c',
              'postgrest_archive_sha256': PGRST_SHA, 'container_runtime': 'NONE_STATIC_BINARIES', 'files': files}
    save('VPS04_COMPONENTS.json', (json.dumps(report, indent=2) + '\n').encode())
    print(json.dumps({'artifacts': 'PASS', 'auth_files': len(files)-1, 'services_started': 0}))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('OFFICIAL_ARTIFACT_FETCH_FAILED; no service was started')
        raise SystemExit(1)
