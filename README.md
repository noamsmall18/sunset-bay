# Sunset Bay

An open-world driving-and-shooting sandbox in the browser. The city remains
procedural, with a small authored photo set layered into the title card and
rooftop billboards across the map. Procedural fallbacks keep the core game
playable if the optional `assets/` folder is unavailable.

## Run it

```bash
git clone https://github.com/noamsmall18/sunset-bay.git
cd sunset-bay
node build.js                 # writes dist/sunset-bay.html and index.html
python3 -m http.server 8123   # then open http://127.0.0.1:8123/index.html
```

`dist/` is not in the repository - it is produced entirely from `src/`,
`assets/` and `vendor/` by `build.js`, and a clean clone rebuilds it
byte for byte. Nothing else is generated: everything the game needs to
build is tracked.

`index.html` is the dev page: each module loads as its own `<script>` so stack
traces point at real files and lines. `dist/sunset-bay.html` is the shipped
build with everything inlined; its optional photos are mirrored into
`dist/assets/`. Both run identical code.

### URL flags

| flag | effect |
|---|---|
| `#dev` | runs the start-up self test: steps every system 600 fixed frames and reports any exception or non-finite state to the console before play begins |
| `#touch` | forces the touch control layer on, for testing the mobile build from a desktop browser (`#notouch` forces it off) |
| `#quality=auto\|low\|medium\|high` | selects the adaptive or fixed graphics budget |
| `weather=sun\|rain\|snow\|night` | dev-only starting weather, useful for checking each state quickly |

Flags combine with commas: `#dev,touch,quality=low`.

## Controls

Phones and tablets get an on-screen control layer automatically. Left thumb is
a floating stick for movement, steering, or flight attitude: push up/down to
pitch and left/right to bank a plane. The right cluster is context sensitive:
combat controls on foot, driving controls in cars and boats, BOOST / AIRBRAKE
in a plane, and ASCEND / DESCEND in a helicopter.
Anywhere else on screen is a camera drag. AIM is a toggle rather than a hold,
because holding it would cost the thumb that fires.

Keyboard and mouse:

| | |
|---|---|
| Move / drive | `W A S D` |
| Look | Mouse |
| Sprint / handbrake | `Shift` / `Space` |
| Plane pitch / bank | `W` / `S` and `A` / `D` |
| Plane boost / airbrake | `Shift` / `Space` |
| Helicopter ascend / descend | `Space` / `C` |
| Jump | `Space` |
| Swim rise / dive | `Space` / `C` while in open water |
| Enter / exit vehicle | `F` |
| Board a train | `F` at the cab, once it has stopped at a platform |
| Train throttle / brake | `W` / `S` (`Space` for full brake) |
| Vehicle special ability | `V` in an ability-equipped car |
| Interact, doors, shops, garage | `E` |
| Enter / leave yacht cabin | `E` near the cabin prompt |
| Aim / fire | Right mouse / Left mouse |
| Weapons | `1`-`5`, mouse wheel |
| Reload | `R` |
| Horn | `H` |
| Radio / station | `B` / `N` |
| Map (scroll to zoom, drag to pan) | `M` |
| Rank, stats and unlocks | `P` or `Tab` |
| First / third person | `G` |
| Photo mode (free camera, HUD off) | `X` |
| Controls card | `F1` |
| Performance settings | `F2` |
| Cycle weather | `T` (or `WX` on touch) |

## Playing on a phone or tablet

The game detects a touch device and adapts on its own:

- **Controls.** The touch layer writes named actions into the same input
  surface the keyboard feeds, so there is not a single gameplay branch for
  "mobile" anywhere in the code. Pointer lock is never required.
- **Layout.** The HUD scales to the short edge of the screen and moves out from
  under your thumbs: the radar goes top-left, the speedometer to the bottom
  centre, and everything clears the notch and home indicator through the
  `safe-area-inset` values. Button placement is verified to have no overlaps
  and no off-screen controls from a 667x375 iPhone SE up to a 1366x1024 iPad
  Pro, with every tap target at least 44px.
- **Performance.** The render loop targets a 10 ms frame budget (100 FPS on a
  display that supports it). Auto mode adapts resolution first, then reduces
  post effects, lights, traffic, and pedestrians when the target is missed;
  manual Low / Medium / High presets are available from the title card or `F2`.
  A 60 Hz display is reported as display-limited instead of being misreported
  as a failed 100 FPS target.
- **Behaviour.** Landscape is requested (with a rotate prompt in portrait),
  fullscreen and orientation lock are attempted where supported, pinch zoom and
  double-tap zoom and pull-to-refresh are suppressed, and switching apps pauses
  the game rather than dropping you back into a chase.

## What is in there

