# Changelog

Versions are 0.MINOR.PATCH until 1.0: a new MINOR for a release with new things in it, a new PATCH for one
that only fixes. The version is `package.json`'s; the main menu shows it, and the builds copied to Downloads
carry it in their names (`Blueberry Playground 0.2.0.html`, `Blueberry Playground 0.2.0.exe`).

## 0.5.0 — 2026-11-19

Ballistic missiles and ICBMs, a heat-seeker launcher, a radar that locks on and guides missiles, a T-90A, a
rotary cannon, rocket pods and three Second World War fighters. It also runs better on Chromebooks and
iPads in the browser.

### New

- **Two new missile versions**, in every launcher's menu (Missile:):
  - **Ballistic**: the standard warhead at twice the speed, lobbed high on an arc to come down on its target.
  - **ICBM (3)**: three missiles at once, each with three times the warhead and three times the speed, on a
    higher arc. They never collide with each other. On the Spike LR-II they share out the targets it tracks.
- **Heat-seeker launcher.** Fires straight up its tube and the missile turns for the hottest thing it sees:
  engines, flames, thrusters, flares. It goes off beside its target (a proximity fuse) rather than having
  to hit it.
- **Radar and radar-guided launcher.**
  - Select the radar, hold F on something and the box's corners flash green while it locks (about a
    second). Let go once it's locked.
  - Locked, a green box sits round the target, as the Spike LR-II's does, with a readout: range, height,
    climb and speed. A target out of sight is held in memory for 2.5 s, then lost. Range: 6 km.
  - Wire a radar-guided launcher to the radar (or build them together) and it fires on the radar's lock.
    Its missile follows the radar's track to the end and goes off near the target.
- **T-90A**, the Russian main battle tank: Kontakt-5 armour bricks, Shtora's red eyes, fuel drums on the
  back and a 125 mm gun. Armies can bring it.
