"""Survey snapshots and incremental directory builds retain the exact source identity."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def script(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


capture = script('snapshot-survey-service')
directory = script('build-lake-directory')


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name) / 'lake.gz'
        self.revision = 1
        self.depth = 1
        self.reads = 0
        self.edit_during_read = False

    def request(self, url, params):
        if not url.endswith('/query'):
            return {'editingInfo': {'lastEditDate': self.revision}}
        if params.get('returnIdsOnly'):
            return {'objectIdFieldName': 'id', 'objectIds': [1]}
        self.reads += 1
        if self.edit_during_read:
            self.revision += 1
        return {'features': [{'type': 'Feature', 'geometry': None, 'properties': {'id': 1, 'depth': self.depth}}]}

    def snapshot(self, output=None):
        with patch.object(capture, 'request', self.request):
            capture.snapshot('https://fixture.test/lake', output or self.output)

    def test_versioned_pages_match_a_cold_capture_after_an_edit(self):
        self.snapshot()
        self.snapshot()
        self.assertEqual(self.reads, 1)
        self.revision, self.depth = 2, 14
        self.snapshot()
        cold = self.output.with_name('cold.gz')
        self.snapshot(cold)
        self.assertEqual(self.reads, 3)
        self.assertEqual(self.output.read_bytes(), cold.read_bytes())
        properties = json.loads(gzip.decompress(cold.read_bytes()))['features'][0]['properties']
        self.assertEqual(properties['depth'], 14)

    def test_unversioned_layers_fetch_again(self):
        self.revision = None
        self.snapshot()
        self.depth = 4
        self.snapshot()
        self.assertEqual(self.reads, 2)
        self.assertEqual(json.loads(gzip.decompress(self.output.read_bytes()))['features'][0]['properties']['depth'], 4)

    def test_mid_capture_edit_preserves_previous_snapshot_and_receipt(self):
        self.snapshot()
        old = self.output.read_bytes()
        receipt = self.output.with_suffix('.receipt.json')
        old_receipt = receipt.read_bytes()
        self.revision, self.depth, self.edit_during_read = 2, 7, True
        with self.assertRaisesRegex(ValueError, 'revision changed'):
            self.snapshot()
        self.assertEqual(self.output.read_bytes(), old)
        self.assertEqual(receipt.read_bytes(), old_receipt)


class DirectoryTests(unittest.TestCase):
    def test_incremental_build_checks_identity_even_when_the_record_count_matches(self):
        previous = json.loads((directory.ROOT / 'apps/generator/static/data/lake-depth-directory.json').read_bytes())
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            # The integrated directory and build pins are the positive control.
            result = directory.build(root, root, previous)
            self.assertEqual(result, previous)
            source = next(source for source in previous['sources'] if source['id'] == 'usgs-crater-lake-v1')
            for digest in ['a' * 64, None]:
                with self.subTest(digest=digest):
                    if digest:
                        source['archiveSha256'] = digest
                    else:
                        source.pop('archiveSha256')
                    with self.assertRaisesRegex(ValueError, 'supply the build receipt for usgs-crater-lake-v1'):
                        directory.build(root, root, previous)


if __name__ == '__main__':
    unittest.main()
