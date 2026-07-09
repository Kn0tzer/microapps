let tasks = [];
let currentTaskId = null;

let taskList, completedList, addButton, sidebar, overlay, closeSidebarBtn;
let sidebarTitle, taskDescription, completedHeader, settingsIcon;
let settingsOverlay, addSubtaskButton, subtasksList;
let signInBtn, signOutBtn, userIdDisplay, toggleUserId;
let mobileTaskModal, mobileTaskInput, mobileTaskSubmit;
let sidebarResizeHandle;
let taskListInner;

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;

const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M6 4V2H10V4M5 7V13M8 7V13M11 7V13M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let _longPressTimer = null;
let _isReordering = false;
let _reorderTaskId = null;
let _animationInProgress = false;

let Sync = null;

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 1000;
const SUBTASK_TITLE_MAX_LENGTH = 200;

const OWNER_USER_ID = 'ps_901bade06281849d45bb4abf2a47599aa38ef34fd7e9101e8427fbc1a7c71828';

function canEdit() {
  return Auth.isAuthenticated() && Auth.getUserId() === OWNER_USER_ID;
}

function showToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '5rem', left: '50%', transform: 'translateX(-50%)',
    background: '#222', color: '#e0e0e0', padding: '0.75rem 1.5rem',
    borderRadius: '8px', zIndex: '2000', fontSize: '0.9rem',
    transition: 'opacity 0.3s ease', opacity: '1', pointerEvents: 'none',
    whiteSpace: 'nowrap', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis',
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

function validateString(val, maxLen) {
  return typeof val === 'string' && val.length <= maxLen;
}

function syncMutation(changedTasks) {
  if (Sync) Sync.pushToServer(changedTasks);
}

