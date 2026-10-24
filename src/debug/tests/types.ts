import type { Game } from '../../world/Game';
import type { Controls } from '../../tools/Controls';
import type { Human } from '../../entities/Human';
import type { Firearm } from '../../entities/Firearm';
import type { SpawnOptions } from '../../world/types';
import type { makeTestKit } from '../testkit';

/** What a test file gets from the self-test runner (see selftest.ts). */
export interface TestCtx {
  game: Game;
  controls: Controls;
  kit: ReturnType<typeof makeTestKit>;
  /** Spawns a person standing at x. */
  human(x: number, opts?: SpawnOptions): Human;
  /** Drags a fresh gun (or any holdable item) into a person's front hand; returns what they hold. */
  arm(h: Human, id?: string): Firearm | undefined;
}

/** A named check: true when it passes, otherwise what went wrong. */
export type Test = [string, () => string | true | Promise<string | true>];