- **Rotary cannon.** Hold F (or the pilot's gun key in a build) and it spins up for a third of a second,
  then fires 100 rounds a second from 500.
- **Rocket pod.** Nineteen unguided rockets: F fires one, holding F ripples them off, 9 fires one from a
  piloted build. The rockets light in the tube and fly straight and fast, dropping a little.
- **Warbirds**, a new group on the Aircraft shelf. Each sits on its tailwheel and lifts its tail as it gathers
  speed:

  | Aircraft | Guns | Bombs | Rockets |
  |---|---|---|---|
  | P-51D Mustang | six .50-calibre machine guns, 1,840 rounds | 1 | 8 |
  | Focke-Wulf Fw 190 A-8 | four machine guns and cannon, firing in turn, 1,200 rounds | 2 | 4 |
  | Yakovlev Yak-9K | a 45 mm NS-45 cannon firing tank shells through the propeller hub, 29 rounds | 1 | 2 |

  `\` fires the guns, 0 drops a bomb, 9 fires a rocket. Bombs and rockets hang under the wings until
  they go.

### Low-end devices (Chromebooks, iPads, phones)

- **The game picks its starting settings from the device.** Chromebooks, iPads, phones and computers with
  four cores or 4 GB of memory or less start on the new **Low** preset: 75% resolution, four lights, half
  the effects, few spent cases, 60 fps. Very weak ones (two cores or 2 GB) start on Potato. Other touch screens
  start on Medium, as before. A setting you've already chosen is kept.
- **Auto quality** (Settings > Graphics, on by default). When the frames fall well behind:
  - if drawing is what's slow, it lowers the resolution a step at a time;
  - if the game's own work is what's slow, it halves the effects and allows at most four lights.

  It gives them back once the frames have kept up for a while, and waits longer if it gave them back too
  soon. Show stats says when it's lowered something.
- The water keeps fewer particles on a Chromebook, iPad or phone (1,600), and fewer still on a very weak one.
- With time paused, finding what's under the cursor tested every collider in the scene, every frame. It now
  tests only those nearby: 1.5 ms a frame among 25 people became 0.01 ms.
- The stats line no longer rewrites the page every frame when nothing has changed.

### Fixes

- A propeller cut up the plane's own rockets as they passed through its disc.
- A missile fired from a moving aircraft counted itself clear of its launcher once it was 2.5 m from where
  it was fired, even with the aircraft still beside it. It now measures the distance from the launcher.
- The Medium preset's 6 lights wasn't one of the choices, so Medium read as Custom after a reload. It now
  has 8.

## 0.4.5 — 2026-11-19

Prebuilt aircraft: a new Aircraft shelf with one of each of the FAA's seven aircraft categories, and under
Airplane two airliners, two light aircraft and two military jets. Each is drawn to the real one's measurements
and flies by its numbers. Each breaks apart the way the cars and tanks do.

### New

- **The Aircraft shelf**, grouped by FAA category:

  | Category | Aircraft |
  |---|---|
  | Airplane · Commercial | Boeing 737-800, ATR 72-600 |
  | Airplane · General aviation | Cessna 172S Skyhawk, Cirrus SR22 |
  | Airplane · Military | F-16C Fighting Falcon, A-10C Thunderbolt II |
  | Rotorcraft | UH-60 Black Hawk |
  | Powered-lift | V-22 Osprey |
  | Glider | Schleicher ASK 21 |
  | Lighter-than-air | Hot-air balloon (Cameron O-105) |
  | Powered parachute | A two-seat cart under a ram-air canopy |
  | Weight-shift-control | A trike under a flexwing |

- **Flying them.** Select one, or sit someone in it, then:
  - W and S work the throttle (a helicopter's collective, a glider's airbrakes, a balloon's burner and vent).
    The throttle stays where you leave it.
  - Q and E pitch it. Stability assist (`` ` ``) holds the attitude you let go at, and lowers the nose if the wing
    stalls.
  - A and D brake on the ground; on the Osprey they tilt the nacelles.
  - F starts the engines; on the glider it starts a winch launch.
  - The other pilot keys do what you'd expect: `[` flaps, `;` afterburner, `\` gun, Caps Lock flares, `'` eject,
    `]` the SR22's whole-aircraft parachute, Insert autopilot, `,` lights.
  - The readout shows speed, height, climb, angle of attack and g. It warns about a stall or overspeed.
- **Flight model.** Each type flies by its real wing area, aspect ratio, weight, engine thrust or power,
  never-exceed speed and g limit:
  - Wings and tails lift, stall and drag. Flaps add lift.
  - Jets lose thrust as the air thins; airliner turbofans also lose some with speed. Propellers trade thrust
    for speed.
  - Rotors lift by momentum theory: translational lift, ground effect, less lift climbing, retreating-blade
    stall when fast, and autorotation with the engines off.
  - Airliners hit wave drag near the speed of sound.
  - The balloon floats on hot air: about 1 °C a second from its burner, slowly cooling.
  - Hung wings fly at their trim angle to the air, so the throttle sets climb, not speed.
- **Checked against the real aircraft:**
  - Take-off: the Cessna lifts off at about 29 m/s after about 210 m. The F-16 on afterburner lifts off at
    86 m/s after about 390 m.
  - Hover: the Black Hawk hovers at about 62% collective and climbs 10 m/s at full.
  - Gliding: the ASK 21 glides about 27 m for every metre it sinks.
- **Destruction:**
  - A landing harder than the gear is built for folds a leg. A gear hit far past that drives the strut into
    the airframe.
  - Crashes, bullets, blasts and fire wreck and tear the airframe into debris, and the fuel goes up.
  - Pulling past 1.5 times the g limit tears the wings off. Holding well past the never-exceed speed makes
    it flutter apart.
  - Spinning props and rotors cut what they hit and break on anything solid. Losing the tail rotor sets the
    helicopter wallowing.
  - The balloon's envelope holes from bullets and blasts, and scorches past 125 °C.
- **The World's airfield.** The ground east of the start is flat for 2.6 km, long enough to take off and land
  an airliner.
- The toybox shows a shelf's groups under headings.

### Fixes

- Vehicle wheels on aircraft roll freely past the physics engine's spin limit. Their rolling drag and brakes
  are applied as forces, so small tyres no longer cap a plane at 19 m/s.
- An aircraft's tyres no longer register a knock every step they roll. The impact reading on a fast-spinning
  wheel used to add up and wreck a jet on its take-off run.

## 0.4.4 — 2026-11-16

Engines that need fuel and tanks that feed a chosen stage, wires that snap, a second stage that steers,
parachutes that tear, flames that keep up with fast engines, and no more judder following fast things.

### Changes

- Engines need fuel. A thruster, jet, hover thruster, helicopter rotor, outboard, car engine or generator with
  no fuel tank in its build doesn't run; before, a build with no tank at all ran for free. Settings > Physics >
  Fuel still offers "No tank, runs free" (the old way) and "Infinite". The tutorials' builds come with tanks.
- A fuel tank's menu has "Fuel to:". Set to a stage, the tank feeds that stage's engines wherever they are in
  the build, across decouplers, until they're dropped. Left alone, it feeds the engines on its own side of any
  decoupler, as before. So a rocket's lower tanks can feed its upper stage.
- A wire snaps once it's pulled more than a tenth past its length (it flexes freely up to that). Before, wires
  never broke: a rocket's wires stretched on to its dropped stage, a kilometre down. Dragging a thing pays its
  wires out instead of snapping them.
- A contraption saved after its stages fired spawns with them ready to fire again: decouplers armed,
  parachutes packed, engines waiting for their stage.

### Fixes

- A second stage steers. Engines only counted for turning when at least half a metre off the craft's centre
  line, so three thrusters 0.43 m apart steered nothing once the wider first stage was dropped. Now any engine
  well out from the middle, compared with the others, counts. The turn also no longer counts engines still
  waiting for their stage (or out of fuel or air), which made Q and E only nudge the engines that could fire.
- A parachute opened far too fast is ruined instead of stopping the craft dead. A torn canopy kept an eighth of
  its pull, on lines that never broke, and only a cap of "nine tenths of the speed a step" held it back, so
  opened at 400 m/s it stopped a craft in a blink. Now it tears to shreds, the shreds come off their lines if
  still pulled hard, and the pack's weld holds what its canopy can pull (a heavy chute tore its pack off before).
- The fuel in a tank lying on its side settles toward the ground. It settled toward the tank's own bottom, off
  to one side, so a craft built round a tank lying down leaned and tipped over.
- Engine flames stay at the nozzle at speed. They left at the exhaust's own few metres a second, so at 400 m/s
  each stood where it was made, a string of dots three metres apart; now they go along with the engine. Smoke,
  booster smoke and contrails are laid along the way the craft came, not a puff every few metres.
- Fast things no longer judder on screen. On a screen whose refresh rate isn't a multiple of the physics step
  (144 Hz, 165 Hz, uncapped), every few frames were drawn up to a millisecond late, which at 400 m/s is 25
  pixels. The camera following something also went by speed times frame time instead of where the thing is
  drawn, so it shook in slow motion or under load. Particles and engine glow are now drawn between steps as
  everything else is.

## 0.4.3 — 2026-11-16

Staged rockets that light their first stage, and staged engines that start when you switch them on.

### Fixes

- A rocket's bottom engines run before the decoupler above them drops them. Given that decoupler's stage (or a
  later one) by hand, they waited until it fired, so a staged rocket never left the pad and its first-stage
  engines only lit as they fell away. An engine a decoupler lets go of now fires in the stage before it at the
  latest.
- W lights a craft's first stage when all its engines are waiting for stages and that stage drops nothing. The
  readout said "throttle 100%, 0 running" until you pressed Enter; now, if the engines are still waiting, it
  says to press Enter.
- An engine with a stage starts when you switch it on (F) or power comes to it down a wire. It waited for its
  stage all the same, so it did nothing, with nothing to say why.
- The readout's stage count goes by the highest stage, not how many different stages there are (stages 1 and 3
  read "3 of 2").
- A build with decouplers but no cockpit counts its stages from its highest part.

## 0.4.2 — 2026-11-15

Rockets that stage themselves, decouplers any size, a camera that keeps up with fast things without shaking,
and welds that join only what they're made on.

### Changes

- A build with decouplers stages itself when flown, unless you've set stages by hand: the engines furthest from
  the cockpit run from the start, and each decoupler fires together with the engines of the piece it leaves
  you on. So a two-stage rocket climbs on its lower engines, and Enter drops them and lights the upper ones.
- F on a cockpit fires its build's next stage, as Enter does while flying it.
- A decoupler fires when power comes on to it (a switch, a lever), as well as on a pulse.
- Decouplers can be made any size with their handles.
- The Stage item in the menu sets every selected part's stage at once (it was only offered with one thing
  selected), and says when a stage was worked out for you ("auto").

### Fixes

- The camera no longer shakes following something fast. It followed where things were at the end of each
  physics step, not where they're drawn between steps, so past the speed of sound a rocket juddered back and
  forth by metres a frame on a fast screen.
- The camera keeps a fast craft in view. Following one, it trailed a sixth of a second behind (60 m and more
  for a rocket, off the top of the screen); keeping a flown craft in view, it let it ride a quarter of the
  screen out. Now, moving fast, it goes along at the craft's speed with the craft a little behind the middle,
  so you see where it's going.

- A weld, hinge or pin made onto one of several selected things joins just the part it's made on. It used
  to join every selected thing too, at its middle: mending a broken joint on a build still selected welded
  that spot to the whole build. (Wires, ropes, springs and fuses still go to each selected thing.)
- The tutorial card moves out from over the flight readout (below it, or above it on a phone) while something's
  flown, and the flight tour no longer calls the readout "at the bottom".

## 0.4.1 — 2026-11-15

The World as the starting map and the tutorials' home, puddles on it, and a clearer x-ray.

### Changes

- The x-ray shows a broken bone as the bone itself snapped in two, the ends jagged and knocked askew with a
  gap between them, instead of a red line drawn over it; a fresh break glows white a moment.
- The game starts on the World map, and the tutorials are played there too (all but the boat, out on the Sea).

### Fixes

- The flight tutorial's craft has its thrusters under the plank, firing at the floor: on top of it they fired
  into the plank, set it smouldering and sent the craft spinning.
- Liquid pools on the World's flat ground round the start, as on any other map's floor: spilt oil there can be
  lit, acid eats what lies in it, water puts things out. Before, it only ever stained the ground.

## 0.4.0 — 2026-11-14

Powered things: fuel and power that run out, sensors and logic, rockets, planes, boats, home-made cars,
rails and cranes, combat in the air, safety gear, places to race, and tutorials for all of it.

### New
- **Fuel.** Fuel tanks feed the engines built in with them and get lighter as they burn. Empty, the engines
  stop and the flight readout says why. Shot, a tank leaks, and it can catch fire. Settings > Physics >
  Fuel can make it infinite, or make engines need a tank.
- **Power that runs down.** A battery's charge is used by what it powers, and its menu shows what's left.
  A solar panel makes power while the sun is on it. A generator burns fuel to make it.
- **Sensors:** an altimeter, a speed sensor, a tilt sensor, a fuel gauge, a proximity sensor and a g-meter.
  Each powers what it's wired to past the value set in its menu.
- **Logic:** a toggle that flips on each pulse and remembers, and a step sequencer that powers its
  outputs one after another.
- **Stages.** Every part has a stage in its menu. Flying, Enter fires the next one: decouplers let go,
  boosters light, chutes open.
- **Stability assist** (`): holds a craft's angle and stops it spinning, in the air and in space.
- **Dashboards** for cars, planes and rockets, and a chase camera (End) that zooms out with speed.
- **Rocket parts:** landing legs and plane landing gear ([), parachutes (]) that tear if opened too fast,
  a backpack parachute that opens by itself as someone falls, an ejection seat ('), gimbal thrusters,
  RCS puffers, solid boosters, fins, steering flaps and elevators, launch clamps and docking ports.
- **Space:** a spacesuit helmet and an oxygen tank, and a sealed capsule seat. Wearing both, or sealed in
  with a tank, someone breathes in space and under water. Coming back down fast, things heat up in the air
  ahead of them; a heat shield takes that heat and burns away. Fast enough sideways on the World, a craft
  falls round the planet in orbit, and the readout gives the top and bottom of its path.
- **Flying:** a trajectory line, build readouts while building (centre of mass, of thrust and of lift,
  weight, thrust to weight, burn time), symmetry building, an autopilot that holds height (Insert), a
  sonic boom through the speed of sound and contrails high up. A flight recorder graphs height and speed.
  A camera part shows its view on a screen wired to it, and in a picture-in-picture box while it's flown.
- **Challenges** in the Tutorials panel: a hop, a soft landing, a kilometre up, the sound barrier, space,
  crewed spaceflight, orbit, there and back.
- **Home-made cars:** an engine with a gearbox for motor wheels, suspension struts, nitro (hold ;),
  headlights (,), a horn (/), a tow hitch, a crash dummy and a g-meter. Tyres grip less in rain and snow,
  skid and smoke, and go flat when shot.
- **Planes, helicopters and boats:** wings that lift and stall, a helicopter rotor, a jet engine's
  afterburner (hold ;), wind (Settings > World) with thermals, a boat propeller, an outboard motor, a sail,
  a ballast tank to dive and surface, and an anchor. The sea crushes a hull too deep for what it's made of.
- **The Ocean map:** 200 m deep, with a wreck on its bed and a long beach.
- **Rails:** the Shape tool's second kind lays track where you draw it. Its menu makes it a chain lift or a
  launch. A coaster car rides it, round loops and upside down, and rail wheels under a plank make a wagon.
- **Cranes:** a claw that shuts on what's between its jaws, and a crane hook that catches what swings
  into it.
- **Combat:** guns built into what you fly fire on the fire key (\). A heat-seeker pod's missiles chase
  the hottest thing ahead, and flares (Caps Lock) are hotter than any engine. A bomb bay drops bombs (0)
  that arm as they fall. An armour plate stops rifle rounds.
- **Safety:** seat belts (a seat's menu) and an airbag soften a crash for whoever is aboard. Hard g greys
  a pilot's view, then blacks it out. An automatic fire extinguisher puts out its build.
- **Places:** a ramp, a runway, a launch pad, a fuel pump that fills what stops beside it, and race gates.
  Through the start, every checkpoint in order and back again is a timed lap. Air time and flips land
  stunt points. The World map has a pump, ramps, a launch pad, a runway and a race course by its start.
- **Seven new tutorials:** flying, cars you build, air and sea, power and logic, combat, rails and cranes,
  and everything breaking. They cover what's come since the first tutorials as well as this update.

### Fixes
- Jets flame out where the air is too thin to burn, about 3 km up on the World map. They go dark and quiet
  and light again on the way back down. The flight readout says how many engines are out of air: jets and
  propellers need it, rocket thrusters don't. Before, a jet in space still showed its flame and smoke, still
  roared, and the readout called it running while it pushed nothing. A rocket climbing on jets just fell
  back with no hint why. On the way up, their flame and blast now shrink with the air, as their push
  already did.
- Smoke, flames and sparks move through the air that's there. Up in space, smoke no longer rises or hangs
  back, and everything falls at the gravity at that height.
- The planet seen from high up on the World map now sits low behind everything: a far-off curve of sea,
  land and cloud. It used to be a camouflage pattern across the lower quarter of the view, with blobs that
  jumped in size when you zoomed, and rockets seemed to plunge into it.
- People who grow limbs back get up again. Before, about one in four stayed on the floor for good. The
  old limb they cast off tangled their legs, scraps of gore lying on them counted as pinning them down,
  and standing on a scrap left them leaning too far to count as up. Anyone who fails to get up off a heap
  of light scraps (gore, shards) now pushes through them to the floor on the next try.
- A syringe pushed slowly at someone goes in, even with their hand lying in the way. Before, they
  sometimes took it out of your hand instead. Syringes, bandages and kits pressed onto someone covered in
  glass shards or scraps of gore reach them through it.
- A thrown Molotov smashes when it lands on a splinter or a spent case lying on the floor. It used to
  land whole.
- Fist fights end when one of them has really lost: knocked down twice, kept down, knocked out, or
  worn out after a long brawl, when the one worse off sits down on the floor for a while. Before, almost
  every knock-down ended the fight just as the one knocked down got back up. Punches are thrown a little
  less whippily too.
- The explosive crossbow bolt step in the weapons tutorial finishes when a shot breaks the crossbow.
- People walking over a box climb down its far side. Before, now and then they stopped on top at the
  edge, because the box's cut-off corner made it look as if there was no room below.
- Someone propped up against a heap, leaning and stepping on the spot to catch it, stops and leans on
  it. Before, they stepped there for ever and kept the whole heap from settling.
- A helicopter rotor lifts straight up. Its lift pushed half a pixel off its middle, which twisted
  whatever it was welded to round until it flipped over.
- The tiniest broken bits (shards, chips) tumble to a stop instead of rolling away like pebbles.
- People treading water keep their mouth above the waves. Before, the sea's swell washed over it every
  second or so, even for a fresh swimmer, and cost them breath.

## 0.3.1 — 2026-11-14

### Fixes
- Choosing a graphics preset no longer changes the frame rate cap. Medium (picked to lighten a heavy
  scene) used to hold the game to 60 fps as well, unasked. A cap already lowered that way stays where it
  is until you set Settings > Graphics > Frame rate cap back yourself.
- Heads stay on far better. A hard landing hurts the head only down to half and knocks someone out
  beyond that, instead of draining their skull until the next knock burst it. A blunt blow bursts a head
  only when it's crushing, not one that just drains the last of it. Blasts take a head
  off only well inside where they'd take an arm, and a round to the head bites out far less of it.
- Vehicles hit by blasts behave like the weight they are. A car is pushed like 1.15 tonnes and a tank like
  30, not like the few hundred kilograms their parts add up to. A wreck drags on its rims instead of
  rolling away.
- Blasts eat into a car as they come: each one bursts the windows facing it and bites a hole out of the
  body, torn steel flying, until enough of them tear it apart. A big enough one blows its wheels off.
  Holes now show through the body drawn in front of the people inside.
- A car or tank torn apart leaves fewer, bigger plates of steel, not dozens of small scraps.
- Fire burns things to ash. A burning scrap, splinter or shed tyre crumbles away where it lies, instead
  of breaking into smaller burning pieces again and again until a wreck is a swarm of crumbs. Fire
  scorches and heats steel, but doesn't break it.
- Broken pieces fare as what they're made of: steel scraps and rubber don't break smaller when they land
  or have wreckage lying on them. Glass and stone still do.
- A contraption saved while it was selected (being flown) with its throttle at nothing no longer comes
  back with its engines stuck off. They ignored their own switch and any throttle lever wired to them
  until they were flown again.
- Welds on long parts hold against twisting as well as they hold against a pull: they can hold the lighter
  part straight out. Before, how much twist a weld took didn't grow with what it held, so nudging a tall
  welded rocket a metre with the mouse, or letting it slide a little on its feet, bent its welds apart.
- A click with the Weld no longer fixes things to the background by surprise. It welds to whatever is
  behind the click or touching it there (a jet's edge welds to the beam it sits against). Over nothing it
  makes nothing and says so, just as a weld let go over nothing does. Ctrl+click still fixes something to
  the background on purpose. Before, a click, or a drag too short to count as one, quietly welded the part
  to the background. That's how a rocket's jet got fixed in place without its builder ever asking. The Pin
  still pins to the background with a plain click, since that's what it's for.
- Something fixed to the background now says so. Saving it as a contraption says so in the save dialog,
  before you name it. Pasting or placing a copy or contraption that's fixed to the background shows a
  message that it will stay where it's put. The flight readout says it while you try to fly it. Its
  right-click menu has "Free from the background", which works from any part of the build. A pasted rocket
  fixed by one jet used to hang in the air and not move at full thrust, with nothing to say why.
- A weld's (or rope's, hinge's, pin's) menu sets the strength of every connection in its build at once
  ("Whole build: unbreakable"), not only its own.
- Tall craft can be levelled and turned by engines side by side under them. A 20 m rocket's jets, a
  metre or two apart, were counted as too close to its middle to turn it, so nothing held it upright
  and Q and E did nothing.

## 0.3.0 — 2026-11-14

### Everything breaks
- Everything that isn't alive can be broken now, not only wood and glass: crates, machines, guns,
  launchers, the nuke's casing. Its hit points come from what it's made of and how big it is. When they
  run out it comes apart into pieces of itself, which you can pick up, burn, weld or break again. Steel
  tears into a few big jagged sheets, glass shatters finest where it was hit, wood splinters, and stone
  and concrete crumble to rubble. Only the map can't be broken.
- Vehicles come apart for real. A nuke or enough C4 tears a tank's turret off whole, sends its gun and
  road wheels flying, and rips its hull into torn plates. A car loses its cabin from its floor, and its
  windows burst into glass. The fuel catches and whoever was inside falls out. A burnt-out wreck stays a
  burnt-out shell, and it can still be torn apart.
- Rounds go through thin metal and wood, leaving a hole where they go in and where they come out, and
  dent armour that stops them.
- Things are crushed by weight they can't bear, weakened by heat and dripped away by enough of it.
- Welds, hinges and pins snap under force. C4 within about 3 m snaps a weld between steel beams, and a
  grenade only strains one. Wires, ropes and fuses are cut by rounds, blades, the chainsaw, blasts and
  fire.
- Machines wear out. A damaged one sputters and flickers, and a broken one stops. A shot battery shorts
  out and can catch fire. Motors, pistons, servos and turrets break apart. An EMP generator up close fries
  electronics for good, and so does a nuke, out to three times the reach of its blast.
- A round sets off a landmine or anything with a lit fuse. C4 and grenades that are shot are broken into
  pieces without going off.
- Repair puts a broken thing back together from its pieces, wherever they've flown.
- Hard landings and crashes hurt the whole body: a 15 m fall is survived, 22 m is a coin flip, and 30 m
  kills.
- Settings > Graphics > Debris sets how many pieces may lie about (40 to 500). Past that, the oldest go.

### Heat and air
- Everything has a temperature. Fire, exhausts, lasers, blasts and a nuke's flash heat things up, heat
  spreads through what's welded together, and hot metal glows. Something heated past the point its
  material burns at catches fire by itself.
- Things fall through the air, with drag and lift from their own shape: a plank tilted into the wind
  lifts, and a person falling stops speeding up at about 50 m/s.
- No more top speeds. A thruster pushes as hard however fast it goes, a jet's push falls off with the
  thinning air, and a propeller's falls off with its speed and the air.

### Flying and driving anything
- Anything you build with engines can be flown. Select it, or seat someone in the new Cockpit Seat, then
  use W and S for the throttle (it stays where you leave it), A and D to move, and Q and E to turn. The
  game works out what each engine is for (lift, moving, turning) from where it sits and which way it
  points, and levels the craft by easing its lift engines. A readout at the top shows speed, height,
  climb and throttle; move it with the layout editor.
- New parts in Machinery:
  - **Mini Thruster:** 300 N, for steering.
  - **Hover Thruster:** holds a build at a height over the ground or water.
  - **Gyroscope Stabiliser** and **Industrial Gyroscope:** hold a build upright, or at an angle Q and E
    set.
  - **Key Trigger:** works whatever it's wired to with a key (T, Y, U, I, O, P, K or L).
  - **Cockpit Seat.**
  - **Throttle Lever:** lets through as much power as it's pulled.
- Thrusters, jets, propellers and motors have a thrust setting from 0 to 400% in their menus.
- Cars and tanks speed up gradually instead of going full throttle at once. The opposite key brakes, and
  Q and E tilt them in the air.
- On a phone, the drive pad has turn buttons and works for any craft.
- Guests can fly crafts too.

### The World
- A new map, World: endless both ways, with hills, mountains, mesas and valleys past flat ground at the
  start, and endless upward too. The air thins as you climb:
  - People are short of breath at about 800 m and pass out by about 1.3 km.
  - The clouds and the rain stay below about 650 m. Balloons burst a little above that.
  - Higher up, fire goes out, jets and propellers lose their push, blasts are weaker, and sound fades to
    a dull thump.
  - Past about 10 km it's space: black sky, stars, the curve of the planet below. Nothing slows you down
    there, and gravity fades off the higher you go.
- It stays smooth however far out you go. Things left more than 2 km behind every player are put away
  and come back when someone returns.
- Saves keep where everything is on the World, however far out. Older saves still load.
- Guests can roam up to about 16 km from the host.

### Speed
- Drawing sends the graphics card only what changed each frame. Before, every sprite, particle, tracer
  and wire buffer was sent whole, even when nearly empty.
- The World's sky draws only what's in view: clouds, stars or the planet. Its ground reuses its pieces
  as you travel. In a phone-sized test with software drawing, standing on the World went from 39 to
  over 200 fps.
- The first tank torn apart no longer stalls the game for a moment: tearing one apart is rehearsed
  while the game loads.

### Secrets
- Somebody is hiding in Settings. He's built different.

### Fixes
- A broken thing loaded from a save no longer comes back damaged.
- Big pieces of gore keep their size when loaded or sent to guests.
- A wreck the host repairs is whole again for guests too.
- Someone standing on a fast craft rides it. Before, a plank flown upward faster than it is thick
  dragged their feet through it, and both were flung apart. (Inside the physics engine: a fast body was
  checked against where the other one ends its step, not along its path.)
- Something lying still that a blast hits is thrown. Before, it was sometimes put straight back to
  sleep where it lay, if the game checked for things at rest just after the blast.
- People who land a fall on their feet get up properly. Before, they could spring a metre or more back
  into the air.
- On a phone, the flight readout sits above the drive pad, not over the toolbar.
- The camera keeps up with a fast craft it follows.
- The sea (on the Sea map) holds things up by what they are made of, and they settle. Before, how
  something floated depended on its picture's box:
  - Guns and other thin metal things floated, held up by the empty corners around them.
  - The explosive barrel hung half way down for ever.
  - Light floats such as the bucket and the buoyancy tube jittered or bobbed on the surface without
    stopping.

  Now wood, plastic, rubber, and anything hollow with air in it (barrels, buckets, the glass tank,
  cars) float and come to rest within a few seconds, lying as their weight has them. Metal, stone and
  glass go down to the bed. Nothing stays hanging in the water. A float bobbing on the surface loses its
  bobbing to the waves it makes, as a real one does.

## 0.2.5 — 2026-10-29

### Battles
- A side can be made of squads: "+ Add squad" under a side's line adds another count and weapon (up to
  5 squads and 30 people a side), each with a × to take it away. They line up front to back by how they
  fight: dogs, then melee, pistols and shotguns, rifles and crossbows, and snipers and launchers at the
  back, the tanks behind them all.
- A battle started from the panel ends with a banner saying who won: "Red wins: 4 of 11 left standing,
  1 of 2 tanks, in 0:42", or "Draw: nobody left standing". Guests see it too.
- The whole line fights. Soldiers on a side fire past their own (bullets, rockets, grenade rounds and bolts
  go by them, as tank shells have since 0.2.4); a line of 6 riflemen all fire, where only the front one or
  two used to. Their bullets don't set off their own side's rockets either.
- Soldiers don't blow up their own side. With a rocket or a grenade round they hold their fire while what
  it would hit first is near one of their own (or near them), or while anything is flying past close to
  the muzzle. Mixed battles used to lose 3 to 10 people a side to their own rockets.
- Soldiers keep a little room between them on the march, instead of walking into each other in a heap.
- Against a tank, a rifleman picks up an RPG or another launcher lying within 10 m; riflemen go for the
  enemy's people and launchers for its tanks. A soldier knocked down takes up the gun they dropped.
- Tanks go for the enemy's tanks first (unless its infantry are much nearer), so the tanks fight each
  other while the infantry do; they hold their fire with their own side within 6 m of where it lands.
- An RPG is fired from 5.5 to 16 m off (people used to walk to 7 m of a tank first), and its back-blast
  no longer shoves the shooter's own side.

### Missiles
- The Spike LR-II's seeker looks at everything inside its square and locks on to the person, animal or
  vehicle nearest the middle (anything else solid only when there's none of those), following it while
  it's in the square; it used to lock only on what was right under the pointer.
- A missile whose motor has burnt out keeps steering for its target as it glides, less and less as it
  slows, instead of dropping like a stone.
- Right-click a launcher (or the M113) for "Missile: Standard / Cruise / Strike (5)". Cruise: its motor
  burns 4 times as long and its warhead is twice as strong. Strike: one launch sends out 5 smaller
  missiles that never hit each other: from the Guided Missile Launcher they spread round the pointer;
  from the Spike they share out over the targets in its square (marked with small gates on the reticle).
  Each has its own look, and all three work with vertical launch.

### Multiplayer
- Each player's missiles follow their own pointer: a guest's guided missile, an M113 a guest fires, and a
  guest's Spike seeker (whose reticle and lock now show on the guest's screen) used to go by the host's.
- Limbs grown back with Regeneration grow back for guests too, and Repair shows for them.

## 0.2.4 — 2026-10-27

### Missiles
- A Guided Missile Launcher (Weapons): a squat launcher on a bipod like a mortar, its missile dark green.
  F fires it, and the missile steers for the mouse pointer all the way.
- The Spike LR-II (Weapons), its missile white. Hold F and its seeker comes on, with a War Thunder style
  reticle: the corners of a square round the pointer and a small gate square in the middle that locks on
  to what it's over (amber, blinking, as it locks; red once it has). Let go of F with a lock and the missile
  flies itself to the target, climbing over walls and round what's in its way; let go without one and
  nothing fires.
- Right-click either launcher for Normal launch or Vertical launch. Vertical, it's a low launch box (as
  tall as a landmine, as wide as two missiles), and fires as a TOR-M1 does: the missile is thrown straight
  up with its motor off, gas jets at its nose turn it over, and its motor lights about 8 m up.
