// Render smoke tests. The views are DOM-only, and this suite runs in a real
// browser, so it can build each screen for real and check what came out.
// This is the net that catches a missing import or a renamed selector.

import { describe, it, expect } from './harness.js';
import { renderToday } from '../src/ui/views/today.js';
import { renderProjects } from '../src/ui/views/projects.js';
import { renderStats } from '../src/ui/views/stats.js';
import { renderSettings } from '../src/ui/views/settings.js';
import { habitForm, todoForm, projectForm, milestoneForm } from '../src/ui/forms.js';
import { seedState, on } from './helpers.js';

const TODAY = '2026-01-07';

function populated() {
  let state = seedState();
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h2', title: 'Gym', order: 2, difficulty: 'hard', schedule: { kind: 'days', days: [1, 3, 5] } } });
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h3', title: 'Long run', order: 3, schedule: { kind: 'weekly', target: 2 } } });
  state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-07', state, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 't1', title: 'Renew passport', due: '2026-01-02', difficulty: 'medium', order: 1 } });
  state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 't2', title: 'Book dentist', due: TODAY, order: 2 } });
  state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 't3', title: 'Someday thing', order: 3 } });
  state = on('2026-01-05', state, { type: 'project/add', project: { id: 'p1', title: 'Ship questlog', order: 1 } });
  state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm1', projectId: 'p1', title: 'Engine', due: '2026-01-02', order: 1 } });
  state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm2', projectId: 'p1', title: 'UI', due: '2026-02-01', order: 2 } });
  state = on('2026-01-06', state, { type: 'milestone/toggle', id: 'm1', day: '2026-01-06' });
  return state;
}

/** A ctx that records what the view would have dispatched. */
function makeCtx(state = populated()) {
  const dispatched = [];
  const opened = [];
  const ctx = {
    today: TODAY,
    state,
    store: {
      dispatch(action) { dispatched.push(action); return state; },
      setState(next) { state = next; return next; },
      getState: () => state,
    },
    dispatched,
    opened,
    toast(message, tone) { opened.push(['toast', message, tone]); },
    openModal(title) { opened.push(['modal', title]); },
    closeModal() { opened.push(['close']); },
    openHabitForm(habit) { opened.push(['habit', habit]); },
    openTodoForm(todo) { opened.push(['todo', todo]); },
    openProjectForm(project) { opened.push(['project', project]); },
    openMilestoneForm(projectId, milestone) { opened.push(['milestone', projectId, milestone]); },
  };
  return ctx;
}

function text(node) {
  return node.textContent.replace(/\s+/g, ' ');
}

describe('view rendering', () => {
  it('renders Today with habits, streaks and task buckets', () => {
    const node = renderToday(makeCtx());
    const body = text(node);
    expect(body).toContain('Read');
    expect(body).toContain('Every day');
    expect(body).toContain('Mon, Wed, Fri');
    expect(body).toContain('2× per week');
    expect(body).toContain('Renew passport');
    expect(body).toContain('Overdue');
    expect(body).toContain('Someday');
    expect(node.querySelectorAll('.habit')).toHaveLength(3);
    expect(node.querySelectorAll('.todo').length).toBeGreaterThan(2);
  });

  it('renders empty Today without throwing', () => {
    const node = renderToday(makeCtx(seedState()));
    expect(text(node)).toContain('No habits yet');
    expect(text(node)).toContain('Nothing on the list');
  });

  it('renders Projects with progress and milestone state', () => {
    const node = renderProjects(makeCtx());
    const body = text(node);
    expect(body).toContain('Ship questlog');
    expect(body).toContain('1/2');
    expect(body).toContain('Engine');
    // a completed milestone reads as done, never as overdue
    expect(body).toContain('Done');
    expect(body).not.toContain('overdue');
    expect(node.querySelector('.progress-fill').style.width).toBe('50%');
  });

  it('renders empty Projects', () => {
    expect(text(renderProjects(makeCtx(seedState())))).toContain('No projects yet');
  });

  it('renders Stats with a heatmap, tiles and a feed', () => {
    const node = renderStats(makeCtx());
    const body = text(node);
    expect(body).toContain('Total XP');
    expect(body).toContain('Perfect days');
    expect(body).toContain('Where the XP came from');
    expect(node.querySelectorAll('.hm').length).toBeGreaterThan(90);
    expect(node.querySelectorAll('.feed-row').length).toBeGreaterThan(0);
    expect(node.querySelectorAll('.tile')).toHaveLength(8);
  });

  it('renders Stats for an empty document', () => {
    expect(text(renderStats(makeCtx(seedState())))).toContain('No history yet');
  });

  it('renders Settings with backup, preferences and reset', () => {
    const node = renderSettings(makeCtx());
    const body = text(node);
    expect(body).toContain('Backup & sync');
    expect(body).toContain('Export JSON');
    expect(body).toContain('Week starts on');
    expect(body).toContain('Erase all data');
    expect(node.querySelector('input[type=file]')).toBeTruthy();
  });
});

