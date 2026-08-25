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

function backupCard(ctx) {
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

const SYNC_STATE_TEXT = {
  off: 'Not connected',
  idle: 'Connected — not synced yet',
  syncing: 'Syncing…',
  ok: 'Synced',
  error: 'Sync failed',
  offline: 'Offline',
};

function relativeTime(iso) {
  if (!iso) return null;
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function syncCard(ctx) {
  const sync = ctx.sync;
  if (!sync) return null;
  const status = sync.status;
  const connected = sync.isEnabled();
  const tone = status.state === 'error' ? 'danger'
    : status.state === 'offline' ? 'warn'
      : status.state === 'ok' ? 'good' : null;

  const statusLine = h('p.card-note', {},
    h(`span.sync-dot.is-${status.state}`),
    h('span', { class: tone ? `is-${tone}` : null, text: SYNC_STATE_TEXT[status.state] || status.state }),
    status.lastSyncedAt && status.state === 'ok'
      ? h('span.muted', { text: ` · ${relativeTime(status.lastSyncedAt)}` })
      : null,
    status.message ? h('span.muted', { text: ` · ${status.message}` }) : null);

  if (!connected) {
    const input = h('input.input', {
      placeholder: 'https://…workers.dev/v1/doc  — or a sync link from your other device',
      autocomplete: 'off', spellcheck: 'false',
    });
    return h('div.card.settings-card', {},
      h('h3.card-title', { text: 'Automatic sync (optional)' }),
      h('p.card-note', { text: 'Point both devices at your own Cloudflare Worker and they will keep themselves in step. Export and import keep working either way — this only adds to them.' }),
      statusLine,
      field('Sync server or link', input,
        'First device: paste your Worker URL and a secret key is generated. Second device: paste the sync link from the first.'),
      h('div.btn-row', {},
        button('Connect', {
          variant: 'primary',
          onClick: async () => {
            try {
              sync.connect(input.value);
              ctx.toast('Connected — syncing now', 'good');
              const result = await sync.syncNow();
              if (result && result.error) ctx.toast(result.error, 'danger');
            } catch (err) {
              ctx.toast(err.message, 'danger');
            }
          },
        }),
        h('a.btn', { href: 'https://github.com/Callum-Dev-x/questlog#automatic-sync-optional', target: '_blank', rel: 'noopener' },
          h('span', { text: 'How to set the Worker up' }))),
      h('p.form-note', { text: 'Your data would then rest on Cloudflare rather than only on your devices. Anyone holding the sync link can read and write it, so treat it like a password.' }));
  }

  const link = sync.link();
  return h('div.card.settings-card', {},
    h('h3.card-title', { text: 'Automatic sync' }),
    statusLine,
    field('Sync link for your other device',
      h('div.inline', {},
        h('input.input.mono', { value: link, readonly: true, onclick: (e) => e.target.select() })),
      'Paste this into the same box on your other device. It is a secret — anyone with it can read your data.'),
    h('div.btn-row', {},
      button('Sync now', {
        variant: 'primary',
        icon: ICONS.undo,
        onClick: async () => {
          const result = await sync.syncNow();
          if (result && result.error) ctx.toast(result.error, 'danger');
          else if (result && result.uploaded) ctx.toast('Synced — this device was ahead', 'good');
          else if (result && result.pulled) ctx.toast('Synced — pulled changes in', 'good');
          else ctx.toast('Already in sync', 'good');
        },
      }),
      button('Copy link', {
        icon: ICONS.list,
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(link);
            ctx.toast('Sync link copied — paste it on your other device', 'good');
          } catch {
            ctx.toast('Clipboard blocked — select the link and copy it by hand', 'warn');
          }
        },
      }),
      button('Disconnect', {
        variant: 'ghost',
        onClick: () => {
          if (!confirm('Stop syncing on this device? Your data stays here, and the copy on the server is left alone.')) return;
          sync.disconnect();
          ctx.toast('Sync disconnected', 'warn');
        },
      })));
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
        backupCard(ctx),
        syncCard(ctx),
        preferencesCard(ctx),
        storageCard(ctx),
        aboutCard(ctx),
        dangerCard(ctx))),
    h('p.footnote', { text: `questlog · offline-first · ${formatDay(ctx.today, ctx.today)}` }));
}
