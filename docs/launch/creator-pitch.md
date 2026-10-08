# Creator pitch

For YouTube, Instagram and TikTok laser creators, and for bloggers who write laser tutorials. The aim is honest feedback from people who cut things for a living. A mention is welcome but never the ask.

## Before you write

Assign one of `creator-01` through `creator-10` in a private outreach log. The examples below use `creator-01`; replace that slot consistently for each creator and retain it in their public video links. Never add names or email addresses to tags. These links require the week 1 attribution release. Direct JSON downloads are not tracked; send the example page as the main entry point.

- Pick creators who already make maps, terrain or layered pieces, and watch at least one of their recent videos. Refer to it specifically, or don't send the message.
- Send five at a time, and log who you wrote to and when. Don't follow up more than once.
- Find the contact route each creator lists (a business email or a "collabs" DM). Don't comment on their videos.
- Pick an example that suits their machine and style (see the table below). For a small diode or Glowforge-sized bed, mention splitting.

## Email / DM template

**Subject:** A free topo map generator, if it's useful for a future video

> Hi [name],
>
> I liked your [specific video or piece] — [one honest sentence about what stood out].
>
> I build TopoStack, a free, open-source browser studio that turns any place into layered laser-cut topographic maps or flat engravings. It uses real elevation data, and lake-floor depths for more than 8,000 lakes. It exports millimetre-scaled SVGs with an assembly guide, can split maps bigger than your bed into puzzle-tab pieces, and nests parts onto your sheets. No account, nothing to pay.
>
> If you ever want to try it, here's a ready-made project file you can download and import. It's [place], set up for [thickness] material:
> [example page link from the table below]
>
> I'm not asking for a video or a mention. What would help most is honest feedback from someone who actually cuts: what's awkward, what's missing, and whether the files behave in [their software]. The pictures on the site are software renders; Community makers have shared physical builds, and I'd value your experience with a complete project on your machine.
>
> If you do end up showing it, please use this link, which lets me see which walkthroughs helped people:
> https://topostack.app/?utm_source=social&utm_medium=video&utm_campaign=creator&utm_content=creator-01
>
> Thanks either way,
> [name], Echo Foxtrot Works
> https://github.com/Echo-Foxtrot-Works/topostack

Short DM version (Instagram, TikTok):

> Hi [name], I build a free, open-source tool that turns any place into layered laser-cut topo map files (real elevation, lake depths, splitting for small beds). No ask beyond honest feedback if you ever try it. Here's a ready-to-import project: [example page link]. The site's images are renders, so a real cut would tell me a lot.

## What to include

Pick one example; don't paste the whole list. Each example page has the settings, a render and a **Download the project file** link. The studio imports that file directly ("Import project JSON" next to the project name).

| Example | Suits | Page (email link) | Project file |
| --- | --- | --- | --- |
| Grand Canyon, 406 × 271 mm, 15 layers | Big-bed CO2 creators; dramatic relief | https://topostack.app/examples/grand-canyon?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | https://topostack.app/examples/grand-canyon.json?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 |
| Yosemite Valley, 406 × 271 mm, 18 layers | Recognisable landmarks | https://topostack.app/examples/yosemite-valley?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | https://topostack.app/examples/yosemite-valley.json?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 |
| Mount Rainier, 300 mm circle, 23 layers | Round wall pieces | https://topostack.app/examples/mount-rainier?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | https://topostack.app/examples/mount-rainier.json?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 |
| Mount Fuji, 300 mm circle, 28 layers | Clean nested rings; international audience | https://topostack.app/examples/mount-fuji?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | https://topostack.app/examples/mount-fuji.json?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 |
| Matterhorn, 300 × 300 mm, 28 layers | Alpine and European audience | https://topostack.app/examples/matterhorn?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | https://topostack.app/examples/matterhorn.json?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 |
| Lake Tahoe, 271 × 406 mm, 14 layers, surveyed lake floor | Lake-map creators; painting water | https://topostack.app/examples/lake-tahoe?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | https://topostack.app/examples/lake-tahoe.json?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 |
| Crater Lake, the studio's opening project | "Open the studio and press Generate terrain" | https://topostack.app/examples/crater-lake?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01 | Loads in the studio by default |

Layer counts come from each capture in `apps/generator/static/examples/<slug>.json` (3.175 mm material). They change if the creator picks a different thickness. The query string on a `.json` link does nothing but is harmless; it is there so every link follows one scheme.

For a creator interested in depth charts, the Walden Pond example project includes a reviewed USGS chart: [docs/images/walden-example/walden-project.json](../images/walden-example/walden-project.json) ([notes and limits](../images/walden-example/README.md)). Link to it on GitHub, and mention that it demonstrates the workflow and is not a survey-accuracy claim.

Guides worth linking, depending on the creator (in any link they might paste into a video description, replace `utm_source=other&utm_medium=email` with `utm_source=social&utm_medium=video`):

- Layered map from start to finish: https://topostack.app/guides/laser-cut-topographic-map?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01
- Flat engraving: https://topostack.app/guides/topographic-map-engraving?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01
- Small beds: https://topostack.app/guides/split-large-maps?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01
- Painting water: https://topostack.app/guides/water-paint-templates?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01
- Lake depth maps: https://topostack.app/guides/custom-lake-depth-map?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01
- Export files, colours and kerf: https://topostack.app/guides/export-files?utm_source=other&utm_medium=email&utm_campaign=creator&utm_content=creator-01

## After a reply

- Answer questions quickly, and turn anything confusing into a guide fix or an issue.
- If they cut something and are happy for you to share it, ask for permission in writing and credit them by name. That is the first real build photo, so update [media.md](media.md) and the post drafts.
- Never offer payment in exchange for a positive review.