describe('form dispatching', () => {
  function submit(form) {
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: false }));
  }

  /** Setting .checked by hand does not fire change, and the schedule picker
   *  mounts its extra controls in response to change — so do both. */
  function choose(form, selector) {
    const input = form.querySelector(selector);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input;
  }

  it('adds a habit with the chosen schedule and difficulty', () => {
    const ctx = makeCtx();
    const form = habitForm(ctx, null);
    form.title.value = 'Meditate';
    choose(form, 'input[name="scheduleKind"][value="weekly"]');
    form.weeklyTarget.value = '4';
    choose(form, 'input[name="difficulty"][value="hard"]');
    submit(form);

    expect(ctx.dispatched).toHaveLength(1);
    expect(ctx.dispatched[0].type).toBe('habit/add');
    expect(ctx.dispatched[0].habit.title).toBe('Meditate');
    expect(ctx.dispatched[0].habit.difficulty).toBe('hard');
    expect(ctx.dispatched[0].habit.schedule).toEqual({ kind: 'weekly', target: 4 });
    expect(ctx.opened).toContain(['close']);
  });

  it('reads a weekday schedule out of the day toggles', () => {
    const ctx = makeCtx();
    const form = habitForm(ctx, null);
    form.title.value = 'Gym';
    choose(form, 'input[name="scheduleKind"][value="days"]');
    for (const box of form.querySelectorAll('input[name="weekday"]')) box.checked = false;
    choose(form, 'input[name="weekday"][value="2"]');
    choose(form, 'input[name="weekday"][value="4"]');
    submit(form);
    expect(ctx.dispatched[0].habit.schedule).toEqual({ kind: 'days', days: [2, 4] });
  });

  it('edits an existing habit instead of adding one', () => {
    const ctx = makeCtx();
    const form = habitForm(ctx, ctx.state.habits.h1);
    form.title.value = 'Read more';
    submit(form);
    expect(ctx.dispatched[0]).toEqual({ type: 'habit/update', id: 'h1', patch: ctx.dispatched[0].patch });
    expect(ctx.dispatched[0].patch.title).toBe('Read more');
  });

  it('mounts the weekly target control only once that mode is chosen', () => {
    const ctx = makeCtx();
    const form = habitForm(ctx, null);
    expect(form.weeklyTarget).toBeUndefined();
    choose(form, 'input[name="scheduleKind"][value="weekly"]');
    expect(form.weeklyTarget).toBeTruthy();
    choose(form, 'input[name="scheduleKind"][value="daily"]');
    form.title.value = 'Plain habit';
    submit(form);
    expect(ctx.dispatched[0].habit.schedule).toEqual({ kind: 'daily' });
  });

  it('adds a task with a due date and a project link', () => {
    const ctx = makeCtx();
    const form = todoForm(ctx, null, { due: TODAY });
    form.title.value = 'File taxes';
    form.due.value = '2026-02-01';
    form.projectId.value = 'p1';
    submit(form);
    expect(ctx.dispatched[0].type).toBe('todo/add');
    expect(ctx.dispatched[0].todo.due).toBe('2026-02-01');
    expect(ctx.dispatched[0].todo.projectId).toBe('p1');
  });

  it('falls back to a placeholder title rather than saving nothing', () => {
    const ctx = makeCtx();
    const form = todoForm(ctx, null, {});
    form.title.value = '   ';
    submit(form);
    expect(ctx.dispatched[0].todo.title).toBe('Untitled task');
  });

  it('adds a project and a milestone bound to it', () => {
    const ctx = makeCtx();
    const projectFormNode = projectForm(ctx, null);
    projectFormNode.title.value = 'Marathon';
    choose(projectFormNode, 'input[name="color"][value="emerald"]');
    submit(projectFormNode);
    expect(ctx.dispatched[0].project).toEqual({ title: 'Marathon', notes: '', color: 'emerald' });

    const milestoneNode = milestoneForm(ctx, 'p1', null);
    milestoneNode.title.value = 'Run 10k';
    submit(milestoneNode);
    expect(ctx.dispatched[1].type).toBe('milestone/add');
    expect(ctx.dispatched[1].milestone.projectId).toBe('p1');
    expect(ctx.dispatched[1].milestone.difficulty).toBe('hard');
  });
});
