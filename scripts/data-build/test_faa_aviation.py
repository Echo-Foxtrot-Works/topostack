"""Checks the FAA normalisation against small hand-checked records."""
import importlib
import json
from pathlib import Path
import unittest

from shapely.geometry import LineString

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
        self.assertEqual(features[0]['properties'], {'class': 'B', 'name': 'TEST CLASS B', 'ident': 'TST'})
        self.assertEqual(features[0]['tippecanoe'], {'minzoom': 5})

    def test_writes_an_edge_two_areas_share_once(self):
        # A surface area and a shelf around it: the shelf's inner edge is the surface area's outer edge,
        # surveyed a metre apart. The ring of a Class C at the same place is another class and stays.
        core = {'type': 'Polygon', 'coordinates': [[[-105, 39], [-104, 39], [-104, 40], [-105, 40], [-105, 39]]]}
        shelf = {'type': 'Polygon', 'coordinates': [
            [[-106, 38], [-103, 38], [-103, 41], [-106, 41], [-106, 38]],
            [[-105.00001, 39.00001], [-105.00001, 40.00001], [-104.00001, 40.00001], [-104.00001, 39.00001], [-105.00001, 39.00001]],
        ]}
        features = aviation.airspace_features([(airspace('B'), core), (airspace('B', LOWER_CODE='MSL', LOWER_VAL='8000'), shelf), (airspace('C'), core)])
        length = lambda cls: sum(LineString(item['geometry']['coordinates']).length for item in features if item['properties']['class'] == cls)
        self.assertAlmostEqual(length('B'), 4 + 12, places=3)  # the core's edge once, then only the shelf's outer edge
        self.assertAlmostEqual(length('C'), 4, places=3)

    def test_label_candidates_carry_the_charted_altitudes(self):
        shelf = {'type': 'Polygon', 'coordinates': [[[-105, 39], [-104, 39], [-104, 39.2], [-105, 39.2], [-105, 39]]]}
        labels = aviation.airspace_label_features([
            (airspace('B', LOWER_CODE='MSL', LOWER_VAL='8000'), shelf),
            (airspace('D', UPPER_VAL='2500', UPPER_DESC='TNI'), shelf),
            (airspace('D', UPPER_VAL='-9998', UPPER_UOM=None, UPPER_CODE=None), shelf),
        ])
        first = labels[0]
        self.assertEqual({key: first['properties'][key] for key in ('class', 'floor_ft', 'ceiling_ft', 'area')}, {'class': 'B', 'floor_ft': 8000, 'ceiling_ft': 12000, 'area': 0})
        self.assertEqual(first['tippecanoe'], {'minzoom': 5})
        # The roomiest point of a strip 0.2 degrees tall lies on its middle line, about 11 km from the long sides.
        self.assertAlmostEqual(first['geometry']['coordinates'][1], 39.1, places=2)
        self.assertAlmostEqual(first['properties']['clearance_m'], 11_054, delta=60)
        b = [item for item in labels if item['properties']['area'] == 0]
        self.assertGreater(len(b), 1)  # spread along the strip for crops that show part of it
        self.assertTrue(all(item['tippecanoe'] == {'minzoom': 9} for item in b[1:]))
        d = [item['properties'] for item in labels if item['properties']['class'] == 'D']
        self.assertTrue(d and all(item['ceiling_below'] and 'floor_ft' not in item and item['area'] == 1 for item in d))  # sentinel ceiling: no label

    def test_a_class_d_in_pieces_prints_its_ceiling_once(self):
        west = {'type': 'Polygon', 'coordinates': [[[-105, 39], [-104.9, 39], [-104.9, 39.1], [-105, 39.1], [-105, 39]]]}
        east = {'type': 'Polygon', 'coordinates': [[[-104.9, 39], [-104.8, 39], [-104.8, 39.1], [-104.9, 39.1], [-104.9, 39]]]}
        labels = aviation.airspace_label_features([
            (airspace('D', UPPER_VAL='2500'), west), (airspace('D', UPPER_VAL='2500'), east),
            (airspace('B'), west), (airspace('B'), east),
        ])
        areas = lambda cls: {item['properties']['area'] for item in labels if item['properties']['class'] == cls}
        self.assertEqual(len(areas('D')), 1)
        self.assertEqual(len(areas('B')), 2)

    def test_rings_run_with_their_area_on_the_left(self):
        clockwise = {'type': 'Polygon', 'coordinates': [list(reversed(SQUARE['coordinates'][0])), SQUARE['coordinates'][1]]}
        exterior, hole = aviation.rings_as_lines(clockwise)
        signed = lambda points: sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:]))
        self.assertGreater(signed(exterior['coordinates']), 0)  # counterclockwise: the area is on the left
        self.assertLess(signed(hole['coordinates']), 0)  # clockwise: the surrounding area is on the left

    def test_special_use_types_are_spelled_out(self):
        collection = {'features': [
            {'properties': {'TYPE_CODE': 'R', 'NAME': 'R-2601'}, 'geometry': SQUARE},
            {'properties': {'TYPE_CODE': 'TFR', 'NAME': 'X'}, 'geometry': SQUARE},
        ]}
        features = aviation.sua_features(collection)
        self.assertEqual({item['properties']['kind'] for item in features}, {'restricted'})

    def test_dissolves_the_records_of_one_area(self):
        # A main record cut around an exclusion, the exclusion itself, and a neighbour of another name.
        main = {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]]}
        pocket = {'type': 'Polygon', 'coordinates': [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]]}
        other = {'type': 'Polygon', 'coordinates': [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]}
        collection = {'features': [
            {'properties': {'TYPE_CODE': 'MOA', 'NAME': 'ISABELLA MOA', 'EXCLUSION': '0'}, 'geometry': main},
            {'properties': {'TYPE_CODE': 'MOA', 'NAME': 'ISABELLA MOA', 'EXCLUSION': '1'}, 'geometry': pocket},
            {'properties': {'TYPE_CODE': 'MOA', 'NAME': 'OWENS MOA', 'EXCLUSION': '0'}, 'geometry': other},
        ]}
        features = aviation.sua_features(collection)
        self.assertEqual([item['properties']['name'] for item in features], ['ISABELLA MOA', 'OWENS MOA'])
        xs = sorted({x for x, _ in features[0]['geometry']['coordinates']})
        self.assertEqual((xs[0], xs[-1]), (0, 1))

    def test_skips_upper_altitude_special_use(self):
        collection = {'features': [
            {'properties': {'TYPE_CODE': 'R', 'NAME': 'R-2601A', 'LEVEL_CODE': 'L'}, 'geometry': SQUARE},
            {'properties': {'TYPE_CODE': 'R', 'NAME': 'R-2601B', 'LEVEL_CODE': 'B'}, 'geometry': SQUARE},
            {'properties': {'TYPE_CODE': 'R', 'NAME': 'R-2601D', 'LEVEL_CODE': 'U'}, 'geometry': SQUARE},
        ]}
        self.assertEqual({item['properties']['name'] for item in aviation.sua_features(collection)}, {'R-2601A', 'R-2601B'})


