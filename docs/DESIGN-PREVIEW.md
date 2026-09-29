# Design preview

Run `npm run dev -- --port 4317`, then open http://127.0.0.1:4317/.
The original 3000 port is unavailable on this Windows host.
The completed production preview is currently http://127.0.0.1:8787/;
restart it using `npm run preview` (after `npm run build:worker` when code changes).

Home includes the approved Canva-derived layout and five navigable section pages:
`/work/advanced-rockets-engines`, `/work/chemistry-propellant`, `/work/electronics`,
`/work/education-outreach`, `/work/teamworks`.

The five section pages extend the homepage style; the reference only established
the homepage appearance, so they are design proposals rather than pixel copies
of unseen pages. All routes stay local and noindex.

## Image handoff

All labeled image regions are placeholders. No image uploader/backend is included.
Supply these originals when ready: hero propulsion photo, portrait, rockets cover,
chemistry cover, control panel, flight computer, outreach photo and team photo.
Landscape covers should allow both a wide desktop crop and a tall mobile crop;
portrait is 4:5. Keep full originals outside Git. Later add web-size derivatives
and per-image focal positions; final crop/contrast must be checked with real photos.

`src/components/photo-slot.tsx` is the single replacement point for image rendering.
`src/lib/portfolio.ts` contains section names, quotes and journey labels.
No client-selected files are persisted or uploaded in this design iteration.

Desktop: five category links, split biography, three history lanes, broad sections.
Mobile: expandable category navigation, single-column biography, three stacked
timelines with visible year labels, stacked images. Escape closes the navigation
and restores the menu-button focus. No horizontal-scroll-only navigation or diagram.

Temporary approximations: Georgia serif and text-only MARS mark. Original logo and
licensed font can be substituted with supplied assets. Palette follows observed
black/off-white/orange and sage/khaki/brick year colors; orange text is darkened
for readable contrast on light backgrounds. System dark mode does not recolor
the approved fixed light/dark section design.
