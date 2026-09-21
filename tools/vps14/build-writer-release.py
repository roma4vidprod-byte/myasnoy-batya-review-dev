"""Build only committed allowlisted source; no credentials, SQL or scratch files."""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
FILES = [
 'package.json', 'lib/server/runtime-profile.js', 'lib/providers/yandex.js',
 'lib/server/yandex-reply-worker.js', 'lib/server/review-reply-approval.js',
 'lib/server/yandex-session/profile-context.js', 'lib/server/yandex-session/crypto.js',
 'lib/server/yandex-session/reply-contract.js', 'lib/server/yandex-session/reply-transport.js',
 'lib/server/yandex-session/transport.js', 'lib/server/yandex-session/network-diagnostic.js',
 'lib/server/yandex-session/csrf-contract.js', 'tools/vps14/reply-worker-store.mjs',
 'tools/vps14/writer-runtime.mjs', 'tools/vps14/writer-once.mjs',
 'tools/vps14/review-activator-reply.service', 'tools/vps14/writer-disabled.env',
 'tools/vps14/verify-writer-release.mjs'
]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, stderr=subprocess.PIPE)

def main():
    if len(sys.argv) != 2:
        raise ValueError('OUTPUT_DIRECTORY_REQUIRED')
    sha = git('rev-parse', 'HEAD').decode().strip()
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('INVALID_SHA')
    git('diff', '--exit-code', 'HEAD', '--', *FILES)
    blobs = {name: git('show', sha + ':' + name) for name in FILES}
    manifest = {'stage': 5, 'writeEnabled': False, 'sourceSha': sha,
        'files': {name: hashlib.sha256(data).hexdigest() for name, data in blobs.items()}}
    blobs['MANIFEST.json'] = (json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode()
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    archive = out / ('vps14-stage5-' + sha + '.tar')
    with tarfile.open(archive, 'x') as tar:
        for name, data in blobs.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))
    print(json.dumps({'ok': True, 'archive': str(archive), 'sourceSha': sha,
        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'files': len(FILES), 'writeEnabled': False}))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('{"ok":false,"code":"WRITER_PACKAGE_BUILD_FAILED"}')
        sys.exit(1)