- The M113A1 Missile Carrier (Vehicles): an M113 with a missile launcher raised on its roof. It drives as
  a tank does, with W A S D. Off a side, F fires a missile steered with the mouse; on a side (its menu, or
  the Battle panel), its crew fire missiles that guide themselves onto the enemy they've picked.

### Battles
- The Battle panel arms a side with one gun each: "One weapon" lists every gun a soldier can fight with
  (rifles, pistols, shotguns, the sniper, the RPG, the grenade launcher, the crossbow, the flamethrower,
  the stun gun…), and each soldier of the side gets that gun.
- A side can bring up to 4 tanks (Tank, M1 Abrams, ZTZ-99A, Leopard 2A7, or the M113A1 missile
  carrier), lined up in a column behind its soldiers, on its side and facing the enemy; a side can be
  tanks alone. Too many for the room, the soldiers stand closer and then tanks are left out (a message
  says how many). A battle started by a wall is moved in so all of it is inside the world.
- A tank on a side fires past its own soldiers and the tanks in front of it (as if beside them, as a
  side-on view can't show), and holds its fire while any of its side are near where its shell would
  land. It used to hold its fire while anyone of its side was in front of it, so in a battle it never
  fired at all.
- Soldiers with guns go for the other side's tanks once there's nobody of that side left to shoot (an RPG
  is the thing to bring). They used to stand there being shelled.

### Medicine
- A Regeneration syringe: lost arms, legs, hands and feet grow back one at a time from the stump over
  10 to 30 seconds, small and pale at first and growing to full size, while wounds close, bones knit and
  blood comes back. It works on people and animals; it doesn't bring back the dead or grow a new head.
- Splash potions of every drug (Healing, Adrenaline, Knockout, Regeneration… 16 in all), in small round
  bottles the colour of the drug. A bottle breaks when it's knocked or dropped hard, thrown, or shot, and
  splashes everyone within about 2 m: a full dose close by, less further off, none behind a wall. Use
  throws it held, and smashes it where it is otherwise; its menu also has Throw, Smash and Drop.

### Sandbox
- Water can be Infinite (Settings, Physics: Water). All the water you pour stays water, past the usual
  3200 drops (1600 on a phone); the more there is, the slower the game runs. Back on Limited, what's
  there stays till it dries up or is cleared, and no more pours till it's under the limit. A save or an
  undo with more water than the limit brings all of it back.
- B puts back the item picked in the toybox (it stops spawning it); Esc does too, before it opens the
  pause menu, and right-clicking empty space while spawning offers "Stop spawning …". The key can be
  changed in Controls.

### Fixes
- A gun dragged about (an RPG, a rifle, a pistol…) keeps the angle it was picked up at, and A and D
  still turn it. It used to swing round by its grip as it was carried, up to 50 degrees either way, so a
  rocket aimed by dragging the launcher went off well away from where it had been pointed.

## 0.2.3 — 2026-10-26

### Vehicles
- Cars and tanks drive with W A S D: with one selected, A and D drive it left and right, and a tank's
  gun goes up and down with W and S. The arrow keys are left to the camera, as ever. While a vehicle is
  selected, A and D drive it rather than turn it, and S lays a tank's gun rather than showing the
  detail view; dragging something, A and D turn it as usual.

### Fixes
- Riding in a car you built, someone standing in it rides off with it unhurt. They kept their balance
  by the ground, not by what they stood on: on a deck going at 6 m/s they felt they were toppling over
  at 6 m/s, stepped as if on the ground (their feet left behind as it went on) and walked back into its
  posts, which broke their feet and hands. People now keep their feet by what's under them.
- A knock on an arm, a leg or a head counts what's behind it: the limb and those joining it to the body,
  and the rest of the body only as far as the knock drives the limb into it (a crate dropped on a head,
  all of it; a post knocking a hand sideways, just the arm, which swings away). A post nudging a hand at
  3 m/s took it off, where the hand flung into a wall at 3 m/s isn't hurt. Something about as heavy as
  the body shoves the two along together, and puts half as much into the limb as something far heavier.
  The same goes for animals.
- A contraption saved while it was moving (a car driven along, then saved) is put down again at rest.
  It used to keep the speed it had, and drove off at 17 m/s the moment it was spawned.

## 0.2.2 — 2026-10-26

### Fixes
- Contraptions welded together no longer shake themselves apart. Where a light part had several heavy
  ones welded round it (a short beam with long wings either side and a frame on top), the welds wobbled
  more with every step: a player's rocket lifted off, then spun up to 100 turns a second and flung itself
  away, and its frame did the same floating still in empty space. Things welded together now move as
  one piece (each welded group keeps its own momentum and spin); a hinge or a rope still lets things move.
- A balloon tied to someone who has stood still long enough to settle lifts them. The rope (or weld, or
  spring) used to snap at once: they were put straight back to sleep every step, hanging where they stood.
- An RPG or a grenade launcher swung or spun round fires along its barrel. Its rocket took the launcher's
  sideways speed along with it, and flew 20-36 degrees off where it pointed.
- A fan built onto a cart drives it forward, blowing backward, as it should: it pushes itself back a
  little as it blows (not enough to slide off on the floor), and its wind and draw leave alone what it's
  welded, hinged or pinned to. Its draw used to pull the cart backward, the way the wind blew.
- Heavy things crush. Something pressing down harder than a car's wheel (a tonne set down, a slab of
  bricks) crushes what's under it: a person's limbs give and are pressed flat, a glass tank or a crate
  breaks, a fuel drum goes off, a car's roof caves in until it goes up. A great slab dropped on someone
  leaves only a mess; a heap of people, or crates stacked up, are no heavier than before.
