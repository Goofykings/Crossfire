/** Visibility changes are immediate for input/accessibility; CSS owns the visual tail.
 * No delayed actions, cloned pages, timers or animation-completion navigation. */
export function screenVisibility(element: HTMLElement, visible: boolean, interactive = visible): void {
  element.inert = !interactive;
  element.setAttribute('aria-hidden', String(!interactive));
  element.classList.toggle('visible', visible);
}

const feedbackAnimations = new WeakMap<HTMLElement, Animation>();
/** Bounded, restartable feedback for real data changes. Never animates the data itself. */
export function feedback(element: HTMLElement): void {
  feedbackAnimations.get(element)?.cancel();
  if (!element.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animation = element.animate([{opacity: .65}, {opacity: 1}], {duration: 150, easing: 'ease-out'});
  feedbackAnimations.set(element, animation);
}
