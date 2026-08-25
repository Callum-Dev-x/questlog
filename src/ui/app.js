// App shell: boot, routing, modals, toasts and the celebration bits.

import { h, icon, ICONS, clear } from './dom.js';
import { createStore } from './store.js';
import { loadState, requestPersistence } from './storage.js';
import { createState, migrate, normalizeState } from '../core/schema.js';
import { dayKey } from '../core/dates.js';
import { getTodayView } from '../core/selectors.js';
import { habitForm, milestoneForm, projectForm, todoForm } from './forms.js';
import { renderToday } from './views/today.js';
import { renderProjects } from './views/projects.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { initInstall, onInstallChange } from './install.js';

const ROUTES = [
  { id: 'today', label: 'Today', icon: ICONS.target, render: renderToday },
  { id: 'projects', label: 'Projects', icon: ICONS.flag, render: renderProjects },
  { id: 'stats', label: 'Stats', icon: ICONS.chart, render: renderStats },
  { id: 'settings', label: 'Settings', icon: ICONS.gear, render: renderSettings },
];

function routeFromHash() {
  const id = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES.some((route) => route.id === id) ? id : 'today';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Anything already on disk goes through the same validation as an import. */
function hydrate(raw) {
  if (!raw) return createState({ now: new Date() });
  try {
    const { state } = normalizeState(migrate(raw));
    return state;
  } catch (err) {
    console.error('questlog: stored document was unreadable, starting fresh', err);
    return createState({ now: new Date() });
  }
}

/**
 * boot() is async, so by the time it finishes the window 'load' event has very
 * likely already fired — waiting for it would mean never registering at all.
 */
function registerServiceWorker(toast) {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update ready — reopen the app to apply it');
          }
        });
      });
    }).catch((err) => console.warn('questlog: service worker not registered', err));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

async function boot() {
  const loaded = await loadState();
  const store = createStore(hydrate(loaded.state));
  const root = document.getElementById('app');
  const viewEl = document.getElementById('view');
  const navEl = document.getElementById('nav');
  const toastEl = document.getElementById('toasts');
  const modalEl = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const modalTitle = document.getElementById('modal-title');

  let route = routeFromHash();

  const ctx = {
    store,
    get state() { return store.getState(); },
    today: dayKey(),
    toast,
    openModal,
    closeModal,
    openHabitForm(habit) { openModal(habit ? 'Edit habit' : 'New habit', habitForm(ctx, habit)); },
    openTodoForm(todo, defaults) { openModal(todo ? 'Edit task' : 'New task', todoForm(ctx, todo, defaults)); },
    openProjectForm(project) { openModal(project ? 'Edit project' : 'New project', projectForm(ctx, project)); },
    openMilestoneForm(projectId, milestone) {
      openModal(milestone ? 'Edit milestone' : 'New milestone', milestoneForm(ctx, projectId, milestone));
    },
  };

  // ---- chrome ----------------------------------------------------------

  function renderNav() {
    clear(navEl);
    for (const item of ROUTES) {
      navEl.appendChild(h(`a.tab${item.id === route ? '.is-active' : ''}`, {
        href: `#/${item.id}`,
        'aria-current': item.id === route ? 'page' : null,
      }, icon(item.icon, 20), h('span', { text: item.label })));
    }
  }

  function render() {
    const scroll = window.scrollY;
    const current = ROUTES.find((item) => item.id === route) || ROUTES[0];
    clear(viewEl);
    viewEl.appendChild(current.render(ctx));
    renderNav();
    document.title = `questlog · ${current.label}`;
    applyTheme(store.getState().settings.theme);
    window.scrollTo(0, scroll);
  }

  function openModal(title, node) {
    modalTitle.textContent = title;
    clear(modalBody);
    modalBody.appendChild(node);
    if (typeof modalEl.showModal === 'function') modalEl.showModal();
    else modalEl.setAttribute('open', '');
    const firstInput = modalBody.querySelector('input:not([type=radio]):not([type=checkbox]), textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 30);
  }

  function closeModal() {
    if (typeof modalEl.close === 'function') modalEl.close();
    else modalEl.removeAttribute('open');
    clear(modalBody);
  }

  function toast(message, tone = '') {
    const node = h(`div.toast${tone ? `.toast-${tone}` : ''}`, { role: 'status' }, h('span', { text: message }));
    toastEl.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 350);
    }, 3600);
  }

  function floatXp(delta) {
    const node = h(`div.xpfloat${delta < 0 ? '.is-loss' : ''}`, { text: `${delta > 0 ? '+' : ''}${delta} XP` });
    toastEl.appendChild(node);
    setTimeout(() => node.remove(), 1400);
  }

  function celebrate() {
    if (!store.getState().settings.confetti) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const burst = h('div.confetti', { 'aria-hidden': 'true' });
    for (let i = 0; i < 28; i++) {
      burst.appendChild(h('i', {
        style: {
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 200}ms`,
          animationDuration: `${900 + Math.random() * 700}ms`,
          transform: `rotate(${Math.random() * 360}deg)`,
        },
      }));
    }
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 2200);
  }

  // ---- wiring ----------------------------------------------------------

  let wasPerfect = getTodayView(store.getState(), { today: ctx.today }).perfectDay;

  store.subscribe(() => {
    render();
    const perfect = getTodayView(store.getState(), { today: ctx.today }).perfectDay;
    if (perfect && !wasPerfect) {
      toast('Perfect day — every habit done', 'good');
      celebrate();
    }
    wasPerfect = perfect;
  });

  store.on((event) => {
    if (event.type === 'xp' && event.delta !== 0) floatXp(event.delta);
    if (event.type === 'level-up') {
      toast(`Level ${event.level}!`, 'level');
      celebrate();
    }
    if (event.type === 'save-error') toast('Could not save to this device — check storage settings', 'danger');
  });

  window.addEventListener('hashchange', () => {
    route = routeFromHash();
    window.scrollTo(0, 0);
    render();
  });

  modalEl.querySelector('[data-close]').addEventListener('click', closeModal);
  modalEl.addEventListener('click', (event) => {
    if (event.target === modalEl) closeModal(); // backdrop
  });
  modalEl.addEventListener('close', () => clear(modalBody));

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if (typing) return;
    const index = Number(event.key) - 1;
    if (index >= 0 && index < ROUTES.length) location.hash = `#/${ROUTES[index].id}`;
    if (event.key === 'h') ctx.openHabitForm(null);
    if (event.key === 't') ctx.openTodoForm(null, { due: ctx.today });
  });

  // Roll over at midnight without needing a reload.
  setInterval(() => {
    const now = dayKey();
    if (now !== ctx.today) {
      ctx.today = now;
      wasPerfect = getTodayView(store.getState(), { today: now }).perfectDay;
      render();
    }
  }, 30000);

  initInstall();
  onInstallChange(() => { if (route === 'settings') render(); });
  render();
  root.classList.add('is-ready');
  requestPersistence();

  if (loaded.source === 'localstorage') {
    toast('Restored from the local backup copy', 'warn');
  }

  registerServiceWorker(toast);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('view').textContent = `questlog failed to start: ${err.message}`;
});