- A 1000 kg weight dropped on a glass tank breaks it, with water in it or not: glass counts the full
  weight of a heavy thing coming down on it. A crate dropped in still leaves it standing.
- A jet engine can be wrecked. Run into a wall (or blown up) while it's running, its fuel goes up in a
  fireball; switched off, a hard enough knock breaks it up.
- A knock is counted once for each pair of things, not once for each of their shapes: a glass tank set
  down hard on the floor was hurt three times over (its floor and both walls).
- Knocks land the way they came. Which way a knock went was guessed from where each thing's middle
  was, and a car at full speed (sunk past a leg's middle in one step) or a weight landing on a glass
  tank's floor (below the tank's middle) seemed to hit from the far side, and did nothing.
- Riding in a car you built, knocks count how fast things meet, not how fast they go: a rider's foot
  swung into the chair at 9 m/s, the car going 8, met it at 1-3 m/s and was mangled as if at 9. Things
  welded together don't crush each other, either (a rider welded in, their leg jammed against the chair).
- A motor wheel (or a motor, or a servo) pinned or hinged on by its hub drives: the pin holds its hub fast,
  as a weld does, and the motor turns the wheel. Its hub used to spin round on the pin instead.
- In the tutorial's Ouch, the knife turns with A and D as anywhere, and flung at the patient it goes in;
  they no longer catch it.
