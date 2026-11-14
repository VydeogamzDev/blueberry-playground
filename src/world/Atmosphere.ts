import { GRAVITY } from '../engine/constants';

/** The air's density at the ground (kg/m³). */
export const RHO0 = 1.225;

/**
 * The air everything moves through: how dense it is (drag and lift, engines that
 * breathe it, balloons), how warm (what hot things cool toward) and how strongly
 * things fall. On a map of one height it's the same everywhere (warmer in a
 * desert, colder on snow); where the map goes on up (`layered`) it thins, cools
 * and pulls less with height (see world/Maps' World map).
 */
export class Atmosphere {
  /** The air's temperature at the ground (°C). */
  groundTemp = 20;
  /** Does height change it (the World map)? */
  layered = false;
  /** How tall a step of thinning is (m): the density falls by e every this much (×10 squeezed: Earth's is 8.5 km). */
  scaleHeight = 850;
  /** The planet's radius (m) gravity falls off from (see gravityAt()). */
  radius = 30000;
  /**
   * The true height (m) of local y = 0 (see world/Origin): the heights asked about
   * here are local ones, and this is added to each.
   */
  base = 0;

  /** Density (kg/m³) at local height y (true: m above the ground at the start). */
  densityAt(y: number): number {
    if (!this.layered) return RHO0;
    const h = y + this.base;
    return h <= 0 ? RHO0 : RHO0 * Math.exp(-h / this.scaleHeight);
  }

  /** The density as a share of the ground's (0..1). */
  thinness(y: number): number {
    return this.layered ? this.densityAt(y) / RHO0 : 1;
  }

  /**
   * Temperature (°C) at height y: falling 6.5 °C every 100 m (Earth's lapse rate,
   * squeezed ×10) to −56 °C, then on into the cold of space as the air runs out.
   */
  tempAt(y: number): number {
    if (!this.layered) return this.groundTemp;
    const h = y + this.base;
    if (h <= 0) return this.groundTemp;
    const t = Math.max(-56, this.groundTemp - h * 0.065);
    // (past the air, what's in the shade only loses heat)
    const thin = this.densityAt(y) / RHO0;
    return thin > 0.01 ? t : t - (1 - thin / 0.01) * 100;
  }

  /** How strongly things fall at height y, as a share of the ground's: R² / (R + y)². */
  gravityAt(y: number): number {
    if (!this.layered) return 1;
    const h = y + this.base;
    if (h <= 0) return 1;
    const k = this.radius / (this.radius + h);
    return k * k;
  }

  /** Gravity (m/s², negative: down) at height y. */
  pullAt(y: number): number {
    return GRAVITY * this.gravityAt(y);
  }
}
