// Modal editors. Each builds a <form> that dispatches one action and closes.

import { h, icon, ICONS } from './dom.js';
import { button, difficultyPicker, field, readSchedule, schedulePicker, textInput } from './components.js';
import { liveValues } from '../core/selectors.js';

function actions(ctx, { onDelete, deleteLabel, submitLabel }) {
  return h('div.form-actions', {},
    onDelete ? h('button.btn.btn-ghost.btn-danger', {
      type: 'button',
      onclick: () => {
        if (confirm(deleteLabel)) { onDelete(); ctx.closeModal(); }
      },
    }, icon(ICONS.trash, 15), h('span', { text: 'Delete' })) : null,
    h('div.spacer'),
    button('Cancel', { variant: 'ghost', onClick: () => ctx.closeModal() }),
    h('button.btn.btn-primary', { type: 'submit' }, h('span', { text: submitLabel })));
}

export function habitForm(ctx, habit) {
  const editing = Boolean(habit);
  const model = habit || { title: '', notes: '', difficulty: 'easy', schedule: { kind: 'daily' } };

  const form = h('form.form', {
    onsubmit: (event) => {
      event.preventDefault();
      const patch = {
        title: form.title.value.trim() || 'Untitled habit',
        notes: form.notes.value.trim(),
        difficulty: form.difficulty.value,
        schedule: readSchedule(form),
      };
      if (!patch.title) return;
      ctx.store.dispatch(editing
        ? { type: 'habit/update', id: habit.id, patch }
        : { type: 'habit/add', habit: patch });
      ctx.closeModal();
    },
  },
  field('Habit', textInput('title', model.title, { placeholder: 'Read for 20 minutes', required: true })),
  field('Schedule', schedulePicker(model.schedule)),
  field('Difficulty', difficultyPicker('difficulty', model.difficulty), 'Sets the XP each completion is worth.'),
  field('Notes', textInput('notes', model.notes, { placeholder: 'Optional' })),
  editing ? h('p.form-note', { text: 'Editing a habit never changes XP you have already earned.' }) : null,
  actions(ctx, {
    submitLabel: editing ? 'Save habit' : 'Add habit',
    onDelete: editing ? () => ctx.store.dispatch({ type: 'habit/remove', id: habit.id }) : null,
    deleteLabel: `Delete "${model.title}"? Your earned XP and history stay.`,
  }));
  return form;
}

export function todoForm(ctx, todo, defaults = {}) {
  const editing = Boolean(todo);
  const model = todo || { title: '', notes: '', difficulty: 'easy', due: defaults.due || '', projectId: defaults.projectId || '' };
  const projects = liveValues(ctx.state.projects).filter((project) => !project.archived);

  const form = h('form.form', {
    onsubmit: (event) => {
      event.preventDefault();
      const patch = {
        title: form.title.value.trim() || 'Untitled task',
        notes: form.notes.value.trim(),
        difficulty: form.difficulty.value,
        due: form.due.value || null,
        projectId: form.projectId.value || null,
      };
      ctx.store.dispatch(editing
        ? { type: 'todo/update', id: todo.id, patch }
        : { type: 'todo/add', todo: patch });
      ctx.closeModal();
    },
  },
  field('Task', textInput('title', model.title, { placeholder: 'Renew passport', required: true })),
  field('Due', textInput('due', model.due, { type: 'date' }), 'Finishing on or before the due date pays a 25% bonus.'),
  field('Difficulty', difficultyPicker('difficulty', model.difficulty)),
  field('Project', h('select.input', { name: 'projectId' },
    h('option', { value: '', text: 'None' }),
    projects.map((project) => h('option', {
      value: project.id, text: project.title, selected: project.id === model.projectId || null,
    })))),
  field('Notes', textInput('notes', model.notes, { placeholder: 'Optional' })),
  actions(ctx, {
    submitLabel: editing ? 'Save task' : 'Add task',
    onDelete: editing ? () => ctx.store.dispatch({ type: 'todo/remove', id: todo.id }) : null,
    deleteLabel: `Delete "${model.title}"?`,
  }));
  return form;
}

export function projectForm(ctx, project) {
  const editing = Boolean(project);
  const model = project || { title: '', notes: '', color: 'violet' };
  const colors = ['violet', 'cyan', 'amber', 'rose', 'emerald'];

  const form = h('form.form', {
    onsubmit: (event) => {
      event.preventDefault();
      const patch = {
        title: form.title.value.trim() || 'Untitled project',
        notes: form.notes.value.trim(),
        color: form.color.value,
      };
      ctx.store.dispatch(editing
        ? { type: 'project/update', id: project.id, patch }
        : { type: 'project/add', project: patch });
      ctx.closeModal();
    },
  },
  field('Project', textInput('title', model.title, { placeholder: 'Ship the side project', required: true })),
  field('Colour', h('div.colorpick', {}, colors.map((color) => h(`label.swatch.sw-${color}`, {},
    h('input', { type: 'radio', name: 'color', value: color, checked: color === model.color || null }),
    h('span'))))),
  field('Notes', textInput('notes', model.notes, { placeholder: 'Optional' })),
  actions(ctx, {
    submitLabel: editing ? 'Save project' : 'Add project',
    onDelete: editing ? () => ctx.store.dispatch({ type: 'project/remove', id: project.id }) : null,
    deleteLabel: `Delete "${model.title}" and its milestones? Earned XP stays.`,
  }));
  return form;
}

export function milestoneForm(ctx, projectId, milestone) {
  const editing = Boolean(milestone);
  const model = milestone || { title: '', notes: '', difficulty: 'hard', due: '' };

  const form = h('form.form', {
    onsubmit: (event) => {
      event.preventDefault();
      const patch = {
        title: form.title.value.trim() || 'Untitled milestone',
        notes: form.notes.value.trim(),
        difficulty: form.difficulty.value,
        due: form.due.value || null,
      };
      ctx.store.dispatch(editing
        ? { type: 'milestone/update', id: milestone.id, patch }
        : { type: 'milestone/add', milestone: { ...patch, projectId } });
      ctx.closeModal();
    },
  },
  field('Milestone', textInput('title', model.title, { placeholder: 'Core engine done', required: true })),
  field('Target date', textInput('due', model.due, { type: 'date' })),
  field('Difficulty', difficultyPicker('difficulty', model.difficulty), 'Milestones pay triple the base XP.'),
  field('Notes', textInput('notes', model.notes, { placeholder: 'Optional' })),
  actions(ctx, {
    submitLabel: editing ? 'Save milestone' : 'Add milestone',
    onDelete: editing ? () => ctx.store.dispatch({ type: 'milestone/remove', id: milestone.id }) : null,
    deleteLabel: `Delete "${model.title}"?`,
  }));
  return form;
}