- If the physics engine breaks (it can, very rarely), the game says so rather than freezing: a window
  with the details to send in, and Carry on, which reloads the game with the scene as it was. The
  desktop app keeps a log (log.txt, beside the saves), and if the game stops responding it offers to wait
  or restart it.

## 0.2.1 — 2026-10-25

### Water
- People and animals drown. Under water they hold their breath (about 18 s for a person, less out cold),
  then breathe water and die a few seconds later; pulled out in time, they gasp and come round. Bubbles
  rise from them, and the vitals panel says "holding breath", "breathing water", "gasping".
- Awake in deep water, they tread water with their head up and swim for the nearest shore, dog-paddling for
  an animal, and tire: far out at sea, a person lasts about three quarters of a minute. Near the shore
  they wade out. Heads sink and chests float, so someone out cold can't keep their face out of the water.
- Electrified water: a battery switched on, or a tesla coil running, in water puts a current through all of
  it (a tankful, or the sea for 8 m either way). Whoever's in it is shocked, knocked out (and so likely
  drowned) and maybe has their heart stopped; the water flickers blue and throws sparks.
- Barrels hold liquid. The barrel is a steel drum with its lid off: pour a flask in, let water run in, or
  hold it under in the sea to fill it; tip it over to pour it out. Empty, it floats; swamped, it sinks.
  Buckets fill in the sea too, and what they hold weighs as much as the sea's water.

