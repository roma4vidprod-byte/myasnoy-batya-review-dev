"""Offline targeted tests, synthetic bytes only. No DB/SSH/provider effects."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import crypto_backup as c
import dr

spec = importlib.util.spec_from_file_location('previous_tests', Path(__file__).resolve().parent.parent / 'vps05/test_ops.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)


class Encryption(unittest.TestCase):
    def setUp(self):
        self.key = c.AESGCM.generate_key(bit_length=256)
        self.data = b'synthetic-backup-not-a-credential'

    def test_roundtrip(self):
        self.assertEqual(c.decrypt(c.encrypt(self.data, self.key), self.key), self.data)

    def test_random_nonce(self):
        self.assertNotEqual(c.encrypt(self.data, self.key), c.encrypt(self.data, self.key))

    def test_no_plaintext(self):
        self.assertNotIn(self.data, c.encrypt(self.data, self.key))

    def test_wrong_key(self):
        with self.assertRaisesRegex(c.Refused, '^AUTHENTICATION_FAILED$'):
            c.decrypt(c.encrypt(self.data, self.key), c.AESGCM.generate_key(bit_length=256))

    def test_cipher_corrupted(self):
        value = bytearray(c.encrypt(self.data, self.key)); value[-20] ^= 1
        with self.assertRaisesRegex(c.Refused, 'AUTHENTICATION_FAILED'):
            c.decrypt(bytes(value), self.key)

    def test_tag_corrupted(self):
        value = bytearray(c.encrypt(self.data, self.key)); value[-1] ^= 1
        with self.assertRaisesRegex(c.Refused, 'AUTHENTICATION_FAILED'):
            c.decrypt(bytes(value), self.key)

    def test_nonce_corrupted(self):
        value = bytearray(c.encrypt(self.data, self.key)); value[len(c.MAGIC)] ^= 1
        with self.assertRaisesRegex(c.Refused, 'AUTHENTICATION_FAILED'):
            c.decrypt(bytes(value), self.key)

    def test_version_corrupted(self):
        value = bytearray(c.encrypt(self.data, self.key)); value[0] ^= 1
        with self.assertRaisesRegex(c.Refused, 'CONTAINER_VERSION_INVALID'):
            c.decrypt(bytes(value), self.key)

    def test_truncated(self):
        with self.assertRaises(c.Refused):
            c.decrypt(c.encrypt(self.data, self.key)[:20], self.key)

    def test_key_size(self):
        with self.assertRaisesRegex(c.Refused, 'KEY_LENGTH_INVALID'):
            c.encrypt(self.data, b'x'*16)

    def test_oversize(self):
        with patch.object(c, 'LIMIT', 8), self.assertRaises(c.Refused):
            c.encrypt(self.data, self.key)

    def test_hash_and_size_match(self):
        data = c.encrypt(self.data, self.key)
        c.verify_cipher(data, c.digest(data), len(data))

    def test_offhost_hash_mismatch(self):
        with self.assertRaisesRegex(c.Refused, 'OFFHOST_HASH_MISMATCH'):
            c.verify_cipher(self.data, '0'*64, len(self.data))

    def test_offhost_size_mismatch(self):
        with self.assertRaises(c.Refused):
            c.verify_cipher(self.data, c.digest(self.data), len(self.data)+1)

    def test_disk_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.aead'
            path.write_bytes(c.encrypt(c.pack({'dump': self.data}), self.key))
            retrieved = path.read_bytes()
            self.assertEqual(c.unpack(c.decrypt(retrieved, self.key)), {'dump': self.data})

    def test_path_traversal(self):
        for name in ('../file', '/file', 'C:/file', 'a/../b', 'a\\b', './b', ''):
            with self.subTest(name=name), self.assertRaises(c.Refused):
                c.pack({name: b'x'})

    def test_archive_links_and_duplicates_denied(self):
        for link in (True, False):
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w') as tar:
                m = tarfile.TarInfo('x')
                if link:
                    m.type, m.linkname = tarfile.SYMTYPE, '/etc/shadow'
                    tar.addfile(m)
                else:
                    tar.addfile(m); tar.addfile(m)
            with self.subTest(link=link), self.assertRaises(c.Refused):
                c.unpack(stream.getvalue())

    def test_member_hash_mismatch(self):
        value = c.pack({'dump': self.data}).replace(self.data, b'X'*len(self.data))
        with self.assertRaisesRegex(c.Refused, 'ARCHIVE_HASH_MISMATCH'):
            c.unpack(value)


class Monitoring(unittest.TestCase):
    def sample(self):
        sample = previous.sample()
        sample['offhost'] = {'configured': True, 'key_metadata_ok': True, 'receipt_present': True,
                            'hash_verified': True, 'restore_pass': True, 'age_seconds': 1}
        return sample

    def test_healthy(self):
        self.assertEqual(dr.ops.evaluate_monitor(self.sample())['status'], 'PASS')

    def test_stale(self):
        s = self.sample(); s['offhost']['age_seconds'] = 36*3600+1
        self.assertIn('OFFHOST_BACKUP_STALE', dr.ops.evaluate_monitor(s)['codes'])

    def test_unknown_age(self):
        s = self.sample(); s['offhost']['age_seconds'] = None
        self.assertIn('OFFHOST_BACKUP_STALE', dr.ops.evaluate_monitor(s)['codes'])

    def test_future_age(self):
        s = self.sample(); s['offhost']['age_seconds'] = -1
        self.assertIn('OFFHOST_BACKUP_STALE', dr.ops.evaluate_monitor(s)['codes'])

    def test_missing_key(self):
        s = self.sample(); s['offhost']['key_metadata_ok'] = False
        self.assertIn('OFFHOST_KEY_CONFIG', dr.ops.evaluate_monitor(s)['codes'])

    def test_hash_failure(self):
        s = self.sample(); s['offhost']['hash_verified'] = False
        self.assertIn('OFFHOST_VERIFY_FAILED', dr.ops.evaluate_monitor(s)['codes'])

    def test_failed_restore(self):
        s = self.sample(); s['offhost']['restore_pass'] = False
        self.assertIn('OFFHOST_VERIFY_FAILED', dr.ops.evaluate_monitor(s)['codes'])

    def test_metadata_only_key_observation(self):
        text = Path(dr.ops.__file__).read_text()
        part = text.split('def offhost_observation():', 1)[1].split('def evaluate_monitor', 1)[0]
        self.assertIn('key.lstat()', part)
        self.assertNotIn('key.read', part)


class Restore(unittest.TestCase):
    def test_restores_retrieved_and_cleans_exact_target(self):
        s = previous.snapshot()
        dump = b'synthetic-dump'
        sealed = c.encrypt(c.pack({'backup/manifest.json': json.dumps({'dump': {'sha256': c.digest(dump)}}).encode(),
                                  'backup/review_activator_lab.dump': dump}), b'K'*32)
        export = {'archive': {'sha256': c.digest(sealed), 'size': len(sealed)}, 'dump_sha256': c.digest(dump),
                  'source_snapshot': s, 'database_size': 1}
        receipt = {'destination_type': 'TEMPORARY_WINDOWS', 'independent_readback': True,
                   'sha256': c.digest(sealed), 'size': len(sealed)}
        reads = []
        def private(path, *args):
            reads.append(str(path))
            return {'receipt.json': json.dumps(receipt).encode(), 'backup.aead': sealed, 'recovery.key': b'K'*32}[path.name]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'VPS07_EXPORT.json').write_text(json.dumps(export))
            (root/'retrieved-vps07').mkdir()
            (root/'retrieved-vps07/recovery.key').write_bytes(b'synthetic')
            with patch.object(dr, 'guard'), patch.object(dr, 'ROOT', root), patch.object(dr, 'private_file', side_effect=private), \
                 patch.object(dr.ops, 'STATE', root), patch.object(dr.ops, 'root_dir'), \
                 patch.object(dr.ops, 'snapshot', return_value=s), patch.object(dr.ops, 'sql', return_value='0'), \
                 patch.object(dr.ops, 'disk_guard'), patch.object(dr.ops, 'pg') as pg, \
                 patch.object(dr.ops, 'restored_security', return_value={'synthetic': True}), \
                 patch.object(dr.ops, 'app_health', return_value={'healthz': 200, 'readyz': 200}):
                result = dr.restore_retrieved()
                self.assertEqual(result['status'], 'PASS')
                restore = next(call for call in pg.call_args_list if call.args[0] == 'pg_restore')
                self.assertEqual(restore.kwargs['data'], dump)
                self.assertIn(dr.TARGET, restore.args[1])
                self.assertEqual(pg.call_args.args, ('dropdb', ['--no-password', dr.TARGET]))
                self.assertFalse((root/'retrieved-vps07/recovery.key').exists())
                self.assertTrue(all('retrieved-vps07' in p for p in reads))

    def test_existing_target_refused_before_create(self):
        # Existing VPS05 refusal is reused; fixed VPS07 path has same explicit guard.
        text = Path(dr.__file__).read_text()
        self.assertLess(text.index("'RESTORE_TARGET_EXISTS'"), text.index("ops.pg('createdb'"))
        self.assertNotIn('--force', text)
        self.assertNotIn('ALTER ROLE', text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
