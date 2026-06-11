let tasks = [];
let currentTaskId = null;

let taskList, completedList, addButton, sidebar, overlay, closeSidebarBtn;
let sidebarTitle, taskDescription, completedHeader, settingsIcon;
let settingsOverlay, addSubtaskButton, subtasksList;
let signInBtn, signOutBtn;
let mobileTaskModal, mobileTaskInput, mobileTaskSubmit;
let _signingOut = false;

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;

let _draggedTask = null;
let _draggedEl = null;
let _dragPlaceholder = null;
let _longPressTimer = null;
let _isReordering = false;
let _reorderTaskId = null;

const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M6 4V2H10V4M5 7V13M8 7V13M11 7V13M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
  addSubtaskButton = document.getElementById('addSubtaskButton');
  subtasksList = document.getElementById('subtasksList');
  signInBtn = document.getElementById('signInBtn');
  signOutBtn = document.getElementById('signOutBtn');
  mobileTaskModal = document.getElementById('mobileTaskModal');
  mobileTaskInput = document.getElementById('mobileTaskInput');
  mobileTaskSubmit = document.getElementById('mobileTaskSubmit');

  loadTasks();
  renderTasks();
  attachEventListeners();

  completedHeader.classList.add('collapsed');
  completedList.classList.add('collapsed');

  Sync = SyncFactory.create({
    endpoint: 'tasks',
    storageKey: 'tasks',
    maxItems: 10,
    getItems: () => tasks,
    setItems: (v) => { tasks = v; },
    buildPayload: (t) => ({
      title: t.title || '',
      description: t.description || '',
      completed: t.completed || false,
    }),
    toLocal: (s) => ({
      title: s.title || '',
      description: s.description || '',
      completed: s.completed || false,
    }),
    render: renderTasks,
  });
  Sync.init();

  updateAuthUI();
  Auth.onAuthChange(() => {
    if (!_signingOut) updateAuthUI();
  });

  window.addEventListener('resize', () => {
    requestAnimationFrame(animateTaskListCentering);
    updateCompletedHeight();
  });
});

function attachEventListeners() {
  addButton.addEventListener('click', handleAddButton);
  closeSidebarBtn.addEventListener('click', closeSidebarPanel);
  overlay.addEventListener('click', closeSettingsPanel);
  completedHeader.addEventListener('click', toggleCompleted);
  settingsIcon.addEventListener('click', openSettings);
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

  mobileTaskSubmit.addEventListener('click', submitMobileTask);
  mobileTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitMobileTask();
    if (e.key === 'Escape') closeMobileTaskModal();
  });
  mobileTaskModal.addEventListener('click', (e) => {
    if (e.target === mobileTaskModal) closeMobileTaskModal();
  });
}

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

function animateAndRun(el, fn) {
  el.classList.add('removing');
  el.addEventListener('animationend', fn, { once: true });
}

function handleAddButton() {
  if (window.innerWidth <= 768) {
    mobileTaskModal.classList.add('visible');
    mobileTaskInput.value = '';
    mobileTaskInput.focus();
  } else {
    addTask();
  }
}

function closeMobileTaskModal() {
  mobileTaskModal.classList.remove('visible');
  mobileTaskInput.blur();
}

function submitMobileTask() {
  const title = mobileTaskInput.value.trim();
  closeMobileTaskModal();
  addTask(title || null);
}

function addTask(title) {
  const task = {
    id: Date.now(),
    title: title || '',
    completed: false,
    description: '',
    subtasks: [],
    order: tasks.length,
  };
  tasks.push(task);
  saveTasks();
  syncMutation([task]);
  renderTasks();

  if (!title) {
    setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${task.id}"] .task-title`);
      if (el) el.focus();
    }, 50);
  }
}

function deleteTask(taskId) {
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!el) return;
  animateAndRun(el, () => {
    const task = findTask(taskId);
    if (task) {
      if (task.completed) {
        task.deleted = true;
      } else {
        task.completed = true;
      }
      task.updated_at = Date.now();
      syncMutation([task]);
    }
    if (currentTaskId === taskId) closeSidebarPanel();
    saveTasks();
    renderTasks();
  });
}

function toggleTaskComplete(taskId) {
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  const task = findTask(taskId);
  if (!task || !el) return;
  animateAndRun(el, () => {
    task.completed = !task.completed;
    task.updated_at = Date.now();
    saveTasks();
    syncMutation([task]);
    renderTasks();
  });
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
  if (window.innerWidth > 768) {
    setTimeout(() => sidebarTitle.focus(), 300);
  }
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
    input.autocomplete = 'off';
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
  arrow.style.transform = isMobile
    ? (expanded ? 'rotate(-180deg)' : 'rotate(-90deg)')
    : (expanded ? '' : 'rotate(-90deg)');

  if (expanded) {
    updateCompletedHeight();
  } else {
    section.style.height = '';
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

  const active = tasks.filter(t => !t.completed && !t.deleted)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = tasks.filter(t => t.completed && !t.deleted)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 10);

  active.forEach(t => inner.appendChild(createTaskElement(t)));
  completedList.innerHTML = '';
  done.forEach(t => completedList.appendChild(createTaskElement(t)));

  requestAnimationFrame(() => {
    animateTaskListCentering();
    updateCompletedHeight();
  });
}

