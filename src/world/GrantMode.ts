import { store } from '../engine/Store';

const FOUND_KEY = 'blueberry-grant-found';
const ON_KEY = 'blueberry-grant-mode';

/**
 * Grant mode, a secret setting: "grant" put in the Code box in Settings (or typed
 * there with a keyboard) brings out its row there, and switched on, Grant is in the
 * toybox under Characters (see catalog/registry, entities/Human's GRIT). Both are
 * kept. A Grant already in a scene, or in one loaded, stays whether it's on or not.
 */
export const grantMode = {
  get found(): boolean {
    return store.getItem(FOUND_KEY) === '1';
  },
  set found(v: boolean) {
    store.setItem(FOUND_KEY, v ? '1' : '0');
  },
  get on(): boolean {
    return store.getItem(ON_KEY) === '1';
  },
  set on(v: boolean) {
    store.setItem(ON_KEY, v ? '1' : '0');
  },
};
