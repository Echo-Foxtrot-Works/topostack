"""Checks the PAD-US classification and unit rules against small hand-checked records."""
import importlib
import json
from pathlib import Path
import unittest

import shapely
from shapely.geometry import box

lands = importlib.import_module('build-public-lands')

ROOT = Path(__file__).resolve().parents[2]


def record(**props):
    return {'Des_Tp': None, 'Mang_Name': None, 'Unit_Nm': None, 'State_Nm': 'CO', **props}


class Classes(unittest.TestCase):
    def test_classifies_proclamation_outlines_by_manager_and_name(self):
        cases = [
            (record(Des_Tp='PROC', Mang_Name='NPS', Unit_Nm='Rocky Mountain National Park'), 'national-park'),
            (record(Des_Tp='PROC', Mang_Name='NPS', Unit_Nm='Dinosaur National Monument'), 'national-monument'),
            (record(Des_Tp='PROC', Mang_Name='NPS', Unit_Nm='Lincoln Memorial'), 'national-park'),
            (record(Des_Tp='PROC', Mang_Name='USFS', Unit_Nm='Pawnee National Grassland'), 'national-forest'),
            (record(Des_Tp='PROC', Mang_Name='FWS', Unit_Nm='Arapaho National Wildlife Refuge'), 'wildlife-refuge'),
            (record(Des_Tp='PROC', Mang_Name='FWS', Unit_Nm='Leadville National Fish Hatchery'), None),
            (record(Des_Tp='MIL', Mang_Name='DOD', Unit_Nm='Fort Carson'), 'military'),
            (record(Des_Tp='PROC', Mang_Name='OTHF', Unit_Nm='Fort Logan National Cemetery'), None),
        ]
        for props, expected in cases:
            self.assertEqual(lands.proclamation_class(props), expected, props['Unit_Nm'])

    def test_keeps_reservations_and_oklahoma_areas_but_not_other_statistical_areas(self):
        tribal = lambda name: lands.proclamation_class(record(Des_Tp='TRIBL', Mang_Name='TRIB', Unit_Nm=name))  # noqa: E731
        self.assertEqual(tribal('Uintah and Ouray Reservation'), 'tribal')
        self.assertEqual(tribal('Cherokee Oklahoma Tribal Statistical Area'), 'tribal')
        self.assertIsNone(tribal('Akiak Alaska Native Village Statistical Area'))
        self.assertIsNone(tribal('Lumbee State Designated Tribal Statistical Area'))
        self.assertIsNone(tribal('Cowlitz Tribal Designated Statistical Area'))

    def test_classifies_designations_and_fee_land(self):
        self.assertEqual(lands.designation_class(record(Des_Tp='WA', Mang_Name='USFS')), 'wilderness')
        self.assertEqual(lands.designation_class(record(Des_Tp='NM', Mang_Name='BLM')), 'national-monument')
        self.assertIsNone(lands.designation_class(record(Des_Tp='NM', Mang_Name='FWS')))  # marine monuments
        self.assertIsNone(lands.designation_class(record(Des_Tp='WSA', Mang_Name='BLM')))
        self.assertEqual(lands.fee_class(record(Des_Tp='PUB', Mang_Name='BLM')), 'blm')
        self.assertEqual(lands.fee_class(record(Des_Tp='SREC', Mang_Name='SPR')), 'state-park')
        self.assertEqual(lands.fee_class(record(Des_Tp='PCON', Mang_Name='NGO', Unit_Nm='Phantom Canyon Ranch')), 'preserve')
        self.assertIsNone(lands.fee_class(record(Des_Tp='LCA', Mang_Name='CNTY', Unit_Nm='Proposed Open Space')))
        self.assertIsNone(lands.fee_class(record(Des_Tp='SCA', Mang_Name='SFW')))

    def test_names_and_unit_keys(self):
        self.assertEqual(lands.display_name('tribal', 'Cherokee Oklahoma Tribal Statistical Area'), 'Cherokee')
        self.assertEqual(lands.display_name('tribal', 'Osage Reservation'), 'Osage Reservation')
        self.assertIsNone(lands.display_name('blm', 'Public Lands'))
        self.assertIsNone(lands.display_name('preserve', ' Unknown '))
        self.assertEqual(lands.display_name('national-park', 'Rocky  Mountain National Park '), 'Rocky Mountain National Park')
        self.assertEqual(lands.unit_key('blm', record(State_Nm='UT')), 'blm:UT')
        self.assertEqual(lands.unit_key('state-park', record(Unit_Nm='Lory State Park')), 'state-park:Lory State Park:CO')
        self.assertEqual(lands.unit_key('wilderness', record(Unit_Nm='Indian Peaks Wilderness', State_Nm='CO')), 'wilderness:Indian Peaks Wilderness')