### Weapons and machines
- Firework bolts for the crossbow (in its menu, or drop one on it): it trails sparks and bursts in a
  shower of coloured stars on whatever it hits, or a moment into its flight.
- Repair in the right-click menu: what's damaged, burnt, oily, shot through, cut down or bloodied is made as new,
  its full size and weight again; a blown-up car gets its body back and its wheels put on again, and
  drives. An android's Heal is called Repair.
- Tanks fight for a side: Team in a tank's menu puts a stripe of the colour round it, and its crew drive at
  the nearest enemy they can see, lay the gun on them and fire, turning round for one behind them. They
  hold fire while one of their own is in the line of fire, and stop short of running them over.
- The M1 Abrams and the Leopard 2A7 have each other's turrets now, as they should: the Abrams' face
  slopes back in angled slabs, the Leopard's is tall and flat.

### Sounds
- Gasps on surfacing, and bubbles from someone under water (CC0, credited in public/sfx/CREDITS.md).

### Desktop
- A Mac app (Apple silicon): `npm run desktop:mac` makes `Blueberry Playground <version> mac.tar.xz`
  (90 MB). It isn't signed, so on the Mac it must be signed there before it opens: unpack it, then
  `xattr -cr "Blueberry Playground.app"` and `codesign --force --deep --sign - "Blueberry Playground.app"`
  in Terminal. On a Mac it has the usual app menu (Quit, Hide, copy and paste).

