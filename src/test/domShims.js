/**
 * jsdom layout shims for the render smoke suite.
 *
 * jsdom implements the DOM tree but not layout, so `Element.prototype.scrollTo`
 * is missing and every other layout reading returns 0. Components that scroll a
 * console to the bottom inside a `requestAnimationFrame` callback therefore
 * throw *after* the test finished, which Vitest reports as an unhandled error
 * and fails the run even when every assertion passed.
 *
 * The shims are intentionally inert: they make a browser-only side effect a
 * no-op instead of pretending to scroll. Anything that asserts on layout belongs
 * in a real browser, not here.
 */
export function installDomShims() {
  if (typeof Element === 'undefined') return;

  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function scrollTo() {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
}
