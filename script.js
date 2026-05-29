let tasks = [];
let currentTaskId = null;

let taskList, completedList, addButton, sidebar, overlay, closeSidebarBtn;
let sidebarTitle, taskDescription, completedHeader, settingsIcon;
let settingsOverlay, closeSettingsBtn, addSubtaskButton, subtasksList;
let signInBtn, signOutBtn;
let _signingOut = false;

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;

document.addEventListener('DOMContentLoaded', () => {
  taskList = document.getElementById('taskList');
  completedList = document.getElementById('completedList');
  addButton = document.getElementById('addButton');
  sidebar = document.getElementById('sidebar');
  overlay = document.getElementById('overlay');
  closeSidebarBtn = document.getElementById('closeSidebar');
  sidebarTitle = document.getElementById('sidebarTitle');
  taskDescription = document.getElementById('taskDescription');
  completedHeader = document.getElementById('completedHeader');
  settingsIcon = document.getElementById('settingsIcon');
  settingsOverlay = document.getElementById('settingsOverlay');
  closeSettingsBtn = document.getElementById('closeSettings');
  addSubtaskButton = document.getElementById('addSubtaskButton');
  subtasksList = document.getElementById('subtasksList');
  signInBtn = document.getElementById('signInBtn');
  signOutBtn = document.getElementById('signOutBtn');

  loadTasks();
  renderTasks();
  attachEventListeners();
  attachAuthListeners();

  completedHeader.classList.add('collapsed');
  completedList.classList.add('collapsed');

  Sync.init();

  updateAuthUI();
  Auth.onAuthChange(() => {
    if (!_signingOut) updateAuthUI();
  });

  window.addEventListener('resize', () => requestAnimationFrame(animateTaskListCentering));
});

function attachEventListeners() {
  addButton.addEventListener('click', addTask);
  closeSidebarBtn.addEventListener('click', closeSidebarPanel);
  overlay.addEventListener('click', closeSettingsPanel);
  completedHeader.addEventListener('click', toggleCompleted);
  settingsIcon.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettingsPanel);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettingsPanel();
  });
  taskDescription.addEventListener('input', updateTaskDescription);
  addSubtaskButton.addEventListener('click', addSubtask);

  sidebarTitle.addEventListener('input', (e) => {
    updateTaskTitle(currentTaskId, e.target.value);
    renderTasks();
  });
  sidebarTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });
}

function attachAuthListeners() {
  signInBtn.addEventListener('click', () => Auth.signIn());
  signOutBtn.addEventListener('click', () => {
    _signingOut = true;
    signOutBtn.textContent = 'sign out successful';
    signOutBtn.disabled = true;
    Auth.signOut();
    setTimeout(() => {
      _signingOut = false;
      signOutBtn.textContent = 'sign out';
      signOutBtn.disabled = false;
      updateAuthUI();
    }, 3000);
  });
}

const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M6 4V2H10V4M5 7V13M8 7V13M11 7V13M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function createCheckbox(checked, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'checkbox-wrapper';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', onChange);
  const custom = document.createElement('div');
  custom.className = 'checkbox-custom';
  wrapper.appendChild(cb);
  wrapper.appendChild(custom);
  return wrapper;
}

function createDeleteButton(onClick) {
  const btn = document.createElement('button');
  btn.className = 'delete-button';
  btn.innerHTML = DELETE_SVG;
  btn.addEventListener('click', onClick);
  return btn;
}

function addTask() {
  const task = { id: Date.now(), title: '', completed: false, description: '', subtasks: [] };
  tasks.push(task);
  saveTasks();
  syncMutation([task]);
  renderTasks();
  setTimeout(() => {
    const el = document.querySelector(`[data-task-id="${task.id}"] .task-title`);
    if (el) el.focus();
  }, 50);
}

function deleteTask(taskId) {
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!el) return;
  el.classList.add('removing');
  el.addEventListener('animationend', () => {
    const task = findTask(taskId);
    if (task) {
      task.deleted = true;
      task.updated_at = Date.now();
      syncMutation([task]);
    }
    tasks = tasks.filter(t => t.id !== taskId);
    if (currentTaskId === taskId) closeSidebarPanel();
    saveTasks();
    renderTasks();
  }, { once: true });
}

function toggleTaskComplete(taskId) {
  const task = findTask(taskId);
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!task || !el) return;
  el.classList.add('removing');
  el.addEventListener('animationend', () => {
    task.completed = !task.completed;
    task.updated_at = Date.now();
    saveTasks();
    syncMutation([task]);
    renderTasks();
  }, { once: true });
}

function updateTaskTitle(taskId, title) {
  const task = findTask(taskId);
  if (!task) return;
  task.title = title;
  task.updated_at = Date.now();
  saveTasks();
  debouncedSyncMutation([task]);
}

function updateTaskDescription() {
  const task = findTask(currentTaskId);
  if (!task) return;
  task.description = taskDescription.value;
  task.updated_at = Date.now();
  saveTasks();
  debouncedSyncMutation([task]);
}

function openTaskSidebar(taskId) {
  currentTaskId = taskId;
  const task = findTask(taskId);
  if (!task) return;
  sidebarTitle.value = task.title || '';
  taskDescription.value = task.description || '';
  renderSubtasks();
  sidebar.classList.add('open');
}

function closeSidebarPanel() {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
  currentTaskId = null;
}

function addSubtask() {
  const task = findTask(currentTaskId);
  if (!task) return;
  const subtask = { id: Date.now(), title: '', completed: false };
  task.subtasks.push(subtask);
  task.updated_at = Date.now();
  saveTasks();
  syncMutation([task]);
  renderSubtasks();
  renderTasks();
  setTimeout(() => {
    const el = document.querySelector(`[data-subtask-id="${subtask.id}"] .task-title`);
    if (el) el.focus();
  }, 50);
}