function debouncedSyncMutation(changedTasks) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => syncMutation(changedTasks), SYNC_DEBOUNCE_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  taskList = document.getElementById('taskList');
  taskListInner = taskList.querySelector('.task-list-inner');
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
  userIdDisplay = document.getElementById('userIdDisplay');
  toggleUserId = document.getElementById('toggleUserId');
  mobileTaskModal = document.getElementById('mobileTaskModal');
  mobileTaskInput = document.getElementById('mobileTaskInput');
  mobileTaskSubmit = document.getElementById('mobileTaskSubmit');
  sidebarResizeHandle = document.getElementById('sidebarResizeHandle');

  loadTasks();
  renderTasks();
  attachEventListeners();

  completedList.classList.add('collapsed');

  fetchPublicPlans().then(() => {
    renderTasks();
    if (canEdit()) {
      setupOwnerSync();
    }
  });

  Auth.onAuthChange((state) => {
    if (state === 'signed_in') {
      fetchPublicPlans().then(() => {
        renderTasks();
        if (canEdit()) {
          setupOwnerSync();
        }
      });
      updateAuthUI();
    } else {
      updateAuthUI();
    }
  });
  updateAuthUI();

  let resizeRafPending = false;
  window.addEventListener('resize', () => {
    if (!resizeRafPending) {
      resizeRafPending = true;
      requestAnimationFrame(() => {
        resizeRafPending = false;
        animateTaskListCentering();
        updateCompletedHeight();
      });
    }
  });

  initSidebarResize();

  taskList.addEventListener('click', (e) => {
    if (sidebar.classList.contains('open') && !e.target.closest('.task-title') && !isTextSelected()) {
      closeSidebarPanel();
    }
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
  });
  sidebarTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  signInBtn.addEventListener('click', () => Auth.signIn());
  signOutBtn.addEventListener('click', () => {
    signOutBtn.textContent = 'sign out successful';
    signOutBtn.disabled = true;
    Auth.signOut();
    setTimeout(() => {
      signOutBtn.textContent = 'sign out';
      signOutBtn.disabled = false;
      updateAuthUI();
    }, 3000);
  });

  toggleUserId.addEventListener('click', () => {
    if (userIdDisplay.style.display === 'none') {
      userIdDisplay.style.display = 'block';
      toggleUserId.textContent = 'hide userId';
    } else {
      userIdDisplay.style.display = 'none';
      toggleUserId.textContent = 'show userId';
    }
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
  cb.addEventListener('click', (e) => e.stopPropagation());
  if (!canEdit()) cb.disabled = true;
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
  if (!canEdit()) btn.style.display = 'none';
  return btn;
}

function animateAndRun(el, fn) {
  _animationInProgress = true;
  el.classList.add('removing');
  el.addEventListener('animationend', () => {
    _animationInProgress = false;
    fn();
  }, { once: true });
}

function isTextSelected() {
  const sel = window.getSelection();
  return sel && sel.toString().length > 0;
}

function initSidebarResize() {
  let isResizing = false;

  const onResize = (e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= 200 && newWidth <= window.innerWidth - 200) {
      sidebar.style.width = newWidth + 'px';
    }
  };

  const onUp = () => {
    if (isResizing) {
      isResizing = false;
      sidebarResizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', onUp);
    }
  };

  sidebarResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    sidebarResizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

function handleAddButton() {
  if (!canEdit()) return;
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

function generateId() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  let id = '';
  for (let i = 0; i < arr.length; i++) {
    id += arr[i].toString(36).padStart(2, '0');
  }
  return id + Date.now().toString(36);
}

function addTask(title) {
  if (!canEdit()) return;
  const task = {
    id: generateId(),
    created_at: Date.now(),
    title: title ? (validateString(title, TITLE_MAX_LENGTH) ? title : title.slice(0, TITLE_MAX_LENGTH)) : '',
    completed: false,
    description: '',
    subtasks: [],
    order: tasks.length,
    updated_at: Date.now(),
    deleted: false,
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
  if (!canEdit()) return;
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!el) return;
  animateAndRun(el, () => {
    const task = findTask(taskId);
    if (task) {
      task.deleted = true;
      task.updated_at = Date.now();
      syncMutation([task]);
    }
    if (currentTaskId === taskId) closeSidebarPanel();
    saveTasks();
    renderTasks();
  });
}

function toggleTaskComplete(taskId) {
  if (!canEdit()) return;
  const el = document.querySelector(`[data-task-id="${taskId}"]`);
  const task = findTask(taskId);
  if (!task) return;
  if (!el) {
    task.completed = !task.completed;
    task.updated_at = Date.now();
    saveTasks();
    syncMutation([task]);
    renderTasks();
    return;
  }
  animateAndRun(el, () => {
    task.completed = !task.completed;
    task.updated_at = Date.now();
    saveTasks();
    syncMutation([task]);
    renderTasks();
  });
}

function createTitleInput(value, placeholder, onInput, extra) {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'task-title';
  el.value = value;
  el.placeholder = placeholder;
  el.autocomplete = 'off';
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  if (extra && extra.readOnly) el.readOnly = true;
  if (extra && extra.onClick) el.addEventListener('click', extra.onClick);
  if (extra && extra.cursor) el.style.cursor = extra.cursor;
  return el;
}

function updateTaskTitle(taskId, title) {
  if (!canEdit()) return;
  const task = findTask(taskId);
  if (!task) return;
  if (!validateString(title, TITLE_MAX_LENGTH)) title = title.slice(0, TITLE_MAX_LENGTH);
  task.title = title;
  task.updated_at = Date.now();
  saveTasks();
  debouncedSyncMutation([task]);
  if (currentTaskId === taskId) sidebarTitle.value = title;
}

function updateTaskDescription() {
  if (!canEdit()) return;
  const task = findTask(currentTaskId);
  if (!task) return;
  if (!validateString(taskDescription.value, DESCRIPTION_MAX_LENGTH)) {
    taskDescription.value = taskDescription.value.slice(0, DESCRIPTION_MAX_LENGTH);
  }
  task.description = taskDescription.value;
  task.updated_at = Date.now();
  saveTasks();
  debouncedSyncMutation([task]);
}

function openTaskSidebar(taskId) {
  const task = findTask(taskId);
  if (!task) return;
  currentTaskId = taskId;
  sidebarTitle.value = task.title || '';
  sidebarTitle.readOnly = !canEdit();
  taskDescription.value = task.description || '';
  taskDescription.readOnly = !canEdit();
  renderSubtasks();
  sidebar.classList.add('open');
}

function closeSidebarPanel() {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
  currentTaskId = null;
}

function addSubtask() {
  if (!canEdit()) return;
  const task = findTask(currentTaskId);
  if (!task) return;
  const subtask = { id: generateId(), title: '', completed: false };
  task.subtasks.push(subtask);
  task.updated_at = Date.now();
  saveTasks();
  syncMutation([task]);
  renderSubtasks();
  updateParentTaskCounter(task.id);
  setTimeout(() => {
    const el = document.querySelector(`[data-subtask-id="${subtask.id}"] .task-title`);
    if (el) el.focus();
  }, 50);
}

function createSubtaskItem(task, subtask) {
  const item = document.createElement('div');
  item.className = 'task-item';
  item.dataset.subtaskId = subtask.id;

  item.appendChild(createCheckbox(subtask.completed, () => toggleSubtaskComplete(task.id, subtask.id)));

  item.appendChild(createTitleInput(subtask.title, 'subtask',
    (e) => updateSubtaskTitle(task.id, subtask.id, e.target.value),
    { readOnly: !canEdit(), cursor: !canEdit() ? 'default' : undefined }
  ));

  item.appendChild(createDeleteButton(() => deleteSubtask(task.id, subtask.id)));
  return item;
}

function renderSubtasks() {
  const task = findTask(currentTaskId);
  if (!task) return;
  subtasksList.innerHTML = '';

  (task.subtasks || []).forEach(subtask => {
    subtasksList.appendChild(createSubtaskItem(task, subtask));
  });

  addSubtaskButton.style.display = canEdit() ? '' : 'none';
}

function toggleSubtaskComplete(taskId, subtaskId) {
  if (!canEdit()) return;
  const task = findTask(taskId);
  if (!task) return;
  const st = task.subtasks.find(s => s.id === subtaskId);
  if (!st) return;
  st.completed = !st.completed;
  task.updated_at = Date.now();
  saveTasks();
  syncMutation([task]);
  renderSubtasks();
  updateParentTaskCounter(taskId);
}

function updateSubtaskTitle(taskId, subtaskId, title) {
  if (!canEdit()) return;
  const task = findTask(taskId);
  if (!task) return;
  const st = task.subtasks.find(s => s.id === subtaskId);
  if (!st) return;
  if (!validateString(title, SUBTASK_TITLE_MAX_LENGTH)) title = title.slice(0, SUBTASK_TITLE_MAX_LENGTH);
  st.title = title;
  task.updated_at = Date.now();
  saveTasks();
  debouncedSyncMutation([task]);
}

function deleteSubtask(taskId, subtaskId) {
  if (!canEdit()) return;
  const task = findTask(taskId);
  if (!task) return;
  task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
  task.updated_at = Date.now();
  saveTasks();
  syncMutation([task]);
  renderSubtasks();
  updateParentTaskCounter(taskId);
}

function toggleCompleted() {
  completedHeader.classList.toggle('collapsed');
  const section = document.querySelector('.completed-section');
  section.classList.toggle('expanded');
  completedList.classList.toggle('collapsed');

  if (section.classList.contains('expanded')) {
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
  if (Auth.isAuthenticated()) {
    signInBtn.style.display = 'none';
    signOutBtn.style.display = 'block';
    toggleUserId.style.display = 'block';
    if (userIdDisplay) {
      userIdDisplay.textContent = 'userId: ' + Auth.getUserId();
    }
  } else {
    signInBtn.style.display = 'block';
    signOutBtn.style.display = 'none';
    toggleUserId.style.display = 'none';
    if (userIdDisplay) userIdDisplay.style.display = 'none';
  }
}

function updateParentTaskCounter(taskId) {
  const item = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!item) return;
  const task = findTask(taskId);
  if (!task) return;
  const subtasks = task.subtasks || [];
  const existing = item.querySelector('.subtask-counter');
  if (subtasks.length > 0) {
    const done = subtasks.filter(s => s.completed).length;
    if (existing) {
      existing.textContent = `${done}/${subtasks.length}`;
    } else {
      const counter = document.createElement('div');
      counter.className = 'subtask-counter';
      counter.textContent = `${done}/${subtasks.length}`;
      item.appendChild(counter);
    }
  } else if (existing) {
    existing.remove();
  }
}

function renderTasks() {
  const inner = taskListInner;
  const active = tasks.filter(t => !t.completed && !t.deleted)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = tasks.filter(t => t.completed && !t.deleted)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 10);

  const activeIds = new Set(active.map(t => t.id));
  let cur = inner.firstElementChild;
  while (cur) {
    const next = cur.nextElementSibling;
    if (!activeIds.has(cur.dataset.taskId)) {
      cur.remove();
    }
    cur = next;
  }
  let prev = null;
  active.forEach(t => {
    let el = inner.querySelector(`[data-task-id="${t.id}"]`);
    if (!el) {
      el = createTaskElement(t);
      if (prev && prev.nextElementSibling) {
        inner.insertBefore(el, prev.nextElementSibling);
      } else {
        inner.appendChild(el);
      }
    } else if (prev && el !== prev.nextElementSibling) {
      inner.insertBefore(el, prev.nextElementSibling);
    }
    prev = el;
  });

  completedList.innerHTML = '';
  done.forEach(t => completedList.appendChild(createTaskElement(t)));

  const completedSection = document.querySelector('.completed-section');
  if (done.length === 0) {
    completedHeader.style.display = 'none';
    if (completedSection) completedSection.style.display = 'none';
  } else {
    completedHeader.style.display = 'flex';
    if (completedSection) completedSection.style.display = 'flex';
  }

  addButton.style.display = canEdit() ? '' : 'none';
  if (addSubtaskButton) addSubtaskButton.style.display = canEdit() ? '' : 'none';

  animateTaskListCentering();
  updateCompletedHeight();
  refreshOpenSidebarIfStale();
}

