"""Checks the FAA normalisation against small hand-checked records."""
import importlib
import json
import math
from pathlib import Path
import unittest

aviation = importlib.import_module('build-faa-aviation')

SQUARE = {'type': 'Polygon', 'coordinates': [
    [[-105.0, 39.0, 0], [-104.0, 39.0, 0], [-104.0, 40.0, 0], [-105.0, 40.0, 0], [-105.0, 39.0, 0]],
    [[-104.6, 39.4, 0], [-104.4, 39.4, 0], [-104.4, 39.6, 0], [-104.6, 39.4, 0]],
]}


def airspace(cls, **extra):
    return {'CLASS': cls, 'NAME': f'TEST CLASS {cls}', 'IDENT': 'TST', 'LOWER_VAL': '0', 'LOWER_UOM': 'FT', 'LOWER_CODE': 'SFC',
            'UPPER_VAL': '12000', 'UPPER_UOM': 'FT', 'UPPER_CODE': 'MSL', **extra}


class Airspace(unittest.TestCase):
    def test_keeps_b_c_d_rings_as_flat_lines(self):
        features = aviation.airspace_features([(airspace('B'), SQUARE), (airspace('E'), SQUARE), (airspace('D'), None)])
        self.assertEqual(len(features), 2)  # exterior and the excluded hole, class E dropped
        self.assertTrue(all(item['geometry']['type'] == 'LineString' for item in features))
        self.assertEqual(features[0]['geometry']['coordinates'][0], [-105.0, 39.0])
        self.assertEqual(features[0]['properties'], {'class': 'B', 'name': 'TEST CLASS B', 'ident': 'TST', 'floor_ft': 0, 'ceiling_ft': 12000})
        self.assertEqual(features[0]['tippecanoe'], {'minzoom': 5})

    def test_omits_sentinel_altitudes(self):
        [first, _] = aviation.airspace_features([(airspace('D', UPPER_VAL='-9998', UPPER_UOM=None, UPPER_CODE=None, LOWER_CODE='MSL', LOWER_VAL='1000'), SQUARE)])
        self.assertEqual(first['properties'].get('floor_ft'), 1000)
        self.assertNotIn('ceiling_ft', first['properties'])
        self.assertEqual(first['tippecanoe'], {'minzoom': 7})

    def test_special_use_types_are_spelled_out(self):
        collection = {'features': [
            {'properties': {'TYPE_CODE': 'R', 'NAME': 'R-2601'}, 'geometry': SQUARE},
            {'properties': {'TYPE_CODE': 'TFR', 'NAME': 'X'}, 'geometry': SQUARE},
        ]}
        features = aviation.sua_features(collection)
        self.assertEqual({item['properties']['kind'] for item in features}, {'restricted'})


def base(site, **extra):
    return {'SITE_NO': site, 'ARPT_ID': 'TST', 'ARPT_NAME': 'TEST FIELD', 'ARPT_STATUS': 'O', 'COUNTRY_CODE': 'US', 'SITE_TYPE_CODE': 'A',
            'LAT_DECIMAL': '40.0', 'LONG_DECIMAL': '-105.0', 'OWNERSHIP_TYPE_CODE': 'PU', 'FACILITY_USE_CODE': 'PU', 'TWR_TYPE_CODE': 'ATCT', **extra}