- **The city.** Roughly 2 km square, and deliberately not a grid. Each region
  lays its streets in its own idiom and the change is obvious as you drive
  between them: a warped radial web downtown, a bowed and irregular midtown, a
  suburb of looping crescents and cul-de-sacs, hillside switchbacks with
  contour roads holding their elevation around each summit, a straight-ruled
  port, and a beachfront promenade combed with side streets. Blocks are not
  authored - they are recovered from the road network itself by planar face
  traversal, so a block is literally whatever shape the streets around it
  leave behind, and buildings are set back along each frontage rather than cut
  out of a rectangle. Seven districts, procedurally generated buildings,
  storefronts, parks, plazas, surface lots, a drivable multi-storey car park,
  four stunt ramps, a beach, two marinas, a general-aviation airport, and three
  functional helipads.
- **The freeway.** An elevated ring with a cross-city spur, ten on/off ramps
  and piers dropping to whatever the ground is doing underneath. The decks are
  real surfaces with solid parapets: traffic drives them, you can drive them,
  and you can go over the side.
- **The railway.** A loop line running on embankment where there is room and on
  viaduct where there is not, with six stations. A train works the timetable on
  its own - and if you step into the cab while it is stopped, it hands you the
  throttle and the brake.
- **The land.** A real height field rather than a flat plane, with hills rising
  to about 90 m and a shore that shelves into the water. Roads are *carved into*
  that height field rather than laid on top of it, which is what makes a
  switchback drivable - and the field the physics reads is the same one the
  ground mesh is built from, so what you see and what you collide with cannot
  disagree.
- **Driving.** A bicycle model with four raycast wheels: load transfer, per-axle
  slip angles through a simplified Pacejka curve, a friction circle, a torque
  curve with an automatic gearbox, and a handbrake that will step the rear out.
  Fourteen vehicle classes with genuinely different handling, from compact and
  hatchback commuters to a supercar, rally car, pickup, and armored unit.
  Ability-equipped cars add nitro/overdrive, a reinforced ram, or an impact
  charge that can detonate another car on a direct collision; abilities are
  cooldown-based and shown on the speedometer.
- **On foot.** Third-person movement, sprint with stamina, jump, aim, five
  weapons with hitscan tracing from the camera, melee, headshots, and buoyant
  open-water swimming with surface ripples and a front-crawl pose.
- **Water.** The ocean is a tessellated, animated wave surface with normal
  detail, environment highlights, weather response, wakes, shoreline foam, and
  a shared water-height query used by swimmers and boats.
- **Traffic and crowds.** Up to 46 AI cars running the same physics as yours,
  obeying signals, following lanes, using the freeway ramps, honking and
  panicking; up to 44 pedestrians walking block perimeters, crossing to
  neighbouring blocks and scattering from gunfire.
- **Police.** Five wanted levels, pursuit driving over the road graph,
  officers who dismount and shoot, roadblocks from three stars, a helicopter
  from four, SWAT at five, and a search phase you can slip once you break line
  of sight. Pay 'n' Spray clears the heat.
- **Interiors.** Every one of the 1,169 generated city buildings has its own
  entrance and its own interior instance. Sixty-one authored venues anchor ten
  major templates (stores, gun shops, diners, nightclubs, apartments,
  warehouses, banks, hotels, offices, and clinics); the other 334 addresses are
  seeded into distinct lofts, ateliers, garages, arcades, salons, recording
  rooms, restaurants, labs, warehouses, dojos, studios, and penthouses. They
  are staged as explorable sets with upper floors, landings, stairs and ramps;
  club stages and VIP booths; diner kitchens and jukeboxes; gun ranges;
  warehouse racks and forklifts; hotel elevators; boardrooms and server walls;
  clinic triage stations; bank security monitors, ATMs and vaults; plus hidden
  stashes, notes, displays, and 2,685 interior hotspots. Banks have alarms and
  robbery payouts that trigger a wanted response.
- **Boats and aircraft.** Driveable jet skis, speedboats, yachts, fishing boats,
  sailboats, dinghies, catamarans, and patrol boats with buoyancy, grounding,
  wakes, and marine handling.
  The yacht has an attached, walkable salon/helm cabin with furnished interior
  bounds and a return-to-deck exit. Flyable Skyhawk and Twinprop prop
  planes, a four-engine Boeing 747, a fast F-35-style fighter, a seaplane,
  and a stealth jet share the same assisted flight model with taxi, takeoff,
  stall, landing, and damage behavior; helicopters add hover, collective,
  landing, and rotor animation. Air vehicles can leave the city boundary while buildings still
  collide normally. All are discoverable on the map and spawned at
  infrastructure you can reach on foot.
- **Missions.** A fourteen-job story chain that pushes out into every system the
  city has - fragile freight across town, running a car off the road, a boat run
  to a drop off the point, a flight out to the far strip and back, a three-wave
  siege at the lockup, and a five-star run for the airfield gate.