function refreshOpenSidebarIfStale() {
  if (currentTaskId === null) return;
  const task = findTask(currentTaskId);
  if (!task) {
    closeSidebarPanel();
    return;
  }
  if (document.activeElement === sidebarTitle || document.activeElement === taskDescription) return;
  const title = task.title || '';
  const description = task.description || '';
  if (sidebarTitle.value === title && taskDescription.value === description) return;
  sidebarTitle.value = title;
  sidebarTitle.readOnly = !canEdit();
  taskDescription.value = description;
  taskDescription.readOnly = !canEdit();
  renderSubtasks();
}

function animateTaskListCentering() {
  const inner = taskListInner;
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
  const taskH = isMobile ? 60 : 56;
  const maxH = window.innerHeight * (isMobile ? 0.9 : 0.85);
  section.style.height = Math.min(headerH + done.length * taskH, maxH) + 'px';
}

function initDragAndDrop(item, task) {
  if (!canEdit()) return;
  item.draggable = true;

  item.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('task-title') || isTextSelected() || (document.activeElement && document.activeElement.classList.contains('task-title'))) {
      e.preventDefault();
      return;
    }
    item.classList.add('dragging');
    document.body.classList.add('dragging-in-progress');
    document.body.style.cursor = 'move';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.body.classList.remove('dragging-in-progress');
    document.body.style.cursor = '';
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = document.querySelector('.dragging');
    if (!dragging || dragging === item) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      taskListInner.insertBefore(dragging, item);
    } else {
      taskListInner.insertBefore(dragging, item.nextElementSibling);
    }
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    saveDragOrder();
  });
}

