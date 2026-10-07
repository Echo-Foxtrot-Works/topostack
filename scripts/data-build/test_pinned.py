import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

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

    def test_retries_server_and_network_errors_but_not_client_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.bin'
            source.write_bytes(b'eventually')
            target = Path(directory) / 'copy.bin'
            real_urlopen = download.__globals__['urllib'].request.urlopen
            failures = [urllib.error.HTTPError(source.as_uri(), 503, 'busy', {}, None), TimeoutError('stalled')]

            def flaky(request, timeout):
                if failures:
                    raise failures.pop(0)
                return real_urlopen(request, timeout=timeout)

            with patch('pinned.urllib.request.urlopen', side_effect=flaky), patch('pinned.time.sleep') as sleep:
                download(source.as_uri(), target, retries=2)
            self.assertEqual(target.read_bytes(), b'eventually')
            self.assertEqual(sleep.call_count, 2)

            missing = urllib.error.HTTPError(source.as_uri(), 404, 'gone', {}, None)
            with patch('pinned.urllib.request.urlopen', side_effect=missing) as opened, patch('pinned.time.sleep'):
                with self.assertRaises(urllib.error.HTTPError):
                    download(source.as_uri(), Path(directory) / 'other.bin', retries=3)
            self.assertEqual(opened.call_count, 1)
            self.assertFalse((Path(directory) / 'other.bin.part').exists())


if __name__ == '__main__':
    unittest.main()