function animateTaskListCentering() {
  const inner = taskList.querySelector('.task-list-inner');
  if (!inner) return;
  const h = taskList.clientHeight;
  const ch = inner.scrollHeight;
  const offset = ch < h ? Math.max(0, (h - ch) / 2) : 0;
  inner.style.transform = `translate(-50%, ${offset}px)`;
}

function updateCompletedHeight() {
  const section = document.querySelector('.completed-section');
  if (!section.classList.contains('expanded')) return;

  const done = tasks.filter(t => t.completed && !t.deleted);
  const isMobile = window.innerWidth <= 768;
  const headerH = isMobile ? 48 : 40;
  const taskH = isMobile ? 52 : 48;
  const maxH = window.innerHeight * (isMobile ? 0.85 : 0.5);
  section.style.height = Math.min(headerH + done.length * taskH, maxH) + 'px';
}

function initDragAndDrop(item, task) {
  item.draggable = true;

  item.addEventListener('dragstart', (e) => {
    _draggedTask = task;
    _draggedEl = item;
    item.classList.add('dragging');
    document.body.classList.add('dragging-in-progress');
    document.body.style.cursor = 'move';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.body.classList.remove('dragging-in-progress');
    document.body.style.cursor = '';
    _draggedTask = null;
    _draggedEl = null;
    if (_dragPlaceholder && _dragPlaceholder.parentNode) {
      _dragPlaceholder.remove();
    }
    _dragPlaceholder = null;
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = document.querySelector('.dragging');
    if (!dragging || dragging === item) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const inner = taskList.querySelector('.task-list-inner');
    if (e.clientY < midY) {
      inner.insertBefore(dragging, item);
    } else {
      inner.insertBefore(dragging, item.nextSibling);
    }
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    saveDragOrder();
  });
}

function initMobileReorder(item, task) {
  const titleInput = item.querySelector('.task-title');
  if (!titleInput) return;

  let startY = 0;

  const resetReorder = () => {
    item.classList.remove('reordering');
    item.style.zIndex = '';
    item.style.position = '';
    item.style.transform = '';
    _isReordering = false;
    _reorderTaskId = null;
  };

  titleInput.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    startY = e.touches[0].clientY;
    _longPressTimer = setTimeout(() => {
      _isReordering = true;
      _reorderTaskId = task.id;
      item.classList.add('reordering');
      item.style.zIndex = '100';
      item.style.position = 'relative';
      navigator.vibrate && navigator.vibrate(30);
    }, 400);
  }, { passive: true });

  titleInput.addEventListener('touchmove', (e) => {
    if (!_isReordering || _reorderTaskId !== task.id) {
      clearTimeout(_longPressTimer);
      return;
    }
    e.preventDefault();
    const deltaY = e.touches[0].clientY - startY;
    item.style.transform = `translateY(${deltaY}px)`;

    const inner = taskList.querySelector('.task-list-inner');
    const items = [...inner.querySelectorAll('.task-item:not(.reordering)')];
    const rect = item.getBoundingClientRect();
    const itemMidY = rect.top + rect.height / 2;

    for (const other of items) {
      const otherRect = other.getBoundingClientRect();
      const otherMidY = otherRect.top + otherRect.height / 2;
      if (itemMidY < otherMidY && other.previousSibling === item) {
        inner.insertBefore(item, other);
        break;
      } else if (itemMidY > otherMidY && other.nextSibling && other.nextSibling !== item) {
        inner.insertBefore(item, other.nextSibling);
        break;
      } else if (itemMidY > otherMidY && !other.nextSibling) {
        inner.appendChild(item);
        break;
      }
    }
  }, { passive: false });

  titleInput.addEventListener('touchend', () => {
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderTaskId === task.id) {
      resetReorder();
      saveDragOrder();
    }
  });

  titleInput.addEventListener('touchcancel', () => {
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderTaskId === task.id) resetReorder();
  });
}

function saveDragOrder() {
  const inner = taskList.querySelector('.task-list-inner');
  const items = inner.querySelectorAll('.task-item');
  items.forEach((item, index) => {
    const task = findTask(Number(item.dataset.taskId));
    if (task) {
      task.order = index;
      task.updated_at = Date.now();
    }
  });
  saveTasks();
  const changedTasks = [...items].map(item => findTask(Number(item.dataset.taskId))).filter(Boolean);
  syncMutation(changedTasks);
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
  title.placeholder = 'task title';
  title.autocomplete = 'off';
  if (window.innerWidth <= 768 && !task.completed) {
    title.readOnly = true;
  }
  title.addEventListener('input', (e) => {
    updateTaskTitle(task.id, e.target.value);
    if (currentTaskId === task.id) sidebarTitle.value = e.target.value;
  });
  title.addEventListener('click', () => {
    if (!_isReordering) openTaskSidebar(task.id);
  });
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

  if (!task.completed) {
    initDragAndDrop(item, task);
    initMobileReorder(item, task);
  }

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
  _syncDebounceTimer = setTimeout(() => syncMutation(changedTasks), SYNC_DEBOUNCE_MS);
}
