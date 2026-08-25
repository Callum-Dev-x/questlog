// Chrome fires beforeinstallprompt; Safari has no equivalent and needs the
// manual "Add to Dock" / "Add to Home Screen" instructions instead.

let deferred = null;
const listeners = new Set();

function announce() {
  for (const listener of listeners) listener();
}

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce();
  });
}

export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canInstall() {
  return Boolean(deferred);
}

export async function promptInstall() {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  event.prompt();
  const choice = await event.userChoice;
  announce();
  return choice.outcome === 'accepted';
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}
