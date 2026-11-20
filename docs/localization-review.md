# Localization review

The 17 non-English catalogs (`apps/generator/src/lib/i18n/messages/<locale>/`)
were machine-translated on 2026-11-19 with the terminology in
`messages/glossary.json`. Every catalog passes the structural checks in
`catalog.test.ts` (same keys and placeholders as English, well-formed plural
and select, renders without leftover syntax) and the e2e opens the embed in
each language and checks the layout. None has had a native-speaker review yet.

A reviewer should start with the notes below: the messages each translator
was least sure of. Beyond them, check in every language:

- **Terms against xTool Studio.** Where Studio's own localized UI names
  cut, score, engrave, layer, material or a panel differently, Studio's word
  wins (the glossary was not compared with it).
- **Plural agreement in warnings.** Several warnings list names and "and #
  more"; their verb or particle agreement was guessed.
- **The "wedding cake" image** for Class B airspace tiers, translated
  literally almost everywhere.
- **`terrain.everyUnit`**, a bare suffix after a number field, which reads
  awkwardly in most languages.

English cleanup found while translating: the airspace warnings
`airspaceAcrylicHeavy`, `airspacePiecesOverlap` and `airspaceTooComplex` say
"Plates or tiers", but the studio's options are named **Layered / Solid** and
**Whole slice / Shelves only**. Several translators used the option names.

