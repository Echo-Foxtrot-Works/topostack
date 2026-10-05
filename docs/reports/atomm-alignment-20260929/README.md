# Atomm 0.7.0 alignment investigation — 2026-09-29

The reviewer supplied only “Not aligned:” with no category or image. The user confirmed that 0.7.0 was reviewed. The findings below are reproduced layout inconsistencies, not a claim to know which item Atomm meant.

## Artifact and method

Inspected an extracted copy of `apps/generator/topostack-atomm-v0.7.0.zip`, whose release receipt records SHA-256 `e178d6591c7479e8c862fd1eac58aeb146746ca139debc2e60b709639bee1b49`. Served it locally inside an iframe. Automated measurements use an SDK stand-in and blocked API requests; this isolates layout against the bundled preview rather than testing native Studio or hosted Atomm. A separate browser inspection with live terrain reproduced the same offsets.

Expanded the parameter sections and Customize preset. Compared label start edges and control end edges with Cut size's Width row, accounting for text direction. Measured Chromium, Firefox and WebKit at 1600, 1280, 700, 390 and 320 CSS pixels, in LTR and RTL: 30 combinations.

## Confirmed candidates

| Where to look | Observed inconsistency | Cause |
| --- | --- | --- |
| Map details → Water depth → Limit depth layers | Label and switch inset an extra 16 px compared with neighboring rows | `.toggle-settings` provides 16 px margins, but `.atomm-switch-row` adds another 16 px padding. The existing reset covers numeric rows, not switches. |
| Map details → Text engraving → Engraving font | Label and select inset an extra 16 px compared with Text size immediately below | `.detail-group > .font-picker` supplies the gutter; its nested `.field-row` adds it again. |
| Linework → Customize preset → numeric line widths | All seven visible layered-mode width rows inset an extra 16 px compared with subgroup headings and other parameter fields | `.linework-controls` supplies 16 px margins; its `.field-row` children add another 16 px padding. |

The font selector is intentionally wider than numeric fields (110 vs 92 px); the defect is its end edge and label inset, not this width difference. In the 1280 px Chromium capture, normal controls end at x=1247; the affected controls end at x=1231. Normal labels begin at x=994; affected labels begin at x=1010.

Atomm's [current design rules](https://dev.atomm.com/docs/design/rules) prescribe property-card rows with 8/16 padding. A parent gutter plus a second row gutter produces 32 px instead. The earlier Nesting material regression compares only that card against Cut size and therefore does not cover these three groups.

## Verified candidate correction

Applied only as temporary browser CSS for this investigation:

```css
.atomm-workbench.atomm-workbench .toggle-settings .atomm-switch-row,
.atomm-workbench.atomm-workbench .atomm-font-picker .field-row,
.atomm-workbench.atomm-workbench .linework-controls .field-row {
  padding-inline: 0;
}
```

All measured label/control offsets were 16 px before injection and zero afterward (floating-point variation below 0.00004 px) in all 30 combinations. This is a focused layout check, not a full application regression. Flat-only controls, imported marker/path editors, dialogs, and authenticated hosted rendering were not exhaustively audited.

Source locations: `apps/generator/src/lib/atomm/atomm-workbench.css`, lines 768–769, 779, and 918. Application source and release artifacts were not changed during this investigation. Existing working-tree changes predate this audit. The next implementation step is to apply the scoped correction, add persistent regressions for the three groups, and rebuild/test the next submission.

## Evidence

- [Raw measurements](measurements.json)
- Font selector: [submitted](font-submitted.png), [proposed](font-proposed.png)
- Depth limit: [submitted](depth-submitted.png), [proposed](depth-proposed.png)
- Line widths: [submitted](linework-submitted.png), [proposed](linework-proposed.png)

The proposed screenshots show only the temporary CSS change. None is evidence of a rebuilt or resubmitted release.