function initMobileReorder(item, task) {
  if (!canEdit()) return;
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
    if (isTextSelected()) return;
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
    if (isTextSelected()) return;
    if (!_isReordering || _reorderTaskId !== task.id) {
      clearTimeout(_longPressTimer);
      return;
    }
    e.preventDefault();
    const deltaY = e.touches[0].clientY - startY;
    item.style.transform = `translateY(${deltaY}px)`;

    const items = [...taskListInner.querySelectorAll('.task-item:not(.reordering)')];
    const rect = item.getBoundingClientRect();
    const itemMidY = rect.top + rect.height / 2;

    let closest = null;
    let closestDist = Infinity;
    for (const other of items) {
      const otherMidY = other.getBoundingClientRect().top + other.getBoundingClientRect().height / 2;
      const dist = Math.abs(itemMidY - otherMidY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = other;
      }
    }
    if (closest && closestDist > 4) {
      const closestMidY = closest.getBoundingClientRect().top + closest.getBoundingClientRect().height / 2;
      if (itemMidY < closestMidY) {
        taskListInner.insertBefore(item, closest);
      } else {
        taskListInner.insertBefore(item, closest.nextElementSibling);
      }
    }
  }, { passive: false });

  titleInput.addEventListener('touchend', () => {
    if (isTextSelected()) return;
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderTaskId === task.id) {
      resetReorder();
      saveDragOrder();
    }
  });

  titleInput.addEventListener('touchcancel', () => {
    if (isTextSelected()) return;
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderTaskId === task.id) resetReorder();
  });
}