## ja
- warnings.airspaceTerraced, waterInsertFailed/OnBottom/TooSmall/WholeSheet: count only chose verb agreement; kept as empty plural.
- status.projectImportedWithCharts: =1 / other split.
- aviation.ceilingCap(/Field) + matching warnings: 上限高度の制限 (alt: キャップ).
- labels.northArrowStyle.mariner: 海図風 (interpretation).
- terrain.linesUnit/everyUnit: 本 / 本ごと suffixes — check on screen.
- terrain.densitySparse/densityDetailed: terse.
- app.summaryTerrainContours, preview.legendIndexEvery, terrain.engravingSummaryDetail: index interval read as line count.
## fr / it
- aviation.ceilingCap: Plafond maximal / Tetto massimo (kept apart from glossary "ceiling").
- aviation.levelNote.tiers, formNote.tiers: "wedding cake" translated literally.
- customdata.iconAnchorGroup: rewritten as a label (possessive agreement).
- preview.legendWaterPattern other: raw pattern id (unknown patterns only).
- water.showAllLakes one: fr "Afficher le lac"; it mirrors English.
- preview.nestingBy: it "Nesting di" (glossary), fr "Imbrication par".
- fr uses "calque" for non-physical layers (app.summaryAviationLayers, labels.fontGroupHint.outline); it unchecked.
## pl / cs / sl
- terrain.everyUnit: bare word after number input, awkward.
- warnings.waterInsert*, airspaceTerraced: list subject + "and # more" agreement guessed.
- pl customdata.markerIconLimit/graphicLimit: "Limit …: {max}".
- Counts after a colon to avoid agreement: summaryFeatures, summaryAviationLayers, summaryLabels, drawFew/ManyPoints, place.lakesMatching/Available.
- sl water.showAllLakes: "Prikaži vsa jezera (#)" for all counts.
- sl "Cut panels" = segment(i).
- cs aviation.ceilingCap: "Omezení výšky".
- status.starterNotFound/starterOpened: starter = project template.
- cs warnings.airspaceAcrylicHeavy: "{footprints}krát".
- labels.fontGroupHint.outline: software layer vs physical (sl rephrased, pl "warstwa graweru").
- Airspace warnings use UI option names for plates/tiers.
- Register: pl informal ty; cs polite plural; sl polite plural sentences, singular buttons.
## zh / zh-hant
- warnings.airspaceTerraced, waterInsert*: count plural only carries verb; Latin names render "Lake B及另外 2 个" (no space).
- aviation.level.tiers / formNote.*: 婚礼蛋糕 metaphor; shelves 台阶/階層, plates 整片.
- terrain.everyUnit: 条间隔 / 條間隔 — check visually.
- terrain.materialSavingNests, exportPointer: 省料嵌套 (not 排版 — cavity nesting, not sheet nesting).
- preview.nestingBy: 排版引擎.
- warnings.airspaceNotLoadedPreview: "open it in TopoStack" (avoid confusing with xTool Studio).
- place.lakesMatching/Available: basin 湖盆.
- warnings.mapServiceFallback: 确定性示例地形 / 固定的範例地形.
- Panel names Fabricate 制作, Features 要素 / 圖徵 — xTool Studio's Chinese labels should win if different.
## de
- terrain.everyUnit: "Linien" — check in UI.
- labels.marks / app.summaryLabels: "Kartenzeichen".
- app.panelFeatures "Elemente", features.title "Kartenelemente", app.summaryAviationLayers "Elemente" (avoid Ebene).
- app.summaryWaterCarvedDepth: "Tiefe in Schichten".
- Seams: Naht/Nähte; cut panels "Schnittteile" (no glossary term).
- artwork = "Vorlage"; starter = "Startprojekt".
- terrain.explode/exploded: Explosionsansicht / Auseinander.
- Keys: place.redoHint "Strg+Umschalt+Z" vs placement hints "Shift" — inconsistent.
- water.insertsNeedDepth: assumes {setting} = Water depth label.
- Added count plurals for verb agreement in waterDepthClamped, workAreaOversize.
## id / vi
- status.projectImportedWithCharts: =1 case.
- preview.nestingProgress: "layout {layout}" is an update counter.
- aviation.level.tiers / formNote.*: "wedding cake" literal.
- vi customdata.donePlacing shortened to "Xong".
- vi features.localRoads: Đường nội bộ vs Đường địa phương.
- id svgClipping: "Clipping path dan mask" kept English.
- vi acrylic = "Mica" (glossary).
## es / pt-BR
- ENGLISH CLEANUP: warnings.airspaceAcrylicHeavy/airspacePiecesOverlap/airspaceTooComplex say "Plates or tiers", which match no current UI option label (several locales used the visible option names instead).
- water.insertsNeedDepth: rephrased to avoid gender agreement on {setting}.
- water.showAllLakes one: number dropped.
- warnings.waterDepthClamped one: drops # ("la plancha").
- domain.moduleGeometryEngine & siblings: lowercase in pt-BR (mid-sentence), capitalised in es.
- pt-BR "design" kept distinct from "projeto".
- features.landKind.tribal: es "Tierras tribales", pt-BR "Terras indígenas".
- "wedding cake" literal.
- es keys: Shift, Enter, Supr; pt-BR Delete.
## ko / th
- terrain.everyUnit: ko 번째마다 ok; th เส้นต่อเส้นหลัก may be long.
- terrain.linesUnit: ko 개 (alt 줄/선).
- warnings.airspaceTerraced, waterInsert*: count plural holds particle/verb only.
- ko aviation.build.solid 통짜 (alt 일체형, more formal).
- ko features.landNotCovered/landFromOpenStreetMap: nested parentheses.
- labels.northArrowStyle.mariner: ko 항해용, th แบบเดินเรือ.
- ko non-glossary: panelFeatures 지형지물, customdata 사용자 데이터, water.insertsAndPaint 인서트와 채색.
## ru / uk
- Units kept as English abbreviations (mm, in, ft, MB) to match units the code passes in.
- levelCaption / terrain.altitudeMsl: MSL spelled out (над уровнем моря / над рівнем моря).
- classBAirspace/classCAirspace long form vs classB short.
- "wedding cake" literal.
- Marks = Обозначения / Позначки; uk Download "Завантажити" = same verb as loading.
- Placeholders after a colon to avoid case endings: workAreaUnsplit, airspaceTooComplex, workAreaOversize, domain.moduleLoadFailed (lowercase module names), status.projectImportedWithCharts =1.
- place.cutSize / artworkSize: product size / engraving size.
