---
type: improvement
title: Minimum feature removes small pieces without coarsening contours
---
**Minimum feature** now only removes pieces, holes, and short lines smaller than the setting. Raising it to clear specks no longer simplifies the remaining contours and shorelines, which keep the same detail at every value. Projects that used a value other than 0.8 mm now draw contours at the default detail. See the [settings reference](/guides/settings-reference).