function renderSubtasks() {
  const task = findTask(currentTaskId);
  if (!task) return;
  subtasksList.innerHTML = '';

  task.subtasks.forEach(subtask => {
    const item = document.createElement('div');
    item.className = 'task-item';
    item.dataset.subtaskId = subtask.id;

    item.appendChild(createCheckbox(subtask.completed, () => toggleSubtaskComplete(task.id, subtask.id)));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-title';
    input.value = subtask.title;
    input.placeholder = 'subtask';
    input.addEventListener('input', (e) => updateSubtaskTitle(task.id, subtask.id, e.target.value));
    item.appendChild(input);

    item.appendChild(createDeleteButton(() => deleteSubtask(task.id, subtask.id)));
    subtasksList.appendChild(item);
  });
}

function toggleSubtaskComplete(taskId, subtaskId) {
  const task = findTask(taskId);
  if (!task) return;
  const st = task.subtasks.find(s => s.id === subtaskId);
  if (!st) return;
  st.completed = !st.completed;
  task.updated_at = Date.now();
  saveTasks();
  syncMutation([task]);
  renderSubtasks();
  renderTasks();
}

function updateSubtaskTitle(taskId, subtaskId, title) {
  const task = findTask(taskId);
  if (!task) return;
  const st = task.subtasks.find(s => s.id === subtaskId);
  if (!st) return;
  st.title = title;
  task.updated_at = Date.now();
  saveTasks();
  debouncedSyncMutation([task]);
}

function deleteSubtask(taskId, subtaskId) {
  const task = findTask(taskId);
  if (!task) return;
  task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
  task.updated_at = Date.now();
  saveTasks();
  syncMutation([task]);
  renderSubtasks();
  renderTasks();
}

function toggleCompleted() {
  const isMobile = window.innerWidth <= 768;
  completedHeader.classList.toggle('collapsed');
  const section = document.querySelector('.completed-section');
  section.classList.toggle('expanded');
  completedList.classList.toggle('collapsed');

  const arrow = completedHeader.querySelector('.arrow-icon');
  const expanded = section.classList.contains('expanded');
  if (isMobile) {
    arrow.style.transform = expanded ? 'rotate(-180deg)' : 'rotate(-90deg)';
  } else {
    arrow.style.transform = expanded ? '' : 'rotate(-90deg)';
  }
}

function openSettings() {
  settingsOverlay.classList.add('visible');
  overlay.classList.add('visible');
  updateAuthUI();
}

function closeSettingsPanel() {
  settingsOverlay.classList.remove('visible');
  overlay.classList.remove('visible');
}

function updateAuthUI() {
  if (!signInBtn || !signOutBtn) return;

  if (Auth.isAuthenticated()) {
    signInBtn.style.display = 'none';
    signOutBtn.style.display = 'block';
  } else {
    signInBtn.style.display = 'block';
    signOutBtn.style.display = 'none';
  }
}

function renderTasks() {
  const inner = taskList.querySelector('.task-list-inner');
  inner.innerHTML = '';

  const active = tasks.filter(t => !t.completed && !t.deleted);
  const done = tasks.filter(t => t.completed && !t.deleted)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 10);

  active.forEach(t => inner.appendChild(createTaskElement(t)));
  completedList.innerHTML = '';
  done.forEach(t => completedList.appendChild(createTaskElement(t)));

  requestAnimationFrame(animateTaskListCentering);
}

function animateTaskListCentering() {
  const inner = taskList.querySelector('.task-list-inner');
  if (!inner) return;
  const h = taskList.clientHeight;
  const ch = inner.scrollHeight;
  if (ch < h) {
    const offset = Math.max(0, (h - ch) / 2);
    inner.style.transform = `translate(-50%, ${offset}px)`;
  } else {
    inner.style.transform = 'translate(-50%, 0)';
  }
}

function createTaskElement(task) {
  const item = document.createElement('div');
  item.className = 'task-item';
  item.dataset.taskId = task.id;

  if (task.id > Date.now() - 1000) item.classList.add('adding');

  item.appendChild(createCheckbox(task.completed, () => toggleTaskComplete(task.id)));

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'task-title';
  title.value = task.title;
  title.placeholder = 'task name';
  title.addEventListener('input', (e) => {
    updateTaskTitle(task.id, e.target.value);
    if (currentTaskId === task.id) sidebarTitle.value = e.target.value;
  });
  title.addEventListener('click', () => openTaskSidebar(task.id));
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  item.appendChild(title);

  if (task.subtasks.length > 0) {
    const counter = document.createElement('div');
    counter.className = 'subtask-counter';
    const done = task.subtasks.filter(s => s.completed).length;
    counter.textContent = `${done}/${task.subtasks.length}`;
    item.appendChild(counter);
  }

  item.appendChild(createDeleteButton((e) => {
    e.stopPropagation();
    deleteTask(task.id);
  }));

  return item;
}

function saveTasks() {
  try { localStorage.setItem('tasks', JSON.stringify(tasks)); } catch {}
}

function loadTasks() {
  try {
    const raw = localStorage.getItem('tasks');
    tasks = raw ? JSON.parse(raw) : [];
  } catch {
    tasks = [];
  }
}

function findTask(id) {
  return tasks.find(t => t.id === id);
}

function syncMutation(changedTasks) {
  if (!Auth.isAuthenticated()) return;
  Sync.pushToServer(changedTasks);
}

function debouncedSyncMutation(changedTasks) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => {
    syncMutation(changedTasks);
    _syncDebounceTimer = null;
  }, SYNC_DEBOUNCE_MS);
}