class Airports(unittest.TestCase):
    def test_runway_outline_has_the_published_width(self):
        airports = aviation.operational_airports([base('1')])
        runways = [{'SITE_NO': '1', 'RWY_ID': '18/36', 'RWY_WIDTH': '100', 'RWY_LEN': '6000', 'SURFACE_TYPE_CODE': 'ASPH'}]
        ends = [{'SITE_NO': '1', 'RWY_ID': '18/36', 'LAT_DECIMAL': '40.01', 'LONG_DECIMAL': '-105.0'},
                {'SITE_NO': '1', 'RWY_ID': '18/36', 'LAT_DECIMAL': '39.99', 'LONG_DECIMAL': '-105.0'}]
        centerline, outline = aviation.runway_features(airports, runways, ends)
        self.assertEqual(centerline['properties'], {'airport': 'TST', 'runway': '18/36', 'width_ft': 100, 'length_ft': 6000, 'role': 'centerline'})
        ring = outline['geometry']['coordinates']
        self.assertEqual(len(ring), 5)
        self.assertEqual(ring[0], ring[-1])
        width_m = abs(ring[0][0] - ring[3][0]) * 111_320 * math.cos(math.radians(40))
        self.assertAlmostEqual(width_m, 30.48, delta=0.05)

    def test_skips_water_helipad_and_single_ended_runways(self):
        airports = aviation.operational_airports([base('1')])
        end = {'SITE_NO': '1', 'LAT_DECIMAL': '40', 'LONG_DECIMAL': '-105'}
        runways = [{'SITE_NO': '1', 'RWY_ID': rwy, 'RWY_WIDTH': '100', 'RWY_LEN': '3000', 'SURFACE_TYPE_CODE': surface} for rwy, surface in (('H1', 'CONC'), ('9W/27W', 'WATER'), ('9/27', 'TURF'))]
        self.assertEqual(aviation.runway_features(airports, runways, [{**end, 'RWY_ID': '9/27'}]), [])

    def test_airport_use_tower_and_prominence(self):
        airports = aviation.operational_airports([base('1'), base('2', ARPT_ID='PVT', OWNERSHIP_TYPE_CODE='PR', FACILITY_USE_CODE='PR', TWR_TYPE_CODE='NON-ATCT'),
                                                  base('3', OWNERSHIP_TYPE_CODE='MA'), base('4', ARPT_STATUS='CI'), base('5', COUNTRY_CODE='CA'), base('6', SITE_TYPE_CODE='U')])
        features = {item['properties']['ident'] + item['properties']['use']: item for item in aviation.airport_features(airports, [{'SITE_NO': '1', 'RWY_LEN': '8000'}])}
        self.assertEqual(set(features), {'TSTpublic', 'PVTprivate', 'TSTmilitary'})
        self.assertEqual(features['TSTpublic']['properties']['longest_runway_ft'], 8000)
        self.assertTrue(features['TSTpublic']['properties']['towered'])
        self.assertEqual(features['TSTpublic']['tippecanoe'], {'minzoom': 6})
        self.assertEqual(features['PVTprivate']['tippecanoe'], {'minzoom': 8})

    def test_navaids_keep_radio_aids_only(self):
        row = {'NAV_ID': 'DEN', 'NAME': 'DENVER', 'NAV_STATUS': 'OPERATIONAL IFR', 'LAT_DECIMAL': '39.8', 'LONG_DECIMAL': '-104.6'}
        features = aviation.navaid_features([{**row, 'NAV_TYPE': 'VORTAC'}, {**row, 'NAV_TYPE': 'VOT'}, {**row, 'NAV_TYPE': 'NDB', 'NAV_STATUS': 'SHUTDOWN'}])
        self.assertEqual([item['properties'] for item in features], [{'ident': 'DEN', 'name': 'DENVER', 'kind': 'vortac'}])


# A real Digital Obstacle File record (Branson, CO) and a short, lower one.
DOF_TOWER = '08-025404 O US CO BRANSON          37 00 26.20N 103 51 59.90W TOWER              1 00256 06541 D 5 E N 2015ANM02292OE C 2015236 '
DOF_SHORT = '08-000466 O US CO BRANSON          37 00 27.00N 103 52 11.80W TOWER              1 00125 06563 N 3 C N 2006ANM00754OE C 2006323 '


class Obstacles(unittest.TestCase):
    def test_parses_fixed_columns(self):
        record = aviation.parse_obstacle(DOF_TOWER)
        self.assertAlmostEqual(record['lat'], 37 + 26.2 / 3600, places=6)
        self.assertAlmostEqual(record['lon'], -(103 + 51 / 60 + 59.9 / 3600), places=6)
        self.assertEqual((record['agl_ft'], record['lighting'], record['country']), (256, 'D', 'US'))
        self.assertIsNone(aviation.parse_obstacle('  CURRENCY DATE = 09/27/26'))

    def test_keeps_charted_heights_only(self):
        implausible = DOF_TOWER[:83] + '10125' + DOF_TOWER[88:]
        features = aviation.obstacle_features([DOF_TOWER, DOF_SHORT, implausible])
        self.assertEqual([item['properties'] for item in features], [{'agl_ft': 256, 'lit': True}])
        self.assertEqual(features[0]['tippecanoe'], {'minzoom': 9})


class Registration(unittest.TestCase):
    def test_pins_every_input_and_matches_the_cycle(self):
        pins = json.loads(aviation.SOURCES.read_text())
        self.assertTrue(pins['dataset'].startswith(f"faa-aviation-{pins['nasrCycle']}-"))
        for pin in pins['files'].values():
            self.assertRegex(pin['sha256'], r'^[a-f0-9]{64}$')
            self.assertTrue(pin.get('url', pin.get('service', '')).startswith('https://'))


if __name__ == '__main__':
    unittest.main()
