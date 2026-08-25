// Shared UI pieces. Every one is a pure function of state → DOM node; the
// views rebuild them wholesale whenever the store changes.

import { h, icon, ICONS } from './dom.js';
import { formatDay, diffDays, WEEKDAY_NAMES } from '../core/dates.js';
import { describeSchedule } from '../core/streaks.js';
import { DIFFICULTIES, DIFFICULTY_LABELS, BASE_XP } from '../core/xp.js';

export function fmt(n) {
  return Number(n || 0).toLocaleString();
}

export function section(title, actions, ...children) {
  return h('section.block', {},
    h('div.block-head', {},
      h('h2.block-title', { text: title }),
      actions ? h('div.block-actions', {}, actions) : null),
    ...children);
}

export function emptyState(iconPath, title, hint, action) {
  return h('div.empty', {},
    h('div.empty-icon', {}, icon(iconPath, 24)),
    h('p.empty-title', { text: title }),
    hint ? h('p.empty-hint', { text: hint }) : null,
    action || null);
}

export function button(label, opts = {}) {
  const el = h(`button.btn${opts.variant ? `.btn-${opts.variant}` : ''}`, {
    type: opts.type || 'button',
    onclick: opts.onClick,
    'aria-label': opts.ariaLabel || null,
    disabled: opts.disabled || null,
  });
  if (opts.icon) el.appendChild(icon(opts.icon, opts.iconSize || 16));
  if (label) el.appendChild(h('span', { text: label }));
  return el;
}

export function chip(text, variant) {
  return h(`span.chip${variant ? `.chip-${variant}` : ''}`, { text });
}

export function xpBar(summary) {
  return h('div.xpbar', { 'aria-label': `${summary.xpIntoLevel} of ${summary.xpForThisLevel} XP to level ${summary.level + 1}` },
    h('div.xpbar-fill', { style: { width: `${Math.min(100, Math.round(summary.progress * 100))}%` } }));
}

/** The level / streak banner that sits at the top of every screen. */
export function heroCard(summary, today) {
  return h('header.hero', {},
    h('div.hero-top', {},
      h('div.hero-level', {},
        h('span.hero-level-num', { text: String(summary.level) }),
        h('span.hero-level-label', { text: 'Level' })),
      h('div.hero-meta', {},
        h('p.hero-rank', { text: summary.rank }),
        h('p.hero-total', { text: `${fmt(summary.totalXp)} XP total` })),
      h('div.hero-streak', { title: 'Days in a row with something completed' },
        icon(ICONS.flame, 18),
        h('span', { text: String(summary.activityStreak) }))),
    xpBar(summary),
    h('div.hero-foot', {},
      h('span', { text: `${fmt(summary.xpToNext)} XP to level ${summary.level + 1}` }),
      h('span', { text: `+${fmt(summary.todayXp)} today · +${fmt(summary.weekXp)} this week` })),
    today ? h('p.hero-date', { text: formatDay(today, today) }) : null);
}

/** Seven dots showing the last week of a habit. */
function historyDots(row) {
  return h('div.dots', {},
    row.history.map((cell) => h(
      `span.dot${cell.done ? '.dot-done' : cell.scheduled ? '.dot-due' : '.dot-off'}`,
      { title: `${formatDay(cell.day, row.history[6].day)}${cell.done ? ' — done' : ''}` },
    )));
}

export function habitCard(row, ctx) {
  const { habit } = row;
  const toggle = () => ctx.store.dispatch({
    type: row.done ? 'habit/uncomplete' : 'habit/complete',
    id: habit.id,
    day: ctx.today,
  });

  const streakChip = row.streak > 0
    ? h('span.streak', { title: `Longest: ${row.longest}` }, icon(ICONS.flame, 13), h('span', { text: `${row.streak}${row.unit === 'week' ? 'w' : ''}` }))
    : null;

  const weekly = row.weekly
    ? chip(`${row.weekly.count}/${row.weekly.target} this week`, row.weekly.remaining === 0 ? 'good' : null)
    : null;

  return h(`article.card.habit${row.done ? '.is-done' : ''}${row.required ? '' : '.is-optional'}`, {},
    h('button.tick', {
      onclick: toggle,
      'aria-pressed': String(row.done),
      'aria-label': `${row.done ? 'Undo' : 'Complete'} ${habit.title}`,
    }, icon(ICONS.check, 18)),
    h('div.card-body', { onclick: toggle },
      h('div.card-title-row', {},
        h('h3.card-title', { text: habit.title }),
        streakChip),
      h('div.card-sub', {},
        h('span', { text: describeSchedule(habit.schedule) }),
        h('span.sep', { text: '·' }),
        h('span', { text: row.done ? 'Done today' : `+${row.xpIfDone} XP` }),
        weekly)),
    h('div.card-side', {},
      historyDots(row),
      h('button.icon-btn', {
        onclick: (event) => { event.stopPropagation(); ctx.openHabitForm(habit); },
        'aria-label': `Edit ${habit.title}`,
      }, icon(ICONS.edit, 15))));
}

