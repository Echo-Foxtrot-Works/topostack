---
type: fix
title: Flat coasts no longer lose their layers to stray elevation spikes
---
A few bad pixels in the elevation data, as along Tampa Bay's barrier islands, could stretch the layer steps until the land fit in one sheet, leave blank duplicate sheets under it, and block export with an empty layer. Those spikes are now repaired or ignored, and a stack never starts with more than one uncut base sheet. The export window also points to the LightBurn and xTool Studio project files under **Individual files**.