- **Contracts.** The chain ends; the work does not. A generator builds real
  missions - the same stage types, the same runner, the same failure states -
  out of whatever the map actually contains, and keeps one on offer at all
  times: courier runs, repossessions, corner sweeps, runners, fragile freight,
  hold-the-line stands, harbour drops and airlifts. Job types and difficulty
  open up with rank, and the fee scales with both.
- **Rank and progress.** Everything you do pays respect as well as money:
  jobs, contracts, stunt jumps, bank vaults, losing a chase, driving a class of
  car for the first time, walking into a building you have not been in.
  Ten ranks, each with a cash bonus and unlocks behind it, and a full stats page
  on `P` showing the record of the run - work, heat, distance travelled by each
  means, top speed, interiors found and what is still locked.
- **Your garage.** The multi-storey car park has a bay with your name on it
  from rank three. Drive a car in and press `E` to leave it there; come back on
  foot and press `E` to pick from what you have stored, bring one out repaired,
  respray it, or spend money on it. Engine, brake and tyre upgrades multiply
  the real handling fields the physics reads, so a built car genuinely drives
  differently. Bay count grows with rank, and the garage is part of the save.
- **Damage you can see.** Cars deform where they are actually hit - a ram, a
  wall, a burst of rifle fire - and their glass crazes and then goes out as
  the shell gives up. A Pay 'n' Spray or a night in the garage beats the
  panels back out.
- **Saving.** The run persists. Money, rank, every statistic, story progress,
  weapons and ammunition, the time of day and the weather are checkpointed to
  local storage on a slow timer and immediately on anything that matters, and
  the title card offers CONTINUE with a summary of the saved run. Because the
  city is deterministic from a fixed seed, a save stores only what you did to
  it - under two kilobytes - and a save from an older build still loads.
- **A city with a clock.** Traffic and pedestrian density, the parked-car
  population and the mix of what is actually on the road all follow the time of
  day. The small hours are close to empty and the streets are full of parked
  cars; deliveries start before dawn; the morning and evening rush fill the
  roads with commuters; cabs take over after ten. Rain and snow keep people
  indoors, cars much less so. The HUD names the hour's character next to the
  clock.
- **Camera.** A first-person view on foot and in every vehicle (`G`), and a
  photo mode (`X`) that stops the world, hides the HUD and gives you a free
  camera to fly.
- **Live weather.** Cycle clear sun, rain, snow, and a forced night front in
  the middle of a session. Rain lays down reflective puddles, reduces tire
  grip, adds foot slips and lightning; snow accumulates in drifts, slows and
  bogs vehicles, changes footing, and sends three animated snowplows around
  the road graph. Every state fades through the analytic sky, fog, lamps, and
  precipitation rather than swapping a static backdrop.
- **Presentation.** A full day/night cycle with an analytic sky, rain and fog,
  an environment probe rebuilt from the current palette, HDR bloom, and a
  synthesised soundtrack and sound effects.

## Layout

```
src/00-core.js        math, RNG, spatial hash, input, fixed-step loop
src/01-textures.js    every texture, painted with Canvas2D
src/02-layout.js      regional road generator, block extraction, lane graph,
                      signals, rail alignment
src/03-world.js       collision boxes, drivable surfaces, raycasts
src/04-geom.js        quad-soup builder, geometry merge, instancing
src/04b-terrain.js    height field, road carving, ground mesh, road decks
src/05-city.js        pavements, block surfaces, buildings
src/06-sky.js         sky shader, day/night, weather, ocean, IBL probe
src/07-vehicle.js     vehicle bodies and the driving model
src/08-props.js       street furniture, planting, garage, beach, pier
src/09-characters.js  the humanoid rig and its procedural animation
src/10-fx.js          particles, tyre marks, tracers, explosions
src/11-traffic.js     vehicle manager and traffic AI
src/12-player.js      player movement, vehicle entry, camera
src/13-peds.js        pedestrians
src/14-combat.js      weapons and hitscan
src/15-police.js      wanted level, pursuit, roadblocks, helicopter
src/16-interiors.js   enterable buildings, shops, Pay 'n' Spray
src/17-missions.js    mission chain, side jobs, enemy AI
src/18-hud.js         radar, vitals, mission text, shops, map
src/19-game.js        bootstrap, staged loading, main loop, self test
src/20-startup.js     title card, loading bar, pause
src/21-audio.js       WebAudio synthesis for everything you hear
src/22-post.js        screen-space pipeline: SSAO, SSR, shafts, motion blur,
                      bloom, grade, FXAA
src/23-quality.js     device detection, quality tiers, 100 FPS adaptive budget
src/24-touch.js       touch controls: thumbstick, action cluster, camera drag
src/25-lights.js      the roving pool of real lights used at night
src/26-boats.js       generated boats, buoyancy, marine handling and wakes
src/27-aircraft.js    flyable planes and helicopters plus ambient air traffic
src/28-infrastructure.js airport, marinas, helipads, signs and craft spawns
src/29-weather.js     live precipitation, surface conditions, puddles, drifts,
                      snowplows, lightning, and storm lighting
src/30-freeway.js     elevated freeway decks, parapets and piers
src/31-rail.js        track, viaduct, stations and the drivable train
src/32-rooftops.js    rooftop billboards and roof-level detail
src/33-progress.js    rank, respect, statistics and rank-gated unlocks
src/34-save.js        capture, restore and autosave of a run
src/35-garage.js      the personal garage: storage, respray, upgrades
src/36-rhythm.js      the city's daily rhythm: population and mix by hour
src/37-camera.js      first person and photo mode, layered on the follow rig
```

