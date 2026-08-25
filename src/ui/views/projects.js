import { h, icon, ICONS } from '../dom.js';
import { button, chip, dueSummary, emptyState, progressBar, section } from '../components.js';
import { getProjectRows } from '../../core/selectors.js';
import { formatDay } from '../../core/dates.js';
import { milestoneXp } from '../../core/xp.js';

function milestoneRow(milestone, ctx) {
  const done = Boolean(milestone.completedAt);
  return h(`div.row.milestone${done ? '.is-done' : ''}`, {},
    h('button.tick.tick-sm', {
      onclick: () => ctx.store.dispatch({ type: 'milestone/toggle', id: milestone.id, day: ctx.today }),
      'aria-pressed': String(done),
      'aria-label': `${done ? 'Reopen' : 'Complete'} ${milestone.title}`,
    }, icon(ICONS.check, 16)),
    h('div.row-body', { onclick: () => ctx.store.dispatch({ type: 'milestone/toggle', id: milestone.id, day: ctx.today }) },
      h('span.row-title', { text: milestone.title }),
      h('div.row-sub', {},
        done
          ? chip(`Done ${formatDay(milestone.completedDay || milestone.due, ctx.today)}`, 'good')
          : dueSummary(milestone.due, ctx.today),
        h('span.muted', { text: `${milestoneXp(milestone.difficulty)} XP` }))),
    h('button.icon-btn', {
      onclick: () => ctx.openMilestoneForm(milestone.projectId, milestone),
      'aria-label': `Edit ${milestone.title}`,
    }, icon(ICONS.edit, 15)));
}

function projectCard(row, ctx) {
  const { project } = row;
  return h(`article.card.project.sw-${project.color}${row.complete ? '.is-complete' : ''}`, {},
    h('div.project-head', {},
      h('div', {},
        h('h3.card-title', { text: project.title }),
        project.notes ? h('p.card-note', { text: project.notes }) : null),
      h('div.project-head-side', {},
        chip(`${row.doneCount}/${row.total}`, row.complete ? 'good' : null),
        h('button.icon-btn', {
          onclick: () => ctx.openProjectForm(project),
          'aria-label': `Edit ${project.title}`,
        }, icon(ICONS.edit, 15)))),
    progressBar(row.progress, `${Math.round(row.progress * 100)}% complete`),
    row.milestones.length
      ? h('div.milestones', {}, row.milestones.map((milestone) => milestoneRow(milestone, ctx)))
      : h('p.card-note', { text: 'No milestones yet — break the project into a few checkpoints.' }),
    h('div.project-foot', {},
      button('Milestone', { icon: ICONS.plus, onClick: () => ctx.openMilestoneForm(project.id, null) }),
      button('Task', { icon: ICONS.plus, onClick: () => ctx.openTodoForm(null, { projectId: project.id }) }),
      row.openTodos ? h('span.muted', { text: `${row.openTodos} open task${row.openTodos === 1 ? '' : 's'}` }) : null,
      row.complete ? h('span.perfect', {}, icon(ICONS.star, 14), h('span', { text: 'Complete · +50 XP' })) : null));
}

export function renderProjects(ctx) {
  const rows = getProjectRows(ctx.state, {});
  return h('div.view', {},
    section('Projects',
      button('Project', { icon: ICONS.plus, onClick: () => ctx.openProjectForm(null) }),
      rows.length
        ? h('div.stack', {}, rows.map((row) => projectCard(row, ctx)))
        : emptyState(ICONS.flag, 'No projects yet',
          'Projects hold milestones — bigger checkpoints worth triple XP, plus a bonus when you finish them all.',
          button('Add a project', { variant: 'primary', icon: ICONS.plus, onClick: () => ctx.openProjectForm(null) }))));
}