### Speed in crowded scenes
- The physics runs on several of the computer's cores at once (up to 6 besides the game's own), in the
  desktop app and from `npm run dev`; the standalone page, opened from disk, can't, and stays on one. The
  worst moments are about four times as smooth: 100 people crushed under a huge brick all at once ran at
  22 fps in its slowest 1% of frames, now 94-98; its slowest frame took 70 ms, now 11-12. On one core
  (the standalone page) it's 55-60, more than two and a half times as smooth.
- The physics engine is our own build of Rapier (tools/rapier), with what the game asks of it most done
  inside it: which parts may touch (a person's own limbs are never even paired up), collision reports,
  the rays of blood and debris, and who is touching whom, all at once.
- Its memory grows 16 MB at a time. Grown a little at a time, as a crush needed it, every core stopped
  for each bit: the contacts of a heap just crushed took twice as long to work out.
- A heap of people coming to rest no longer stutters every half second while the game checks whether it
  can sleep, nor does everyone lying in it look for a way off at the same moment.
- Limbs blown apart in the same instant break up one per physics step, all within a tenth of a second,
  rather than all at once in the slowest step there is.
- Blood painted on bodies reaches the screen with one call per texture, not a dozen per body.
- The desktop app readies all of the physics engine at start, so the first big crush isn't the slowest.

## 0.2.0 — 2026-10-24

### Phones and tablets
- Plays on a phone, upright or on its side: bigger buttons, menus and text; no key hints on a touch screen.
- The view fits a small screen and keeps the floor in sight when the phone is turned.
- Drive buttons (◀ ▶) for a selected car, and ▲ ▼ to aim a tank's gun.
- A Detail button for every limb's health; every tutorial step can be done by touch.
- Sound starts on an iPhone; pinching a panel no longer zooms the page; nothing hides under the notch.
- Medium graphics by default on touch screens (kinder to the battery).
- Opened in a viewer that can't run it (a chat app's or the Files app's preview), the game says so
  instead of sitting on "Loading".
- Add it to a phone's home screen and it opens full screen.

### Gore and damage
- Heavy rounds (rifles, shotguns up close, snipers) and blasts take chunks out of people, animals and androids.
- A limb shot through breaks where it was hit; what comes off stays as pieces of flesh or plating, which
  fall, can be picked up, drip, and can be shot to bits.
- Blood splatters, sprays and streaks on what it lands on.
- Bodies take more to come apart: limbs no longer just vanish.

### People and animals
- Cows, the Gorse, zombies; an exploded pig turns to bacon.
- People keep their balance better, jump, climb, fight, and line up in armies (the Battle panel).
- Adrenaline has people and animals moving and running faster.
- Vitals panel, x-ray (broken bones show) and the detail view.

### Water, floating and flying
- Real flowing water: a block of Water any size you like splashes, spreads, fills what it lands in and finds
  its level. Things float or sink by what they're made of; people bob up (air in their chests) and fires go out.
- A Glass Tank (any size; it shatters) to hold it, and a Water Tap that runs while on, with a settable flow.
- Buoyancy Tube: weld or tie it to something and it keeps about 100 kg afloat.
- Big Balloon: one lifts a person off the ground, a handful lift a car. Balloons can be tied to what's below
  them from their menu, and welded on by the knot.
- Jet Engine: spools up to 9000 N, enough to fly a car; its exhaust blows things away and sets what's close
  alight, its intake sucks things in and tears them up. Throttle in its menu. Real jet sounds.
- Water is saved, undone and redone, and seen by multiplayer guests.

### Blades
- Knives, swords, spears and axes slice: a limb cut through comes apart where the blade went, not at its
  joint, and repeated hacks at one spot cut deeper. The chainsaw saws limbs through the same way.
- A hard thrust runs a blade right through someone and on into whoever's behind; Pull out frees it.
  A thrown knife can go through an arm.
- Held things handle like People Playground's: whirled with the mouse they swing and spin in the hand, but
  once A/D have turned one it keeps to its angle, flung or not, until it's let go.

### Weapons and items
- Crossbow with bolt types, RPG, Molotov, chainsaw, flamethrower, extinguisher, stun gun, sticky grenade,
  grenade launcher, spear, power hammer, flare, fireworks, balloon, a 1000 kg weight, more guns.
- Thermonuclear bomb with a settable yield, fuse-line bombs, EMP.
- Edit gun…: recoil, power, pellets, reload and penetration. Spent cases fly out.

### Vehicles
- Trucks, SUVs, pickups and four tanks (Tank, M1 Abrams, ZTZ-99A, Leopard 2A7) with cannons and barrel aim.
- Drive a selected vehicle with the arrow keys; riders, seat belts; crashes hurt and blow up.

### Building and machinery
- Tools: Rope and Fuse cord, Weld, Spring (set its stiffness), Pin (hinges with limits), Wire, Remove, Shape.
- Resize handles, Weld together, snapping and a grid, placing with a ghost first.
- Contraptions: save, load, export and send to friends.
- Turrets, fans, magnets, a Tesla coil, a launch platform, detectors, conveyors, winches, thrusters,
  pistons, motors with set speeds, switches, timers and logic.

### The world
- Maps (Lab, Hangar, Hills, Rooftops, an endless plate and more), custom maps and a terrain tool.
- Weather, statistics, a gravity setting; oil burns; buckets; fire spreads and goes out better.

### Multiplayer
- Host a sandbox and play it together over the internet with a code; a friends list; the music in step.

### Interface
- Main menu, guided tutorials (the basics and a tour for each part of the game) that keep you to the step.
- Settings: graphics presets, frame-rate cap (to unlimited), volumes, key bindings.
- Edit layout: move, size and hide every part of the interface; layouts saved.
- Pixel fonts, a loading screen, music, many new sounds.

### Desktop app
- A Windows app (portable .exe): saves on disk, and a sync folder shared with the browser game.

## 0.1.0 — 2026-10-21 to 2026-10-22

The first versions: the physics sandbox (Three.js and Rapier), ragdoll people who stand, walk and get hurt,
dogs, cats, pigs and foxes, weapons, explosives, fire, liquids, lighting, medical items, logic and vehicles,
connection tools, undo and redo, saving, real CC0 sounds, touch controls, and the self-tests.