## Notes

- Three.js is pinned to `0.160.1` from cdnjs, the last version that ships a UMD
  build. ES module CDNs are blocked in the published-page sandbox.
- Buildings are batched per material **and** per map chunk. Without the chunk
  split each batch spans the whole map, never frustum-culls, and you pay for the
  entire skyline every frame and again in the shadow pass. The map's growth
  needed the chunk grid to grow with it, or each batch simply got bigger again.
- Interiors are kept out of the scene until you walk through a door. With one
  interior per building that is around 27,000 meshes that would otherwise be
  traversed and culled every frame for rooms nobody is standing in - it cost
  more than the entire visible city, and hiding them took the frame from about
  380 ms to 74 ms at full resolution.
- Blocks come out of the road graph, so the generator's job is to draw streets
  that leave good shapes behind. Curve wobble is capped below street spacing
  for exactly this reason: when two neighbouring curves cross, the block
  between them becomes a sliver instead of somewhere to build.
- The simulation runs at a fixed 60Hz step, so handling is reproducible and the
  self test can drive it directly.
- Effects are all switchable and tier-gated: the low tier keeps only bloom and
  FXAA, which is what lets the same pipeline run on a phone.
- Gameplay code asks the input layer for named actions (`act('fire')`,
  `actHit('enter')`, `moveAxis()`), never for raw keys. That indirection is the
  only reason the touch layer could be added without touching the player, the
  combat or the interior code.
- Routing is one Dijkstra from the *destination*, cached, rather than a search
  per hop. That single field answers "next node toward the target" for every
  node in the city at once, so the navigation line and every pursuing patrol
  car share the same computation: 1.9 ms to build a field for a new
  destination, 0.004 ms per route after that. The previous code ran a complete
  breadth-first search for every waypoint on the path, about 3.7 ms for a
  cross-city route and nothing cached between calls. Edges cost travel time
  rather than one hop each, with a junction penalty and a ramp penalty, so the
  router prefers an avenue over threading twenty side streets and takes the
  freeway only when it is genuinely quicker.
- Precipitation is two shapes, not one shape in two colours: rain is a line
  segment leaned along its own velocity, snow is a soft round sprite. The sky
  module still carries its own particle rain as a fallback, but it stands down
  when the weather module is present - running both drew two rain systems over
  each other and paid for 2,600 extra particles a frame to do it.
- A save stores no world. The city, its buildings and all 1,004 interiors are
  deterministic from a fixed seed, so persistence only has to record the
  difference the player made.
- Body damage is copy-on-write. `carGeometry()` is cached per vehicle *class*,
  so denting it directly would dent every sedan in the city at once; a car
  clones its body the first time it is hit and hands the clone back when it is
  recycled into the pool. Most cars in a session are never touched, and paying
  for a clone up front for all of them would cost far more than the effect is
  worth.
- A car fetched from the garage has its height set explicitly rather than by
  `Vehicle.placeAt`, whose surface query starts 50 m up and therefore finds the
  *roof* of a three-deck car park. The per-wheel suspension query is relative
  to the car's own height, so once it starts on the ground floor it stays
  there.
- The daily rhythm scales population rather than replacing the budgets: the
  quality tier still owns the hard caps, the interior gate still owns
  `density`, and the rhythm is a third multiplier on top. When the hour calls
  for fewer cars the surplus is retired from beyond 90 m rather than left to
  drift away on its own, which is what used to keep the streets rush-hour full
  for minutes after the rush.
- `#dev` now also proves the systems most likely to break silently: that
  every routed path is made of real edges and is cost-optimal by the Bellman
  condition, that every contract type generates a runnable job with finite
  targets, that a save captured and re-applied is lossless, that a car stored
  and fetched from the garage comes back in its bay with its upgrades reaching
  the physics and without leaking into the shared spec, and that a dent stays
  private to the car that took it and is fully undone by a repair.
