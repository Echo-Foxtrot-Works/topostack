---
type: improvement
title: The studio opens with less to download
---
The studio now downloads about 24 KB (compressed) less JavaScript before it shows the first preview. The map-data loaders arrive with your first Generate or edit instead. Your first edit also reuses the background worker that drew the opening preview, where it used to start a second one. Generated models and exported files are the same as before.