export function todoRow(todo, ctx, opts = {}) {
  const done = Boolean(todo.completedAt);
  const toggle = () => ctx.store.dispatch({ type: 'todo/toggle', id: todo.id, day: ctx.today });
  const overdue = !done && todo.due && todo.due < ctx.today;
  const project = todo.projectId && ctx.state.projects[todo.projectId];

  return h(`div.row.todo${done ? '.is-done' : ''}`, {},
    h('button.tick.tick-sm', {
      onclick: toggle,
      'aria-pressed': String(done),
      'aria-label': `${done ? 'Reopen' : 'Complete'} ${todo.title}`,
    }, icon(ICONS.check, 16)),
    h('div.row-body', { onclick: toggle },
      h('span.row-title', { text: todo.title }),
      h('div.row-sub', {},
        todo.due ? h(`span${overdue ? '.overdue' : ''}`, { text: formatDay(todo.due, ctx.today) }) : null,
        project ? chip(project.title) : null,
        opts.showXp !== false ? h('span.muted', { text: `${BASE_XP[todo.difficulty]} XP` }) : null)),
    h('button.icon-btn', {
      onclick: () => ctx.openTodoForm(todo),
      'aria-label': `Edit ${todo.title}`,
    }, icon(ICONS.edit, 15)));
}

export function progressBar(value, label) {
  return h('div.progress', { 'aria-label': label || null },
    h('div.progress-fill', { style: { width: `${Math.round(value * 100)}%` } }));
}

export function heatmap(cells, today) {
  const grid = h('div.heatmap');
  for (const cell of cells) {
    grid.appendChild(cell.pad
      ? h('span.hm.hm-pad', { 'aria-hidden': 'true' })
      : h(`span.hm.hm-${cell.level}`, { title: `${formatDay(cell.day, today)} — ${cell.xp} XP` }));
  }
  return h('div.heatmap-wrap', {}, grid,
    h('div.heatmap-key', {},
      h('span.muted', { text: 'less' }),
      [0, 1, 2, 3, 4].map((level) => h(`span.hm.hm-${level}`)),
      h('span.muted', { text: 'more' })));
}

// ---- form controls ------------------------------------------------------

export function field(label, control, hint) {
  return h('label.field', {},
    h('span.field-label', { text: label }),
    control,
    hint ? h('span.field-hint', { text: hint }) : null);
}

export function textInput(name, value, opts = {}) {
  return h('input.input', {
    name, type: opts.type || 'text', value: value || '',
    placeholder: opts.placeholder || '', required: opts.required || null,
    autocomplete: 'off', enterkeyhint: 'done',
  });
}

export function difficultyPicker(name, value) {
  return h('div.segmented', {},
    DIFFICULTIES.map((level) => h('label.segment', {},
      h('input', { type: 'radio', name, value: level, checked: level === value || null }),
      h('span', { text: `${DIFFICULTY_LABELS[level]} · ${BASE_XP[level]}` }))));
}

export function schedulePicker(schedule) {
  const kind = schedule.kind;
  const days = kind === 'days' ? schedule.days : [1, 2, 3, 4, 5];
  const target = kind === 'weekly' ? schedule.target : 3;

  const dayToggles = h('div.daypick', {},
    WEEKDAY_NAMES.map((name, index) => h('label.daybtn', {},
      h('input', { type: 'checkbox', name: 'weekday', value: String(index), checked: days.includes(index) || null }),
      h('span', { text: name[0] }))));

  const targetInput = h('input.input.input-num', {
    name: 'weeklyTarget', type: 'number', min: '1', max: '7', value: String(target),
  });

  const extras = h('div.sched-extra', {}, kind === 'days' ? dayToggles : kind === 'weekly' ? h('div.inline', {}, targetInput, h('span.muted', { text: 'times per week' })) : null);

  const wrap = h('div', {},
    h('div.segmented', {},
      [['daily', 'Every day'], ['days', 'Certain days'], ['weekly', 'Times per week']].map(([value, label]) => h('label.segment', {},
        h('input', {
          type: 'radio', name: 'scheduleKind', value, checked: value === kind || null,
          onchange: () => {
            extras.replaceChildren();
            if (value === 'days') extras.appendChild(dayToggles);
            if (value === 'weekly') extras.appendChild(h('div.inline', {}, targetInput, h('span.muted', { text: 'times per week' })));
          },
        }),
        h('span', { text: label })))),
    extras);
  return wrap;
}

/** Read a schedule back out of a submitted form. */
export function readSchedule(form) {
  const kind = form.scheduleKind.value;
  if (kind === 'days') {
    const days = Array.from(form.querySelectorAll('input[name="weekday"]:checked')).map((el) => Number(el.value));
    return { kind: 'days', days }; // an empty selection normalizes back to daily
  }
  if (kind === 'weekly') return { kind: 'weekly', target: Number(form.weeklyTarget && form.weeklyTarget.value) || 3 };
  return { kind: 'daily' };
}

export function dueSummary(due, today) {
  if (!due) return null;
  const delta = diffDays(today, due);
  if (delta < 0) return chip(`${Math.abs(delta)}d overdue`, 'danger');
  return chip(formatDay(due, today), delta <= 1 ? 'warn' : null);
}
