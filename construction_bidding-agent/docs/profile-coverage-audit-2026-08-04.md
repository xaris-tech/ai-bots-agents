# Target Entity Profile Coverage Audit

**Date:** 2026-08-04
**Source workbook:** <https://docs.google.com/spreadsheets/d/1Xgs6f4LErF9NC0_QrJ8cJaBvDofiCqcy/edit>
**Tabs:** `Main Target Entities Agg`, `Add. Targer Entities for Agg.`

## Summary

| Measure | Count |
| --- | ---: |
| Source rows, excluding headings | 144 |
| Unique target entities | 139 |
| Targets with direct profiles | 76 |
| Targets without direct profiles | 63 |
| No direct profile, but currently observed in batch/database feeds | 8 |
| No direct profile and not currently observed | 55 |

## Batch-covered without direct profiles

- Arlington
- Carrollton
- Denton County
- Fort Worth
- Lewisville
- Parker County
- Plano
- Tarrant County

These entities should not receive redundant direct scrapers until the batch
feed is confirmed insufficient. Model them as batch-covered target entities or
add a direct profile only with duplicate-safe source ownership.

## Targets not currently covered

### Main Target Entities Agg (33)

- Benbrook
- Johnson County
- Lake Worth
- Willow Park
- Justin
- Reno
- Weatherford
- Cresson
- Springtown
- Joshua
- Euless
- Colleyville
- Pelican Bay
- Farmers Branch
- Bedford
- Cedar Hill
- Cross Timber
- Grapevine
- Blue Mound
- Everman
- Rhome
- Bartonville
- Edgecliff Village
- River Oaks
- Marfa
- Graham
- Jacksboro
- Graford
- Bridgeport
- Wichita Falls
- Young County
- Jack County
- Palo Pinto County

### Add. Targer Entities for Agg. (22)

- Tyler, TX
- Clay County, TX
- Jones County, TX
- Wood County, TX
- Mount Pleasant, TX
- Kyle, TX
- Wilbarger County, TX
- Brown County, TX
- Burnet County, TX
- Blanco County, TX
- Llano County, TX
- Bexar County, TX
- Killeen, TX
- Bryan, TX
- Harker Heights, TX
- Pflugerville, TX
- Leander, TX
- Cedar Park, TX
- Schertz, TX
- Universal City, TX
- Boerne, TX
- Lockhart, TX

## Config profiles outside these target tabs

- Colorado County (`colorado-county-tx`)
- Upshur County (`upshur-county-tx`)
- Arlington ISD (`arlington-isd-tx`)
- Hurst-Euless-Bedford ISD (`heb-isd-tx`)

## Notes

- The source workbook repeats five entities across the two tabs: Azle,
  Mineral Wells, Wichita County, Williamson County, and Wise County.
- The Main tab contains plaintext portal credentials. They were excluded from
  this audit and should be removed from the workbook and rotated.
- A current database match proves that a feed has recently produced a bid; its
  absence does not prove a portal can never supply the entity. Each of the 55
  gaps still needs source verification before profile implementation.