def base(site, **extra):
    return {'SITE_NO': site, 'ARPT_ID': 'TST', 'ARPT_NAME': 'TEST FIELD', 'ARPT_STATUS': 'O', 'COUNTRY_CODE': 'US', 'SITE_TYPE_CODE': 'A',
            'LAT_DECIMAL': '40.0', 'LONG_DECIMAL': '-105.0', 'OWNERSHIP_TYPE_CODE': 'PU', 'FACILITY_USE_CODE': 'PU', 'TWR_TYPE_CODE': 'ATCT', **extra}


class Airports(unittest.TestCase):
    def test_runway_centerline_joins_its_surveyed_ends(self):
        airports = aviation.operational_airports([base('1')])
        runways = [{'SITE_NO': '1', 'RWY_ID': '18/36', 'RWY_WIDTH': '100', 'RWY_LEN': '6000', 'SURFACE_TYPE_CODE': 'ASPH'}]
        ends = [{'SITE_NO': '1', 'RWY_ID': '18/36', 'LAT_DECIMAL': '40.01', 'LONG_DECIMAL': '-105.0'},
                {'SITE_NO': '1', 'RWY_ID': '18/36', 'LAT_DECIMAL': '39.99', 'LONG_DECIMAL': '-105.0'}]
        [centerline] = aviation.runway_features(airports, runways, ends)
        self.assertEqual(centerline['properties'], {'airport': 'TST', 'runway': '18/36', 'width_ft': 100, 'length_ft': 6000})
        self.assertEqual(centerline['geometry']['coordinates'], [[-105.0, 40.01], [-105.0, 39.99]])
        self.assertIsNone(aviation.runway_centerline((-105.0, 40.0), (-105.0, 40.0)))

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

    def test_airport_symbol_details(self):
        airports = aviation.operational_airports([
            base('1', FUEL_TYPES='100LL,A', BCN_LGT_SKED='SS-SR', JOINT_USE_FLAG='Y'),
            base('2', ARPT_ID='GRS', FUEL_TYPES='', BCN_LGT_SKED='', JOINT_USE_FLAG='N'),
        ])
        runways = [
            {'SITE_NO': '1', 'RWY_ID': '18/36', 'RWY_LEN': '6000', 'SURFACE_TYPE_CODE': 'ASPH-G'},
            {'SITE_NO': '1', 'RWY_ID': '9/27', 'RWY_LEN': '2500', 'SURFACE_TYPE_CODE': 'TURF'},
            {'SITE_NO': '1', 'RWY_ID': 'H1', 'RWY_LEN': '9000', 'SURFACE_TYPE_CODE': 'CONC'},
            {'SITE_NO': '2', 'RWY_ID': '4/22', 'RWY_LEN': '3000', 'SURFACE_TYPE_CODE': 'TURF-GRVL'},
        ]
        end = lambda rwy, lat, lon: {'SITE_NO': '1', 'RWY_ID': rwy, 'LAT_DECIMAL': str(lat), 'LONG_DECIMAL': str(lon)}
        ends = [end('18/36', 40.01, -105.0), end('18/36', 39.99, -105.0), end('9/27', 40.0, -105.005), end('9/27', 40.0, -104.995)]
        features = {item['properties']['ident']: item['properties'] for item in aviation.airport_features(airports, runways, ends)}
        paved = features['TST']
        self.assertEqual((paved['hard_runway_ft'], paved['fuel'], paved['beacon'], paved['joint_use']), (6000, True, True, True))
        self.assertEqual(paved['runway_pattern'], '0,1105,0,-1105;-426,0,426,0')
        self.assertEqual(features['GRS'], {'ident': 'GRS', 'name': 'TEST FIELD', 'kind': 'airport', 'use': 'public', 'towered': True, 'longest_runway_ft': 3000})

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

    def test_reads_lighting_type_and_quantity(self):
        strobe_group = DOF_TOWER[:62] + 'WINDMILL          ' + DOF_TOWER[80] + '3' + DOF_TOWER[82:95] + 'H' + DOF_TOWER[96:]
        [feature] = aviation.obstacle_features([strobe_group])
        self.assertEqual(feature['properties'], {'agl_ft': 256, 'lit': True, 'high_intensity': True, 'wind_turbine': True, 'quantity': 3})


class Registration(unittest.TestCase):
    def test_pins_every_input_and_matches_the_cycle(self):
        pins = json.loads(aviation.SOURCES.read_text())
        self.assertTrue(pins['dataset'].startswith(f"faa-aviation-{pins['nasrCycle']}-"))
        for pin in pins['files'].values():
            self.assertRegex(pin['sha256'], r'^[a-f0-9]{64}$')
            self.assertTrue(pin.get('url', pin.get('service', '')).startswith('https://'))


if __name__ == '__main__':
    unittest.main()
