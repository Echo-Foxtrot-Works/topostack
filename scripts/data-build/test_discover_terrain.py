import importlib
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

mod = importlib.import_module('discover-terrain')


class Headers:
    headers = {'ETag': '"pinned"', 'Content-Length': '100'}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


class DiscoveryTests(unittest.TestCase):
    def test_approved_dtm_only_and_stable_identity(self):
        item = {'id': 'region', 'properties': {'datetime': '2026-01-01'}, 'assets': {
            'dtm': {'href': 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/test-dtm.tif'},
            'dsm': {'href': 'https://example.invalid/surface.tif'}}}
        with patch.object(mod, 'read_json', return_value={'features': [item], 'links': []}), patch.object(mod.urllib.request, 'urlopen', return_value=Headers()):
            first = mod.discover([-83, 46, -82, 47])
            self.assertEqual(first, mod.discover([-83, 46, -82, 47]))
            self.assertNotEqual(first[0]['source']['id'], mod.discover([-83, 46, -82, 48])[0]['source']['id'])
        self.assertEqual([entry['source']['nativeResolutionM'] for entry in first], [1, 2, 30])
        self.assertNotIn('acquisitionYear', first[0]['source'])
        self.assertTrue(all(entry['pin']['url'].endswith('test-dtm.tif') for entry in first))

    def test_rejects_invalid_bounds_and_untrusted_assets(self):
        with self.assertRaises(ValueError):
            mod.discover([1, 2, 0, 3])
        with patch.object(mod, 'read_json', return_value={'features': [{'assets': {'dtm': {'href': 'http://localhost/private'}}}]}):
            with self.assertRaises(ValueError):
                mod.discover([-83, 46, -82, 47])

    def test_follows_pagination_and_rejects_cycles(self):
        page = {'features': [], 'links': [{'rel': 'next', 'href': mod.API + '/next'}]}
        with patch.object(mod, 'read_json', side_effect=[page, {'features': [], 'links': []}, {'features': []}, {'features': []}]) as read:
            self.assertEqual(mod.discover([-83, 46, -82, 47]), [])
            self.assertEqual(read.call_count, 4)
        with patch.object(mod, 'read_json', return_value=page):
            with self.assertRaisesRegex(ValueError, 'pagination'):
                mod.discover([-83, 46, -82, 47])


class RegisterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.catalog, self.pins = root / 'terrain-sources.json', root / 'hrdem-sources.json'
        data = Path(__file__).parent.parent / 'data'
        self.source = json.loads((data / 'terrain-sources.json').read_text())['sources'][0]
        self.receipt = json.loads((data / 'hrdem-builds.json').read_text())['builds'][0]
        self.pin = self.receipt['sources'][0]
        self.catalog.write_text(json.dumps({'sources': [self.source]}))
        self.pins.write_text(json.dumps({self.source['id']: self.pin}))
        (root / 'hrdem-builds.json').write_text(json.dumps({'builds': [self.receipt]}))

    def tearDown(self):
        self.tmp.cleanup()

    def entry(self):
        source, pin, receipt = copy.deepcopy((self.source, self.pin, self.receipt))
        source['id'] = receipt['dataset'] = 'nrcan-new-v1'
        receipt.update(schemaVersion=1, encoding=source['encoding'], verticalDatum=source['verticalDatum'],
                       verticalUnits='metre', coverage={'validSamples': 50, 'totalSamples': 100})
        return {'source': source, 'pin': pin, 'receipt': receipt}

    def test_registers_one_snapshot_and_preserves_legacy_files(self):
        before = self.pins.read_text()
        entry = self.entry()
        mod.register([entry], self.catalog, self.pins)
        catalog = json.loads(self.catalog.read_text())
        self.assertEqual([s['id'] for s in catalog['sources']], [self.source['id'], 'nrcan-new-v1'])
        self.assertEqual(catalog['records']['nrcan-new-v1']['pin'], entry['pin'])
        self.assertTrue((self.catalog.parent / catalog['releaseManifest']).is_file())
        self.assertEqual(self.pins.read_text(), before)
        first = self.catalog.read_bytes()
        mod.register([entry], self.catalog, self.pins)
        self.assertEqual(self.catalog.read_bytes(), first)

    def test_interruption_before_activation_keeps_previous_registry(self):
        import terrain_release
        before = self.catalog.read_bytes()
        original = terrain_release.atomic_write
        def interrupt(path, content):
            if path == self.catalog:
                raise OSError('simulated interruption')
            original(path, content)
        with patch.object(terrain_release, 'atomic_write', side_effect=interrupt):
            with self.assertRaisesRegex(OSError, 'interruption'):
                mod.register([self.entry()], self.catalog, self.pins)
        self.assertEqual(self.catalog.read_bytes(), before)
        sources, _ = terrain_release.load_registry(self.catalog, self.pins)
        self.assertEqual(sources, [self.source])
        mod.register([self.entry()], self.catalog, self.pins)
        self.assertEqual(len(terrain_release.load_registry(self.catalog, self.pins)[0]), 2)

    def test_rejects_changed_pin_or_receipt_under_existing_id(self):
        entry = self.entry()
        mod.register([entry], self.catalog, self.pins)
        before = self.catalog.read_bytes()
        changed = copy.deepcopy(entry)
        changed['pin']['etag'] = changed['receipt']['sources'][0]['etag'] = '"changed"'
        with self.assertRaisesRegex(ValueError, 'identity'):
            mod.register([changed], self.catalog, self.pins)
        changed = copy.deepcopy(entry)
        changed['receipt']['sha256'] = 'a' * 64
        with self.assertRaisesRegex(ValueError, 'identity'):
            mod.register([changed], self.catalog, self.pins)
        self.assertEqual(self.catalog.read_bytes(), before)

    def test_rejects_missing_receipts_invalid_coverage_and_wrong_extents(self):
        import terrain_release
        for change in [{'coverage': {'validSamples': 101, 'totalSamples': 100}},
                       {'grids': [{'bounds': [0, 1, 2, 3]}]}, {'sha256': 'bad'},
                       {'verticalUnits': 'foot'}, {'schemaVersion': 2}]:
            entry = self.entry()
            entry['receipt'].update(change)
            with self.assertRaises(ValueError):
                mod.register([entry], self.catalog, self.pins)
        entry = self.entry()
        entry['source']['kind'] = 'dsm'
        with self.assertRaises(ValueError):
            terrain_release.validate_candidate(entry['source'], entry['pin'])

    def test_accepts_new_datums_and_gates_unapproved_sources(self):
        import terrain_release
        entry = self.entry()
        for datum, kind in (('JP-TP', 'national-dtm'), ('MSL', 'bathymetry-grid')):
            source = {**entry['source'], 'verticalDatum': datum, 'kind': kind}
            terrain_release.validate_candidate(source, {**entry['pin'], 'verticalDatum': datum})
        pending = {**entry['source'], 'availability': 'development', 'approval': {'required': True}}
        terrain_release.validate_candidate(pending, entry['pin'])
        granted = {**pending, 'availability': 'all', 'approval': {'required': True, 'reference': 'GSI-123'}}
        terrain_release.validate_candidate(granted, entry['pin'])
        for change in ({'availability': 'all'}, {'availability': 'staging'}, {'approval': {'required': False}},
                       {'approval': {'required': True, 'reference': ' '}}):
            with self.assertRaises(ValueError):
                terrain_release.validate_candidate({**pending, **change}, entry['pin'])

    def test_rejects_tampered_immutable_manifest(self):
        import terrain_release
        mod.register([self.entry()], self.catalog, self.pins)
        catalog = json.loads(self.catalog.read_text())
        (self.catalog.parent / catalog['releaseManifest']).write_text('{}')
        with self.assertRaisesRegex(ValueError, 'manifest mismatch'):
            terrain_release.load_registry(self.catalog, self.pins)

    def test_availability_changes_only_the_release_and_build_replays_preserve_it(self):
        import terrain_release
        entry = self.entry()
        entry['source'].pop('availability', None)
        mod.register([entry], self.catalog, self.pins)
        before = json.loads(self.catalog.read_text())
        previous_manifest = self.catalog.parent / before['releaseManifest']
        previous_bytes = previous_manifest.read_bytes()
        source_id = entry['source']['id']

        terrain_release.set_availability([source_id], 'development', self.catalog, self.pins)
        restricted = self.catalog.read_bytes()
        after = json.loads(restricted)
        self.assertEqual(after['records'], before['records'])
        expected = [{**source, 'availability': 'development'} if source['id'] == source_id else source
                    for source in before['sources']]
        self.assertEqual(after['sources'], expected)
        self.assertNotEqual(after['releaseManifest'], before['releaseManifest'])
        self.assertEqual(previous_manifest.read_bytes(), previous_bytes)
        mod.register([entry], self.catalog, self.pins)
        self.assertEqual(self.catalog.read_bytes(), restricted)
        with self.assertRaisesRegex(ValueError, 'Unknown registered'):
            terrain_release.set_availability([source_id, 'unknown-v1'], 'all', self.catalog, self.pins)
        self.assertEqual(self.catalog.read_bytes(), restricted)
        terrain_release.set_availability([source_id], 'all', self.catalog, self.pins)
        restored, _ = terrain_release.load_registry(self.catalog, self.pins)
        self.assertEqual(restored[-1]['availability'], 'all')

    def test_availability_change_requires_outstanding_approval(self):
        import terrain_release
        entry = self.entry()
        entry['source'].update(availability='development', approval={'required': True})
        mod.register([entry], self.catalog, self.pins)
        before = self.catalog.read_bytes()
        with self.assertRaisesRegex(ValueError, 'approval reference'):
            terrain_release.set_availability([entry['source']['id']], 'all', self.catalog, self.pins)
        self.assertEqual(self.catalog.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
