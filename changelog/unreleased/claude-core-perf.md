---
type: improvement
title: Faster generation for large, detailed models
---
Generating a tall layered model with many roads and trails is about 5% faster, and the step that lays map detail onto each layer is up to a fifth faster. On a 3 m Grand Teton model with 193 layers and 300 roads, a full generation dropped from 19.9 s to 18.8 s and an edit to the annotations from 15.4 s to 14.4 s. The geometry and exported files are unchanged.
