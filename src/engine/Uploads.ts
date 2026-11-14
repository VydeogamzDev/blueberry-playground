import type * as THREE from 'three';

/**
 * Marks the first `n` items of a buffer to go to the graphics card on the next draw,
 * and nothing at all when `n` is 0. (three.js hands a range's length straight to
 * WebGL2's bufferSubData, where 0 means "to the end": an empty batch or particle layer
 * sent the whole of its buffer every frame, most of a megabyte with nothing to draw.)
 */
export function sendFirst(attr: THREE.BufferAttribute, n: number): void {
  attr.clearUpdateRanges();
  if (n <= 0) return;
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}
