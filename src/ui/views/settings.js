import { h, icon, ICONS } from '../dom.js';
import { button, field, section } from '../components.js';
import { exportFilename, importInto, serialize } from '../../core/io.js';
import { summarizeMerge } from '../../core/merge.js';
import { createState } from '../../core/schema.js';
import { clearState, requestPersistence, storageEstimate } from '../storage.js';
import { canInstall, isStandalone, promptInstall } from '../install.js';
import { formatDay } from '../../core/dates.js';

async function shareOrDownload(text, filename, ctx) {
  const type = 'application/json';
  try {
    const file = new File([text], filename, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      ctx.toast(`Shared ${filename}`);
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  ctx.toast(`Saved ${filename}`);
}

function syncCard(ctx) {
  const modeWrap = h('div.segmented', {},
    [['merge', 'Merge'], ['replace', 'Replace']].map(([value, label]) => h('label.segment', {},
      h('input', { type: 'radio', name: 'importMode', value, checked: value === 'merge' || null }),
      h('span', { text: label }))));

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'visually-hidden',
    onchange: async (event) => {
      const [file] = event.target.files || [];
      if (!file) return;
      const mode = modeWrap.querySelector('input:checked').value;
      try {
        const text = await file.text();
        if (mode === 'replace' && !confirm('Replace everything on this device with the contents of this file? Anything not in the file is lost.')) return;
        const result = importInto(ctx.state, text, { mode, now: new Date() });
        ctx.store.setState(result.state);
        const detail = result.mode === 'replace' ? 'Replaced this device from the file' : `Merged: ${summarizeMerge(result.stats)}`;
        ctx.toast(detail, 'good');
        for (const warning of result.warnings.slice(0, 3)) ctx.toast(warning, 'warn');
      } catch (err) {
        ctx.toast(err.message, 'danger');
      } finally {
        event.target.value = '';
      }
    },
  });

  const pasteArea = h('textarea.input.paste', { placeholder: '…or paste exported JSON here', rows: '3' });

  return h('div.card.settings-card', {},
    h('h3.card-title', { text: 'Backup & sync' }),
    h('p.card-note', { text: 'There is no account and no server. Move your data between devices by exporting a file here and importing it there.' }),
    h('div.btn-row', {},
      button('Export JSON', {
        variant: 'primary', icon: ICONS.download,
        onClick: () => shareOrDownload(serialize(ctx.state, { now: new Date() }), exportFilename(), ctx),
      }),
      button('Copy to clipboard', {
        icon: ICONS.list,
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(serialize(ctx.state, { now: new Date() }));
            ctx.toast('Copied the full backup to your clipboard', 'good');
          } catch {
            ctx.toast('Clipboard blocked — use Export JSON instead', 'warn');
          }
        },
      })),
    h('hr.rule'),
    field('When importing', modeWrap,
      'Merge keeps both sides and can be run in any order. Replace throws away what is on this device.'),
    h('div.btn-row', {},
      button('Choose a file…', { icon: ICONS.upload, onClick: () => fileInput.click() }),
      fileInput),
    pasteArea,
    h('div.btn-row', {},
      button('Import pasted JSON', {
        onClick: () => {
          const text = pasteArea.value.trim();
          if (!text) { ctx.toast('Nothing pasted yet', 'warn'); return; }
          const mode = modeWrap.querySelector('input:checked').value;
          try {
            if (mode === 'replace' && !confirm('Replace everything on this device?')) return;
            const result = importInto(ctx.state, text, { mode, now: new Date() });
            ctx.store.setState(result.state);
            pasteArea.value = '';
            ctx.toast(result.mode === 'replace' ? 'Replaced this device' : `Merged: ${summarizeMerge(result.stats)}`, 'good');
          } catch (err) {
            ctx.toast(err.message, 'danger');
          }
        },
      })),
    ctx.state.meta.lastImportAt
      ? h('p.card-note', { text: `Last import: ${new Date(ctx.state.meta.lastImportAt).toLocaleString()}` })
      : null,
    h('p.card-note.mono', { text: `This device: ${ctx.state.meta.deviceId}` }));
}

