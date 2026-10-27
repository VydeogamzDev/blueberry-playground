/**
 * Game Interaction Protection Kit v1.0.0
 *
 * Installs scoped event guards for game UI elements. Does NOT listen to
 * touchend/touchmove and never prevents the Pointer Events used by custom
 * pinch-to-zoom and panning. Use with the companion CSS.
 *
 * @param {{ root?: EventTarget }} options
 * @returns {() => void} a cleanup function
 */
export function installGameInteractionProtection({root = document.getElementById('app')} = {}) {
  if (!root || typeof root.addEventListener !== 'function') {
    throw new TypeError('Game interaction protection needs a DOM root element.');
  }

  const matches = (target, selector) =>
    Boolean(target && typeof target.closest === 'function' && target.closest(selector));
  const isEditable = target => matches(target,
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
  const gameMedia = '.image-area, .scene-image, .scene-world, .level-image, .mode-art, .item-art, .collection-obj img';
  const preventIfCancelable = event => { if (event.cancelable) event.preventDefault(); };

  function preventSelection(event) {
    if (!isEditable(event.target)) preventIfCancelable(event);
  }
  function preventContextOnGameArtwork(event) {
    if (!isEditable(event.target) && matches(event.target, gameMedia)) {
      preventIfCancelable(event);
    }
  }
  function preventImageDrag(event) {
    if (matches(event.target, 'img, .scene-image, .level-image, .mode-art')) {
      preventIfCancelable(event);
    }
  }
  function preventBrowserDoubleClick(event) {
    // No stopPropagation: any genuine game 'double click' listener is free to
    // run, but the browser's default action must not zoom the page.
    if (!isEditable(event.target)) preventIfCancelable(event);
  }
  function preventNativePinchOnCustomScene(event) {
    // Older Mobile Safari fallback. The picture implements its OWN pinch/pan.
    if (matches(event.target, '.image-area')) preventIfCancelable(event);
  }

  const guards = [
    ['selectstart', preventSelection],
    ['contextmenu', preventContextOnGameArtwork],
    ['dragstart', preventImageDrag],
    ['dblclick', preventBrowserDoubleClick],
    ['gesturestart', preventNativePinchOnCustomScene],
    ['gesturechange', preventNativePinchOnCustomScene]
  ];
  for (const [eventName, handler] of guards) root.addEventListener(eventName, handler, {capture:true});
  return () => {
    for (const [eventName, handler] of guards) root.removeEventListener(eventName, handler, {capture:true});
  };
}
