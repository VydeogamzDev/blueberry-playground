# Learnings: Blueberry Playground

Notes for this game only. General lessons live in the shared BUILD-LESSONS.md.

## Phones, tablets and offline play (0.3.0)

- **Kits in use:** Game Interaction Protection Kit (`src/interaction-protection/`, the canvas is
  `class="scene-world image-area"`), the Display Compatibility Kit's iOS 27 top guard only (inline in
  `index.html`; no rotate prompt, since the game reflows to either orientation), and the Offline
  Reliability Kit (`offline/`, wired in `src/engine/Offline.ts`). The game's own Export/Import (Settings ›
  Saves and sync) is the save backup, so the kit's backup adapters and panel aren't mounted.
- **Build:** `npm run build` runs `offline/tools/prepare-offline.mjs` last; it takes the version from
  `package.json`. Vercel needs `vercel.json` for the `no-store` headers.
- **Audio:** `npm run apple-audio` makes an MP3 beside every Ogg in `public/`. Re-run it after adding
  or changing a sound. `audioPath()` (src/engine/assets.ts) picks the MP3 on Apple WebKit. The
  standalone page leaves the MP3s out.
- **Icons:** `npm run icons` redraws `public/icons/` from the loading screen's logo in `index.html`.
- **Phone toolbar:** below 700 px wide with touch, only Pause/Back to build, speed, Undo, Redo and ⋯
  show. Everything else is `.tb-extra`. A tutorial glow on a `.tb-extra` button opens the bar.
- **Not verified on a real device:** iPad sound (MP3 path), the iOS 27 top guard, Add to Home Screen,
  airplane-mode reopen, and context-loss recovery. Desktop emulation can't pass these.
- **Self-tests:** a full `npm test` run fails 1 to 3 physics tests that vary from run to run
  (drowning, tank crush, fire, tutorial play-through). Run alone, they pass.
