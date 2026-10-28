# Changelog

Versions are 0.MINOR.PATCH until 1.0: a new MINOR for a release with new things in it, a new PATCH for one
that only fixes. The version is `package.json`'s; the main menu shows it, and the builds copied to Downloads
carry it in their names (`Blueberry Playground 0.2.0.html`, `Blueberry Playground 0.2.0.exe`).

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