function preferencesCard(ctx) {
  const settings = ctx.state.settings;
  return h('div.card.settings-card', {},
    h('h3.card-title', { text: 'Preferences' }),
    field('Name', h('input.input', {
      value: ctx.state.profile.name,
      onchange: (event) => ctx.store.dispatch({ type: 'profile/update', patch: { name: event.target.value.trim() || 'Adventurer' } }),
    })),
    field('Week starts on', h('select.input', {
      onchange: (event) => ctx.store.dispatch({ type: 'settings/update', patch: { weekStartsOn: Number(event.target.value) } }),
    },
    [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']].map(([value, label]) => h('option', {
      value: String(value), text: label, selected: settings.weekStartsOn === value || null,
    }))), 'Used for weekly targets and the weekly XP total.'),
    field('Theme', h('select.input', {
      onchange: (event) => ctx.store.dispatch({ type: 'settings/update', patch: { theme: event.target.value } }),
    },
    [['auto', 'Match system'], ['dark', 'Dark'], ['light', 'Light']].map(([value, label]) => h('option', {
      value, text: label, selected: settings.theme === value || null,
    })))),
    h('label.toggle', {},
      h('input', {
        type: 'checkbox', checked: settings.confetti || null,
        onchange: (event) => ctx.store.dispatch({ type: 'settings/update', patch: { confetti: event.target.checked } }),
      }),
      h('span', { text: 'Celebrate level-ups and perfect days' })));
}

function storageCard(ctx) {
  const card = h('div.card.settings-card', {},
    h('h3.card-title', { text: 'On-device storage' }),
    h('p.card-note', { text: 'Everything lives in this browser profile. Nothing is ever sent anywhere.' }),
    h('p.card-note.mono', { text: 'Checking…' }));
  const line = card.lastChild;

  (async () => {
    const persisted = await requestPersistence();
    const estimate = await storageEstimate();
    const used = estimate && estimate.usage ? `${(estimate.usage / 1024).toFixed(0)} KB used` : 'size unknown';
    line.textContent = `${persisted ? 'Persistent storage granted' : 'Best-effort storage'} · ${used}`;
  })();

  return card;
}

function aboutCard(ctx) {
  const installed = isStandalone();
  return h('div.card.settings-card', {},
    h('h3.card-title', { text: installed ? 'Installed' : 'Install' }),
    canInstall() ? h('div.btn-row', {}, button('Install questlog', {
      variant: 'primary',
      icon: ICONS.download,
      onClick: async () => {
        const accepted = await promptInstall();
        ctx.toast(accepted ? 'Installed — look for questlog in your dock' : 'Install dismissed');
      },
    })) : null,
    installed ? h('p.card-note', { text: 'Running as an installed app. Data is stored in this app profile.' }) : null,
    h('ul.plain', {},
      h('li', { text: 'macOS Safari: File → Add to Dock.' }),
      h('li', { text: 'macOS Chrome: the install icon in the address bar, or ⋮ → Cast, Save and Share → Install.' }),
      h('li', { text: 'iPhone Safari: Share → Add to Home Screen.' })),
    h('p.card-note', { text: 'Once installed the app opens in its own window and works with no network at all.' }));
}

function dangerCard(ctx) {
  return h('div.card.settings-card.danger', {},
    h('h3.card-title', { text: 'Reset' }),
    h('p.card-note', { text: 'Deletes every habit, task, project and XP record on this device. Export first if you might want it back.' }),
    button('Erase all data', {
      variant: 'danger',
      icon: ICONS.trash,
      onClick: async () => {
        if (!confirm('Erase everything on this device? This cannot be undone.')) return;
        if (!confirm('Really erase? Make sure you have exported a backup.')) return;
        await clearState();
        ctx.store.setState(createState({ now: new Date() }));
        ctx.toast('All data erased', 'warn');
      },
    }));
}

export function renderSettings(ctx) {
  return h('div.view', {},
    section('Settings', null,
      h('div.stack', {},
        syncCard(ctx),
        preferencesCard(ctx),
        storageCard(ctx),
        aboutCard(ctx),
        dangerCard(ctx))),
    h('p.footnote', { text: `questlog · offline-first · ${formatDay(ctx.today, ctx.today)}` }));
}
