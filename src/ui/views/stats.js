import { h, ICONS } from '../dom.js';
import { emptyState, fmt, heatmap, heroCard, section } from '../components.js';
import { getHeatmap, getRecentActivity, getStats, xpByKind } from '../../core/selectors.js';
import { formatDay } from '../../core/dates.js';

function statTile(label, value, hint) {
  return h('div.tile', {},
    h('p.tile-value', { text: value }),
    h('p.tile-label', { text: label }),
    hint ? h('p.tile-hint', { text: hint }) : null);
}

const SOURCE_LABELS = {
  habit: 'Habits', todo: 'Tasks', milestone: 'Milestones',
  project: 'Project bonuses', perfect_day: 'Perfect days',
};

function sourceBreakdown(state) {
  const byKind = xpByKind(state.entries);
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const order = Object.entries(byKind).filter(([, xp]) => xp > 0).sort((a, b) => b[1] - a[1]);

  return h('div.sources', {},
    h('div.source-bar', {}, order.map(([kind, xp]) => h(`span.seg.seg-${kind}`, {
      style: { width: `${(xp / total) * 100}%` },
      title: `${SOURCE_LABELS[kind] || kind}: ${xp} XP`,
    }))),
    h('ul.source-list', {}, order.map(([kind, xp]) => h('li', {},
      h(`span.swatch-dot.seg-${kind}`),
      h('span', { text: SOURCE_LABELS[kind] || kind }),
      h('span.muted', { text: `${fmt(xp)} XP · ${Math.round((xp / total) * 100)}%` })))));
}

function activityFeed(state, today) {
  const rows = getRecentActivity(state, { limit: 40 });
  if (!rows.length) return null;
  return h('ul.feed', {}, rows.map((row) => h('li.feed-row', {},
    h('span.feed-xp', { text: `+${row.entry.xp}` }),
    h('div.feed-body', {},
      h('span.feed-title', { text: row.title }),
      h('span.feed-sub', {
        text: `${row.kindLabel}${row.streak > 1 ? ` · ${row.streak} ${row.streakUnit}s in a row` : ''}`,
      })),
    h('span.feed-day', { text: formatDay(row.entry.day, today) }))));
}

export function renderStats(ctx) {
  const stats = getStats(ctx.state, { today: ctx.today });
  const cells = getHeatmap(ctx.state, {
    today: ctx.today, days: 91, align: true, weekStartsOn: ctx.state.settings.weekStartsOn,
  });

  if (stats.totalXp === 0) {
    return h('div.view', {},
      heroCard(stats, ctx.today),
      emptyState(ICONS.chart, 'No history yet', 'Complete a habit or a task and this page fills up.'));
  }

  return h('div.view', {},
    heroCard(stats, ctx.today),
    section('Last 13 weeks', null, heatmap(cells, ctx.today)),
    section('At a glance', null, h('div.tiles', {},
      statTile('Total XP', fmt(stats.totalXp)),
      statTile('Level', String(stats.level), stats.rank),
      statTile('Current streak', `${stats.activityStreak}d`, 'days in a row'),
      statTile('Longest habit streak', `${stats.bestStreak}`, 'consecutive'),
      statTile('Perfect days', String(stats.perfectDays)),
      statTile('Best day', stats.bestDay ? `${fmt(stats.bestDay.xp)} XP` : '—',
        stats.bestDay ? formatDay(stats.bestDay.day, ctx.today) : null),
      statTile('Consistency', `${stats.consistency}%`, 'active days, last 30'),
      statTile('Open tasks', String(stats.openTodos)))),
    section('Where the XP came from', null, sourceBreakdown(ctx.state)),
    section('Recent activity', null, activityFeed(ctx.state, ctx.today)));
}
