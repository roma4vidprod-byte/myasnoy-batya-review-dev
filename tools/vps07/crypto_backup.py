"""Bounded AES-256-GCM container. No network, logging or secret arguments."""
import hashlib
import io
import json
import os
from pathlib import PurePosixPath
import tarfile
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b'RA-VPS07-AES256GCM-v1\x00'
LIMIT = 64 * 1024**2


class Refused(Exception):
    pass


def need(value, code):
    if not value:
        raise Refused(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encrypt(data, key):
    need(len(key) == 32, 'KEY_LENGTH_INVALID')
    need(0 < len(data) <= LIMIT, 'PAYLOAD_SIZE_INVALID')
    nonce = os.urandom(12)
    return MAGIC + nonce + AESGCM(key).encrypt(nonce, data, MAGIC)


def decrypt(data, key):
    need(len(key) == 32, 'KEY_LENGTH_INVALID')
    need(len(MAGIC)+28 < len(data) <= LIMIT+len(MAGIC)+28, 'CONTAINER_SIZE_INVALID')
    need(data.startswith(MAGIC), 'CONTAINER_VERSION_INVALID')
    try:
        return AESGCM(key).decrypt(data[len(MAGIC):len(MAGIC)+12], data[len(MAGIC)+12:], MAGIC)
    except InvalidTag:
        raise Refused('AUTHENTICATION_FAILED') from None


def verify_cipher(data, expected_hash, expected_size):
    need(len(data) == expected_size and digest(data) == expected_hash, 'OFFHOST_HASH_MISMATCH')


def safe_name(name):
    p = PurePosixPath(name)
    return bool(name) and not p.is_absolute() and '..' not in p.parts and '\\' not in name and ':' not in name and str(p) == name


def pack(files):
    need(all(safe_name(n) for n in files), 'ARCHIVE_NAME_INVALID')
    need('inventory.json' not in files and sum(len(v) for v in files.values()) < LIMIT-1024**2, 'ARCHIVE_LIMIT')
    inventory = {n: {'sha256': digest(v), 'size': len(v)} for n, v in files.items()}
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w') as tar:
        for name, data in {**files, 'inventory.json': json.dumps(inventory, sort_keys=True).encode()}.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o600
            tar.addfile(info, io.BytesIO(data))
    need(result.tell() <= LIMIT, 'ARCHIVE_LIMIT')
    return result.getvalue()


def unpack(data):
    """Authenticate first; inspect in memory, never extract paths to disk."""
    need(0 < len(data) <= LIMIT, 'ARCHIVE_LIMIT')
    files = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as tar:
            for m in tar:
                need(m.isfile() and safe_name(m.name) and m.name not in files, 'ARCHIVE_MEMBER_INVALID')
                need(0 <= m.size <= LIMIT and len(files) < 512, 'ARCHIVE_LIMIT')
                need(sum(len(v) for v in files.values()) + m.size <= LIMIT, 'ARCHIVE_LIMIT')
                files[m.name] = tar.extractfile(m).read()
        inventory = json.loads(files.pop('inventory.json'))
        need(set(inventory) == set(files), 'ARCHIVE_INVENTORY_MISMATCH')
        need(all(inventory[n] == {'sha256': digest(v), 'size': len(v)} for n, v in files.items()), 'ARCHIVE_HASH_MISMATCH')
    except (tarfile.TarError, KeyError, ValueError, TypeError):
        raise Refused('ARCHIVE_INVALID') from None
    return files
