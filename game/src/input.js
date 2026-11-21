// Keyboard and mouse input. Held keys are read as levels every step; one-shot presses are
// queued as bit flags and taken once by the loop, so a tap between two frames is never lost
// and never counted twice. The mouse steers the camera: while playing, the pointer locks to
// the canvas and its movement turns the view; a held left button is the trigger.

export const ACTION_INTERACT = 1;   // F or E: enter / leave a vehicle, take a mission
export const ACTION_PAUSE = 2;      // Esc or P
export const ACTION_CONFIRM = 4;    // Enter or a click on a menu
export const ACTION_RADIO = 8;      // R
export const ACTION_MISSIONS = 16;  // M: cycle the offered mission
export const ACTION_WEAPON_1 = 32;
export const ACTION_WEAPON_2 = 64;
export const ACTION_WEAPON_3 = 128;
export const ACTION_WEAPON_4 = 256;

const KEYMAP = new Map([
  ['KeyF', ACTION_INTERACT], ['KeyE', ACTION_INTERACT],
  ['Escape', ACTION_PAUSE], ['KeyP', ACTION_PAUSE],
  ['Enter', ACTION_CONFIRM],
  ['KeyR', ACTION_RADIO],
  ['KeyM', ACTION_MISSIONS],
  ['Digit1', ACTION_WEAPON_1], ['Digit2', ACTION_WEAPON_2],
  ['Digit3', ACTION_WEAPON_3], ['Digit4', ACTION_WEAPON_4],
]);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let mouseDX = 0;
  let mouseDY = 0;
  let firing = false;
  let locked = false;

  window.addEventListener('keydown', (event) => {
    held.add(event.code);
    const action = KEYMAP.get(event.code);
    if (action !== undefined && !event.repeat) actions |= action;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => { held.delete(event.code); });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => { held.clear(); firing = false; });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      firing = true;
      actions |= ACTION_CONFIRM;
      if (!locked && canvas.requestPointerLock) {
        try {
          const pending = canvas.requestPointerLock();
          if (pending && pending.catch) pending.catch(() => { /* headless: no lock */ });
        } catch { /* not fatal */ }
      }
    }
  });
  window.addEventListener('pointerup', (event) => { if (event.button === 0) firing = false; });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', (event) => {
    if (!locked) return;
    mouseDX += event.movementX || 0;
    mouseDY += event.movementY || 0;
  });

  return {
    /** Is this key code currently held down? */
    down(code) { return held.has(code); },
    /** Forward/back input: W/S and the arrow keys. */
    throttle() { return (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0); },
    /** Left/right input: A/D and the arrow keys, -1..1. */
    steer() { return (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0); },
    sprint() { return held.has('ShiftLeft') || held.has('ShiftRight'); },
    handbrake() { return held.has('Space'); },
    firing() { return firing; },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() { const taken = actions; actions = 0; return taken; },
    /** Mouse movement since the last call, for the camera; consumed by reading. */
    takeMouse() { const out = { dx: mouseDX, dy: mouseDY }; mouseDX = 0; mouseDY = 0; return out; },
    /** Drop any queued mouse movement (used when a scene is staged for a screenshot). */
    clearMouse() { mouseDX = 0; mouseDY = 0; },
    isLocked() { return locked; },
  };
}
