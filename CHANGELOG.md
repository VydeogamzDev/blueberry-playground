# Changelog

Versions are 0.MINOR.PATCH until 1.0: a new MINOR for a release with new things in it, a new PATCH for one
that only fixes. The version is `package.json`'s; the main menu shows it, and the builds copied to Downloads
carry it in their names (`Blueberry Playground 0.2.0.html`, `Blueberry Playground 0.2.0.exe`).

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
