import { h, icon, ICONS } from '../dom.js';
import { button, emptyState, habitCard, heroCard, section, todoRow } from '../components.js';
import { getTodayView } from '../../core/selectors.js';
import { formatDay } from '../../core/dates.js';

function bucket(title, todos, ctx, tone) {
  if (!todos.length) return null;
  return h('div.bucket', {},
    h('h3.bucket-title', { class: tone ? `is-${tone}` : null },
      h('span', { text: title }),
      h('span.count', { text: String(todos.length) })),
    todos.map((todo) => todoRow(todo, ctx)));
}

export function renderToday(ctx) {
  const view = getTodayView(ctx.state, { today: ctx.today });
  const { todos } = view;
  const doneToday = todos.done.filter((todo) => todo.completedDay === ctx.today);

  const habitBlock = view.habits.length
    ? h('div.stack', {}, view.habits.map((row) => habitCard(row, ctx)))
    : emptyState(ICONS.target, 'No habits yet',
      'Habits are the daily engine — each one you tick pays XP and builds a streak.',
      button('Add your first habit', { variant: 'primary', icon: ICONS.plus, onClick: () => ctx.openHabitForm(null) }));

  const anyTodos = todos.overdue.length + todos.today.length + todos.upcoming.length
    + todos.someday.length + doneToday.length;

  return h('div.view', {},
    heroCard(view.summary, ctx.today),

    view.counts.habitsDue > 0 ? h('div.daygoal', {},
      h('span', { text: `${view.counts.habitsDone} of ${view.counts.habitsDue} habits done` }),
      view.perfectDay ? h('span.perfect', {}, icon(ICONS.star, 14), h('span', { text: 'Perfect day · +15 XP' })) : null) : null,

    section('Habits',
      button('Habit', { icon: ICONS.plus, onClick: () => ctx.openHabitForm(null) }),
      habitBlock),

    section('Tasks',
      button('Task', { icon: ICONS.plus, onClick: () => ctx.openTodoForm(null, { due: ctx.today }) }),
      anyTodos
        ? h('div.stack', {},
          bucket('Overdue', todos.overdue, ctx, 'danger'),
          bucket('Today', todos.today, ctx, 'accent'),
          bucket('Upcoming', todos.upcoming, ctx),
          bucket('Someday', todos.someday, ctx),
          doneToday.length ? h('details.done-block', {},
            h('summary', { text: `Completed today (${doneToday.length})` }),
            doneToday.map((todo) => todoRow(todo, ctx))) : null)
        : emptyState(ICONS.list, 'Nothing on the list',
          'One-off tasks live here. Give one a due date and finish it in time for a bonus.',
          button('Add a task', { variant: 'primary', icon: ICONS.plus, onClick: () => ctx.openTodoForm(null, { due: ctx.today }) }))),

    h('p.footnote', { text: `Showing ${formatDay(ctx.today, ctx.today)}` }));
}
