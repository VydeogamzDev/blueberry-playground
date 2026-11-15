import { PX } from '../engine/constants';
import { Cockpit } from './Flight';
import { RAIL_WHEEL_R, type RailContact, type RailRider } from './Rails';
import type { PropConfig } from './Prop';
import type { Game } from '../world/Game';
import type { ItemDef, SpawnOptions } from '../world/types';

/** A coaster car's wheels (art px: centres, radius). */
export const COASTER_WHEELS: [number, number][] = [[6, 25], [32, 25]];

/**
 * A roller coaster car: a seat with a lap bar on a chassis with rail wheels front and
 * back. Set on a track it holds to it; drop someone in its seat and they ride it,
 * belted in, round the loops. (A cockpit too: select it to see its speed and g.)
 */
export class CoasterCar extends Cockpit implements RailRider {
  private contacts: RailContact[];

  constructor(game: Game, def: ItemDef, cfg: PropConfig, x: number, y: number, opts: SpawnOptions) {
    super(game, def, cfg, x, y, opts);
    this.belted = true;
    this.contacts = COASTER_WHEELS.map(([px, py]) => {
      const l = this.main.pixelToLocal(px, py);
      return { part: this.main, lx: l.x, ly: l.y, r: RAIL_WHEEL_R * PX };
    });
    game.rails.addRider(this);
  }

  railContacts(): RailContact[] {
    return this.contacts;
  }

  protected onDestroy(): void {
    this.game.rails.removeRider(this);
    super.onDestroy();
  }
}
