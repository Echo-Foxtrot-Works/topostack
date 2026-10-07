import hashlib
from pathlib import Path
import tempfile
import unittest

from pinned import download, file_sha256


class PinnedTest(unittest.TestCase):
    def test_download_is_atomic_and_digest_matches_hashlib(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.bin'
            source.write_bytes(b'pinned bytes' * 1000)
            target = Path(directory) / 'copy.bin'
            download(source.as_uri(), target)
            self.assertEqual(target.read_bytes(), source.read_bytes())
            self.assertFalse((Path(directory) / 'copy.bin.part').exists())
            self.assertEqual(file_sha256(target), hashlib.sha256(source.read_bytes()).hexdigest())

    def test_failed_download_leaves_no_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'copy.bin'
            with self.assertRaises(OSError):
                download((Path(directory) / 'missing.bin').as_uri(), target)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