class Canada(unittest.TestCase):
    def test_classifies_cpcad_land_areas_by_type(self):
        self.assertEqual(lands.cpcad_class({'TYPE_E': 'National Park', 'BIOME': 'T'}), 'national-park')
        self.assertEqual(lands.cpcad_class({'TYPE_E': 'Provincial Park', 'BIOME': 'T'}), 'state-park')
        self.assertEqual(lands.cpcad_class({'TYPE_E': 'National Wildlife Area', 'BIOME': 'T'}), 'wildlife-refuge')
        self.assertEqual(lands.cpcad_class({'TYPE_E': 'Indigenous owned protected area', 'BIOME': 'T'}), 'preserve')
        self.assertIsNone(lands.cpcad_class({'TYPE_E': 'National Park', 'BIOME': 'M'}))  # marine
        self.assertIsNone(lands.cpcad_class({'TYPE_E': 'Proposed biodiversity reserve', 'BIOME': 'T'}))
        self.assertTrue(set(lands.CPCAD_TYPES.values()) <= {'national-park', 'wilderness', 'wildlife-refuge', 'state-park', 'preserve'})

    def test_names_canadian_units_as_they_are_known(self):
        self.assertEqual(lands.display_name('national-park', 'Banff National Park Of Canada', 'cpcad'), 'Banff National Park')
        self.assertEqual(lands.display_name('state-park', 'AKAMINA-KISHINENA PARK', 'cpcad'), 'Akamina-Kishinena Park')
        self.assertEqual(lands.display_name('state-park', "O'HARA LAKE PARK", 'cpcad'), "O'Hara Lake Park")
        self.assertEqual(lands.display_name('state-park', 'Algonquin Provincial Park (Natural Environment Class)', 'cpcad'), 'Algonquin Provincial Park (Natural Environment Class)')
        # US names are left as published.
        self.assertEqual(lands.display_name('national-park', 'Bank of Canada Park'), 'Bank of Canada Park')

    def test_keys_canadian_units_by_province_and_marks_their_source(self):
        props = {'Unit_Nm': 'DUC Fee Simple Lands', 'State_Nm': 'CA-7', 'source': 'cpcad'}
        self.assertEqual(lands.unit_key('preserve', props), 'ca:preserve:DUC Fee Simple Lands:CA-7')
        self.assertEqual(lands.unit_key('national-park', {**props, 'Unit_Nm': 'Banff National Park'}), 'ca:national-park:Banff National Park:CA-7')
        square = box(-1_400_000, 1_400_000, -1_399_000, 1_401_000)
        feature = lands.unit_feature('ca:preserve:X:CA-7', 'preserve', {**props, 'Unit_Nm': 'X'}, square, 'EPSG:5070')
        self.assertEqual(feature['properties']['source'], 'cpcad')
        self.assertNotIn('manager', feature['properties'])
        us = lands.unit_feature('blm:CO', 'blm', record(Mang_Name='BLM'), square, 'EPSG:5070')
        self.assertNotIn('source', us['properties'])


class Units(unittest.TestCase):
    def test_dissolves_the_pieces_of_one_unit(self):
        props = record(Mang_Name='USFS', Unit_Nm='Indian Peaks Wilderness')
        units = lands.dissolve([('wilderness', props, box(0, 0, 2, 2)), ('wilderness', props, box(1, 0, 3, 2)),
                                ('blm', record(Mang_Name='BLM'), box(5, 5, 6, 6))])
        self.assertEqual([key for key, *_ in units], ['blm:CO', 'wilderness:Indian Peaks Wilderness'])
        self.assertAlmostEqual(units[1][3].area, 6)
        self.assertEqual(units[1][3].geom_type, 'Polygon')

    def test_keeps_a_refuge_outline_only_where_the_agency_owns_enough_or_none(self):
        outline = box(0, 0, 10, 10)
        owned = box(0, 0, 10, 3)  # 30% owned
        self.assertIs(lands.refuge_geometry(outline, owned, 0.25), outline)
        kept = lands.refuge_geometry(outline, box(0, 0, 10, 2), 0.25)  # 20% owned: an acquisition area
        self.assertAlmostEqual(kept.area, 20)
        # An overlay refuge on another agency's land: the service owns none of it.
        self.assertIs(lands.refuge_geometry(outline, shapely.Polygon(), 0.25), outline)
        self.assertIs(lands.refuge_geometry(outline, box(20, 20, 21, 21), 0.25), outline)

    def test_replaces_only_acquisition_area_outlines(self):
        units = [('wildlife-refuge:Big', 'wildlife-refuge', record(), box(0, 0, 10, 10)),
                 ('wildlife-refuge:Paper', 'wildlife-refuge', record(), box(20, 0, 30, 10)),
                 ('wildlife-refuge:Overlay', 'wildlife-refuge', record(), box(60, 0, 70, 10)),
                 ('national-forest:Roosevelt', 'national-forest', record(), box(40, 0, 50, 10))]
        owned = lands.owned_land([('owned', record(), box(0, 0, 10, 5)), ('owned', record(), box(20, 0, 21, 1)), ('owned', record(), box(40, 0, 41, 1))])
        result = {key: geometry.area for key, _, _, geometry in lands.apply_refuge_rule(units, owned, 0.25)}
        self.assertEqual(result, {'wildlife-refuge:Big': 100, 'wildlife-refuge:Paper': 1, 'wildlife-refuge:Overlay': 100, 'national-forest:Roosevelt': 100})

    def test_writes_the_contract_properties_in_wgs84(self):
        # A 1 km square in CONUS Albers near Denver.
        square = box(-760_000, 1_870_000, -759_000, 1_871_000)
        feature = lands.unit_feature('blm:CO', 'blm', record(Mang_Name='BLM', Unit_Nm='Public Lands'), square, 'EPSG:5070')
        self.assertEqual(feature['properties'], {'class': 'blm', 'unit': 'blm:CO', 'manager': 'BLM', 'acres': 247})
        lon, lat = feature['geometry']['coordinates'][0][0]
        self.assertTrue(-106 < lon < -104 and 39 < lat < 41, (lon, lat))
        self.assertEqual(round(lon, 6), lon)


class Registration(unittest.TestCase):
    def test_pins_the_geodatabase(self):
        pins = json.loads((ROOT / 'scripts/data/public-lands-sources.json').read_text())
        self.assertRegex(pins['files']['padus']['sha256'], r'^[0-9a-f]{64}$')
        self.assertTrue(pins['dataset'].startswith(f"public-lands-{pins['padusDate']}-v"))
        self.assertRegex(pins['files']['cpcad']['sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(pins['canada']['date'], '2025-12-31')


if __name__ == '__main__':
    unittest.main()
