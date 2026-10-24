import type { Test, TestCtx } from './types';
import type { UI } from '../../ui/UI';

export default function tests({ game, controls, kit }: TestCtx): Test[] {
  const ui = () => controls.ui as unknown as UI;
  const menu = () => ui().mainMenu;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.main-menu .mm-btn')].find((b) => b.textContent === label) ?? null;
  /** The titles of the panels open over the sandbox (the main menu aside). */
  const panels = () => [...document.querySelectorAll('.overlay:not(.hidden):not(.main-menu) .panel-title')].map((e) => e.textContent ?? '');
  /** The word picked out on the menu's page shown. */
  const picked = () => menu().el.querySelector('.mm-page.on .mm-btn.sel')?.textContent ?? '';
  /**
   * Runs `fn` with the music's play() noting the moods it's asked for and playing
   * nothing (the menu asks for music whenever it comes up or goes), then closes
   * the menu.
   */
  const quiet = async (fn: (moods: string[]) => string | true | Promise<string | true>): Promise<string | true> => {
    const music = game.music as unknown as { play(mood: string): void };
    const play = music.play;
    const moods: string[] = [];
    music.play = (mood) => {
      moods.push(mood);
    };
    try {
      return await fn(moods);
    } finally {
      menu().close();
      music.play = play;
    }
  };

  return [
    ['extra: menu: the main menu came up as the game started, over the sandbox and under its panels', () => {
      kit.reset();
      const m = menu();
      if (!m) return 'no ui.mainMenu';
      if (m.shown < 1) return 'it never came up (main.ts shows it once the game has started)';
      if (m.el.parentElement !== document.getElementById('ui')) return 'it is not in the interface';
      const z = parseInt(getComputedStyle(m.el).zIndex);
      const panel = document.querySelector('.overlay:not(.main-menu)');
      const zPanel = panel ? parseInt(getComputedStyle(panel).zIndex) : NaN;
      if (!(z > 0) || !(z < zPanel)) return `the menu's z-index ${z}, the panels' ${zPanel}`;
      if (getComputedStyle(m.el).backdropFilter.includes('blur')) return 'the menu blurs the game behind (slow to draw on weak graphics)';
      return true;
    }],
    ['extra: menu: Play leaves it for the sandbox with the sandbox music; shown again, it says Continue', () => {
      kit.reset();
      const m = menu();
      return quiet((moods) => {
        m.close();
        m.show();
        if (!m.open || !m.el.classList.contains('shown')) return 'show() did not put it up';
        if (moods[moods.length - 1] !== 'menu') return `showing it played ${moods.join(', ') || 'no music'}, not the menu's`;
        const play = m.el.querySelector<HTMLButtonElement>('.mm-play');
        if (!play) return 'no Play button';
        play.click();
        if (m.open || m.el.classList.contains('shown')) return `${play.textContent} left it up`;
        if (moods[moods.length - 1] !== 'sandbox') return `leaving it played ${moods.join(', ')}, not the sandbox's music`;
        m.show();
        const label = m.el.querySelector('.mm-play')?.textContent;
        if (label !== 'Continue') return `once played, the first button says "${label}"`;
        return true;
      });
    }],
    ['extra: menu: the pause menu\'s Main menu brings it back, closing the pause menu, and time runs on behind it', () => {
      kit.reset();
      const m = menu();
      return quiet(() => {
        try {
          m.close();
          ui().togglePauseMenu();
          if (!game.paused) return 'the pause menu did not stop time';
          const entry = [...document.querySelectorAll<HTMLButtonElement>('.pause-panel .panel-btn')].find((b) => b.textContent === 'Main menu');
          if (!entry) return 'no Main menu in the pause menu';
          entry.click();
          if (!m.open) return 'Main menu did not bring the main menu up';
          if (panels().length) return `${panels().join(', ')} still open over it`;
          if (game.paused) return 'time stayed stopped behind the main menu';
          return true;
        } finally {
          ui().closeOverlays();
          game.paused = false;
        }
      });
    }],
    ['extra: menu: keys pressed while it is up do nothing in the sandbox (Delete, Space); closed, they do again', () => {
      kit.reset();
      const m = menu();
      const del = controls.bindings.keys('delete')[0] ?? 'Delete';
      const time = controls.bindings.keys('time')[0] ?? 'Space';
      const crate = kit.spawn('crate', 0, 0.45);
      kit.advance(0.2);
      controls.selection = new Set([crate]);
      return quiet(() => {
        try {
          m.show();
          // to the page, as when nothing has the focus, and to the menu's focused button
          kit.press(del);
          kit.press(time);
          const focused = m.el.querySelector<HTMLButtonElement>('.mm-play')!;
          focused.focus();
          for (const code of [del, time]) {
            for (const type of ['keydown', 'keyup']) focused.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
          }
          kit.advance(0.1);
          if (crate.destroyed) return `${del} deleted the selected crate behind the menu`;
          if (game.paused) return `${time} stopped time behind the menu`;
          if (!m.open) return 'the keys closed the menu';
          m.close();
          kit.press(time);
          const stopped = game.paused;
          kit.press(time);
          kit.press(del);
          if (!stopped) return `with the menu closed, ${time} did not stop time either (the test's keys don't work)`;
          if (!crate.destroyed) return `with the menu closed, ${del} did not delete the crate either`;
          return true;
        } finally {
          game.paused = false;
        }
      });
    }],
    ['extra: menu: Settings opens over it; Esc closes only that, and opens no pause menu', () => {
      kit.reset();
      const m = menu();
      return quiet(() => {
        try {
          m.show();
          button('Settings')?.click();
          if (!panels().includes('Settings')) return `Settings opened ${panels().join(', ') || 'nothing'}`;
          kit.press('Escape');
          if (panels().length) return `Esc left ${panels().join(', ')} open`;
          if (!m.open) return 'Esc closed the main menu as well';
          kit.press('Escape');
          if (panels().length) return `Esc on the main menu opened ${panels().join(', ')}`;
          if (!m.open) return 'Esc on the main menu closed it';
          return true;
        } finally {
          ui().closeOverlays();
          game.paused = false;
        }
      });
    }],
    ['extra: menu: a map picked in its Maps goes on to the sandbox; closing the Maps panel stays', () => {
      kit.reset();
      const m = menu();
      const maps = ui().maps;
      return quiet(() => {
        try {
          m.show();
          button('Maps')?.click();
          if (maps.overlay.classList.contains('hidden')) return 'Maps did not open the Maps panel';
          maps.hide();
          kit.advance(0);
          if (!m.open) return 'closing the Maps panel left the main menu';
          button('Maps')?.click();
          const card = maps.overlay.querySelector<HTMLButtonElement>('.map-card:not(.active)');
          if (!card) return 'no other map in the Maps panel';
          const before = game.map;
          card.click();
          kit.advance(0);
          if (game.map === before) return 'picking a map did not switch to it';
          if (m.open) return `picked ${game.map.name}, the main menu stayed up`;
          if (!maps.overlay.classList.contains('hidden')) return 'the Maps panel stayed open';
          return true;
        } finally {
          maps.hide();
          kit.reset();
        }
      });
    }],
    ['extra: menu: a Multiplayer… button only with a multiplayer panel to open', () => {
      kit.reset();
      const m = menu();
      const given = m.options.multiplayer;
      let opened = 0;
      return quiet(() => {
        try {
          m.options.multiplayer = undefined;
          m.show();
          if (button('Multiplayer…')) return 'a Multiplayer… button with nothing to open';
          m.options.multiplayer = () => {
            opened++;
          };
          m.show();
          const b = button('Multiplayer…');
          if (!b) return 'no Multiplayer… button with a panel to open';
          b.click();
          if (opened !== 1) return `the button opened it ${opened} times`;
          return true;
        } finally {
          m.options.multiplayer = given;
        }
      });
    }],
    ['extra: menu: Credits says the sounds are CC0 and lists their authors from sfx/CREDITS.md', () => {
      kit.reset();
      const m = menu();
      return quiet(async () => {
        m.show();
        const b = button('Credits');
        if (!b) return 'no Credits button';
        b.click();
        await m.showCredits();
        const box = document.querySelector('.mm-credits');
        if (!box || box.parentElement!.classList.contains('hidden')) return 'no credits shown';
        const text = box.textContent ?? '';
        if (!text.includes('CC0') || !text.includes('Freesound')) return 'the credits don\'t say where the sounds are from';
        const sources = [...box.querySelectorAll('.mm-credit-src')].map((e) => e.textContent);
        const names = [...box.querySelectorAll('.mm-credit-names')].reduce((n, e) => n + (e.textContent ?? '').split(', ').length, 0);
        if (sources.length < 3 || names < 20) return `authors listed: ${names}, from ${sources.join(', ') || 'no sources'}`;
        if (!text.includes('Kenney')) return 'Kenney is not among the authors';
        kit.press('Escape');
        if (!box.parentElement!.classList.contains('hidden')) return 'Esc did not close the credits';
        if (!m.open) return 'Esc on the credits closed the main menu';
        return true;
      });
    }],
    ['extra: menu: it hides the sandbox: an opaque screen over all of it, with its backdrop', () => {
      kit.reset();
      const m = menu();
      return quiet(() => {
        m.show();
        const bg = getComputedStyle(m.el).backgroundColor;
        const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(bg);
        if (!bg.startsWith('rgb') || (alpha && parseFloat(alpha[1]) < 1)) return `its background is ${bg}: the sandbox shows through`;
        const r = m.el.getBoundingClientRect();
        if (r.left > 0 || r.top > 0 || r.right < innerWidth || r.bottom < innerHeight) {
          return `it covers ${Math.round(r.left)}..${Math.round(r.right)} × ${Math.round(r.top)}..${Math.round(r.bottom)} of a ${innerWidth} × ${innerHeight} screen`;
        }
        const cv = m.backdrop.canvas;
        if (cv.parentElement !== m.el) return 'its backdrop is not in it';
        if (!(cv.width > 0 && cv.height > 0)) return `its backdrop is ${cv.width} × ${cv.height}`;
        return true;
      });
    }],
    ['extra: menu: ↑ / ↓ pick out its words (with a tick), Enter takes one; with a panel over it, the keys are the panel\'s', () => {
      kit.reset();
      const m = menu();
      const snd = game.sound as unknown as { ui(kind?: string): void };
      const ui0 = snd.ui;
      const sounds: string[] = [];
      snd.ui = (kind = 'click') => {
        sounds.push(kind);
      };
      return quiet(() => {
        try {
          m.show();
          const first = picked();
          const play = m.el.querySelector('.mm-play')?.textContent;
          if (first !== play) return `"${first}" picked out as it came up, not "${play}"`;
          if (document.activeElement?.textContent !== first) return 'the word picked out does not have the focus';
          kit.press('ArrowDown');
          const second = picked();
          if (!second || second === first) return `↓ picked out "${second}" after "${first}"`;
          if (!sounds.includes('hover')) return `no tick as ↓ moved on (sounds: ${sounds.join(', ') || 'none'})`;
          kit.press('ArrowUp');
          if (picked() !== first) return `↑ went to "${picked()}", not back to "${first}"`;
          kit.press('ArrowUp');
          const last = [...m.el.querySelectorAll('.mm-page.on .mm-btn')].pop()?.textContent;
          if (picked() !== last) return `↑ on the first word went to "${picked()}", not round to the last, "${last}"`;
          for (let i = 0; i < 12 && picked() !== 'Settings'; i++) kit.press('ArrowDown');
          if (picked() !== 'Settings') return `↓ never got to Settings (stuck on "${picked()}")`;
          kit.press('Enter');
          if (!panels().includes('Settings')) return `Enter on Settings opened ${panels().join(', ') || 'nothing'}`;
          if (!m.open) return 'Enter on Settings closed the menu';
          kit.press('ArrowDown');
          kit.press('Enter');
          if (picked() !== 'Settings') return `↓ with Settings open over the menu moved on to "${picked()}"`;
          if (!panels().includes('Settings') || panels().length > 1) return `Enter with Settings open over the menu left ${panels().join(', ') || 'nothing'} open`;
          kit.press('Escape');
          if (panels().length) return `Esc left ${panels().join(', ')} open`;
          if (!m.open) return 'Esc closed the main menu';
          return true;
        } finally {
          snd.ui = ui0;
          ui().closeOverlays();
          game.paused = false;
        }
      });
    }],
    ['extra: menu: Information opens a page of its own; Esc, ← and its Back return to the main list, on Information', () => {
      kit.reset();
      const m = menu();
      const on = () => m.el.querySelector<HTMLElement>('.mm-page.on')?.dataset.page;
      const words = () => [...m.el.querySelectorAll<HTMLButtonElement>('.mm-page.on .mm-btn')];
      return quiet(() => {
        m.show();
        if (on() !== 'main') return `it came up on page ${on()}`;
        for (const way of ['Escape', 'ArrowLeft', 'Back']) {
          const info = button('Information');
          if (!info) return 'no Information on the main list';
          if (!info.classList.contains('mm-sub')) return 'Information is not marked as opening a page';
          info.click();
          if (m.page !== 'info' || on() !== 'info') return `Information went to page ${m.page} (${on()} shown)`;
          const labels = words().map((b) => b.textContent);
          if (!labels.includes('How to play') || !labels.includes('Credits') || !labels.includes('Back')) return `its page has ${labels.join(', ')}`;
          if (picked() !== 'How to play') return `"${picked()}" picked out on its page, not its first word`;
          if (m.el.querySelector('.mm-page[data-page="main"]')?.classList.contains('on')) return 'the main list is still shown beside it';
          if (way === 'Back') words().find((b) => b.textContent === 'Back')?.click();
          else kit.press(way);
          if (!m.open) return `${way} closed the menu`;
          if (on() !== 'main') return `${way} left page ${on()} shown`;
          if (picked() !== 'Information') return `back on the main list by ${way}, "${picked()}" is picked out, not Information`;
        }
        // (left on a page, it comes up again on the main list)
        button('Information')?.click();
        m.show();
        if (on() !== 'main') return `shown again, it is on page ${on()}`;
        return true;
      });
    }],
    ['extra: menu: Battle… and Friends… only with their hooks; Battle… goes on to the sandbox, Friends… opens over the menu', () => {
      kit.reset();
      const m = menu();
      const o = m.options;
      const given = { battle: o.battle, friends: o.friends, multiplayer: o.multiplayer };
      let battles = 0;
      let friends = 0;
      return quiet(() => {
        try {
          o.battle = o.friends = undefined;
          m.show();
          if (button('Battle…')) return 'a Battle… entry with no battle panel';
          if (button('Friends…')) return 'a Friends… entry with no friends list';
          o.battle = () => {
            battles++;
          };
          o.friends = () => {
            friends++;
          };
          o.multiplayer = () => {};
          m.show();
          const page = button('Multiplayer');
          if (!page?.classList.contains('mm-sub')) return 'with Multiplayer… and Friends… both, no Multiplayer page on the main list';
          const f = button('Friends…');
          if (!f || !button('Multiplayer…')) return 'the Multiplayer page lacks Multiplayer… or Friends…';
          page.click();
          f.click();
          if (friends !== 1) return `Friends… called its hook ${friends} times`;
          if (!m.open) return 'Friends… left the main menu (its list opens over it)';
          // (one of the two alone stands on the main list itself)
          o.multiplayer = undefined;
          m.show();
          if (button('Multiplayer')) return 'a Multiplayer page holding Friends… alone';
          if (!m.el.querySelector('.mm-page[data-page="main"]')?.contains(button('Friends…'))) return 'Friends… alone is not on the main list';
          const b = button('Battle…');
          if (!b) return 'no Battle… with a battle panel';
          b.click();
          if (battles !== 1) return `Battle… called its hook ${battles} times`;
          if (m.open) return 'Battle… left the main menu up';
          return true;
        } finally {
          Object.assign(o, given);
        }
      });
    }],
    ['extra: menu: Tutorials lists the tours it is given (title, a line, minutes, a tick once done), the first offered while none is taken', () => {
      kit.reset();
      const m = menu();
      const given = m.options.tutorial;
      const started: string[] = [];
      let fresh = true;
      return quiet(() => {
        try {
          m.options.tutorial = {
            tours: () => [
              { id: 't-one', title: 'First steps', blurb: 'Spawning and dragging', minutes: 8, done: false },
              { id: 't-two', title: 'Guns', blurb: 'Firing and reloading', minutes: 12, done: true },
              { id: 't-three', title: 'Machines', blurb: '', minutes: 10, done: false },
            ],
            start: (id) => {
              started.push(id);
            },
            fresh: () => fresh,
          };
          m.show();
          const entry = [...m.el.querySelectorAll<HTMLButtonElement>('.mm-page[data-page="main"] .mm-btn')].find((b) => b.textContent?.startsWith('Tutorials'));
          if (!entry?.classList.contains('mm-sub')) return 'no Tutorials page on the main list';
          entry.click();
          if (m.page !== 'tutorial') return `Tutorials went to page ${m.page}`;
          const tours = [...m.el.querySelectorAll<HTMLButtonElement>('.mm-page.on .mm-btn[data-tour]')];
          const ids = tours.map((b) => b.dataset.tour).join(', ');
          if (ids !== 't-one, t-two, t-three') return `its tours: ${ids || 'none'}`;
          const [one, two, three] = tours;
          const text = one.textContent ?? '';
          if (!text.startsWith('First steps') || !text.includes('8 min') || !text.includes('Spawning and dragging')) return `the first tour reads "${text}"`;
          if (!two.querySelector('.mm-done') || one.querySelector('.mm-done') || three.querySelector('.mm-done')) return 'the tick is not on the done tour alone';
          if (!one.classList.contains('mm-fresh') || two.classList.contains('mm-fresh')) return 'with none taken, the first tour is not the one offered';
          if (picked() !== text) return `"${picked()}" picked out on the page, not the first tour`;
          three.click();
          if (started.join() !== 't-three') return `the third tour started ${started.join(', ') || 'nothing'}`;
          if (m.open) return 'starting a tour left the menu up';
          fresh = false;
          m.show();
          if (m.el.querySelector('.mm-fresh')) return 'with tours taken, the first is still offered';
          return true;
        } finally {
          m.options.tutorial = given;
        }
      });
    }],
    ['extra: menu: its backdrop moves while the menu is up, and stops once it is hidden', () => {
      kit.reset();
      const m = menu();
      const bd = m.backdrop;
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      // (asked for less motion, it's a still picture; a hidden tab draws nothing)
      const moving = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      // (with the animation frames going: the run holds them still, see kit.still())
      return quiet(() => kit.live(async () => {
        // (started earlier in the run, while the frames were held, it waits on one that never comes)
        bd.stop();
        m.show();
        if (moving && !bd.running) return 'the backdrop is still with the menu up';
        const f0 = bd.frames;
        await wait(300);
        if (moving && !document.hidden && bd.frames === f0) return 'no backdrop frames drawn in 0.3 s with the menu up';
        m.close();
        await wait(600);
        if (!m.el.classList.contains('hidden')) return 'the menu is not hidden 0.6 s after going on to the sandbox';
        if (bd.running) return 'the backdrop still runs with the menu hidden';
        const f1 = bd.frames;
        await wait(300);
        if (bd.frames !== f1) return `${bd.frames - f1} backdrop frames drawn in 0.3 s with the menu hidden`;
        return true;
      }));
    }],
  ];
}