function saveDragOrder() {
  if (!canEdit()) return;
  const items = taskListInner.querySelectorAll('.task-item');
  const taskMap = {};
  tasks.forEach(t => { taskMap[t.id] = t; });
  const changed = [];
  items.forEach((item, index) => {
    const task = taskMap[item.dataset.taskId];
    if (task) {
      task.order = index;
      task.updated_at = Date.now();
      changed.push(task);
    }
  });
  saveTasks();
  syncMutation(changed);
}

function createTaskElement(task) {
  const item = document.createElement('div');
  item.className = 'task-item';
  item.dataset.taskId = task.id;

  if (task.created_at && Date.now() - task.created_at < 1000) item.classList.add('adding');

  item.appendChild(createCheckbox(task.completed, () => toggleTaskComplete(task.id)));

  const title = createTitleInput(task.title, 'plan title',
    (e) => updateTaskTitle(task.id, e.target.value),
    {
      readOnly: (window.innerWidth <= 768 && !task.completed) || !canEdit(),
      onClick: (e) => { if (!_isReordering && !isTextSelected() && !task.completed) openTaskSidebar(task.id); },
      cursor: !canEdit() ? 'default' : undefined,
    }
  );
  item.appendChild(title);

  const subtasks = task.subtasks || [];
  if (subtasks.length > 0) {
    const counter = document.createElement('div');
    counter.className = 'subtask-counter';
    const done = subtasks.filter(s => s.completed).length;
    counter.textContent = `${done}/${subtasks.length}`;
    item.appendChild(counter);
  }

  if (!task.completed) {
    item.addEventListener('click', (e) => {
      if (!_isReordering && !isTextSelected() && e.target !== title) openTaskSidebar(task.id);
    });
  }

  if (task.completed) {
    item.appendChild(createDeleteButton((e) => {
      e.stopPropagation();
      deleteTask(task.id);
    }));
  }

  if (!task.completed) {
    initDragAndDrop(item, task);
    initMobileReorder(item, task);
  }

  return item;
}

function saveTasks() {
  try {
    localStorage.setItem('plans', JSON.stringify(tasks));
  } catch (e) {
    console.warn('saveTasks failed:', e);
    showToast('Failed to save — storage may be full');
  }
}

function loadTasks() {
  try {
    const raw = localStorage.getItem('plans');
    if (raw && raw.length > 10000000) { tasks = []; return; }
    const parsed = raw ? JSON.parse(raw) : [];
    tasks = Array.isArray(parsed) ? parsed.map(t => ({
      ...t,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
      deleted: t.deleted ?? false,
    })) : [];
  } catch (e) {
    console.warn('loadTasks failed:', e);
    tasks = [];
  }
}

async function fetchPublicPlans() {
  try {
    const res = await fetch('/api/plans/public');
    if (!res.ok) return;
    const data = await res.json();
    if (data.plans && Array.isArray(data.plans)) {
      tasks = data.plans.map(p => ({
        id: p.id,
        created_at: p.updated_at,
        title: p.title || '',
        completed: p.completed || false,
        description: p.description || '',
        subtasks: Array.isArray(p.subtasks) ? p.subtasks.map(s => ({
          id: Number(s.id) || s.id,
          title: s.title || '',
          completed: s.completed || false,
        })) : [],
        order: p.order ?? 0,
        updated_at: p.updated_at || Date.now(),
        deleted: p.deleted || false,
      }));
      saveTasks();
    }
  } catch {}
}

function setupOwnerSync() {
  if (Sync) return;
  Sync = SyncFactory.create({
    endpoint: 'plans',
    storageKey: 'plans',
    maxItems: null,
    getItems: () => tasks,
    setItems: (v) => { tasks = v; },
    buildPayload: (t) => ({
      title: t.title || '',
      description: t.description || '',
      completed: t.completed || false,
      subtasks: (t.subtasks || []).map(s => ({ id: s.id, title: s.title || '', completed: s.completed || false })),
    }),
    toLocal: (s) => ({
      title: s.title || '',
      description: s.description || '',
      completed: s.completed || false,
      subtasks: (s.subtasks || []).map(s => ({ id: Number(s.id) || s.id, title: s.title || '', completed: s.completed || false })),
    }),
    render: () => { if (!_animationInProgress) renderTasks(); },
  });
  Sync.init();
}

function findTask(id) {
  return tasks.find(t => t.id === id);
}
