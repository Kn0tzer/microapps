let habits = [];
let selectedDate = '';
let progressionOffset = 0;

let habitList, addButton, settingsIcon, settingsOverlay;
let signInBtn, signOutBtn;
let mobileHabitModal, mobileHabitTitle, mobileHabitInterval, mobileHabitSubmit;
let midnightReminder;
let progressionDays, progressionPrev, progressionNext;
let overlay;
let _signingOut = false;

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;

let _draggedHabit = null;
let _draggedEl = null;
let _longPressTimer = null;
let _isReordering = false;
let _reorderHabitId = null;
let _progressionAnimating = false;
let _editingInterval = false;
let _midnightTimer = null;

const DELETE_SVG = '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M6 4V2H10V4M5 7V13M8 7V13M11 7V13M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PAUSE_SVG = '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3V13M11 3V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLAY_SVG = '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 3L13 8L4 13V3Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function todayStr() {
  return dateToStr(new Date());
}

function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function strToDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, n) {
  const d = strToDate(dateStr);
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}

function diffDays(a, b) {
  const da = strToDate(a);
  const db = strToDate(b);
  return Math.round((db - da) / 86400000);
}

function dayName(dateStr) {
  const d = strToDate(dateStr);
  return d.toLocaleDateString('en', { weekday: 'short' }).toLowerCase();
}

function dateNum(dateStr) {
  return strToDate(dateStr).getDate();
}

function getProgressionDays() {
  const today = todayStr();
  const center = addDays(today, progressionOffset);
  const days = [];
  for (let i = -2; i <= 1; i++) {
    days.push(addDays(center, i));
  }
  return days;
}

function renderProgression() {
  const today = todayStr();
  const days = getProgressionDays();

  progressionDays.innerHTML = '';

  days.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'progression-day';
    if (d === selectedDate) btn.classList.add('selected');
    if (d === today) btn.classList.add('today');

    const name = document.createElement('span');
    name.className = 'progression-day-name';
    name.textContent = dayName(d);

    const num = document.createElement('span');
    num.className = 'progression-date-num';
    num.textContent = dateNum(d);

    btn.appendChild(name);
    btn.appendChild(num);
    btn.addEventListener('click', () => {
      selectedDate = d;
      renderProgression();
      renderHabits();
    });
    progressionDays.appendChild(btn);
  });

  progressionNext.disabled = progressionOffset >= 0;

  const leftmost = addDays(today, progressionOffset - 2);
  const minStart = addDays(today, -365);
  progressionPrev.disabled = leftmost <= minStart;
}

function changeProgression(direction) {
  if (_progressionAnimating) return;
  const newOffset = progressionOffset + direction;
  const today = todayStr();
  if (direction > 0 && newOffset > 0) return;
  if (direction < 0) {
    const leftmost = addDays(today, newOffset - 2);
    if (leftmost <= addDays(today, -365)) return;
  }
  _progressionAnimating = true;
  progressionDays.style.transition = 'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.12s ease';
  progressionDays.style.transform = `translateX(${-direction * 20}px)`;
  progressionDays.style.opacity = '0';

  progressionDays.addEventListener('transitionend', function handler() {
    progressionDays.removeEventListener('transitionend', handler);
    progressionOffset = newOffset;
    const days = getProgressionDays();
    if (days.length > 0 && !days.includes(selectedDate)) {
      selectedDate = days[Math.floor(days.length / 2)];
    }
    renderProgression();
    renderHabits();
    
    progressionDays.style.transition = 'none';
    progressionDays.style.transform = `translateX(${direction * 20}px)`;
    progressionDays.style.opacity = '0';
    
    requestAnimationFrame(() => {
      progressionDays.style.transition = 'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.12s ease';
      progressionDays.style.transform = 'translateX(0)';
      progressionDays.style.opacity = '1';
      
      progressionDays.addEventListener('transitionend', function done() {
        progressionDays.removeEventListener('transitionend', done);
        progressionDays.style.transition = '';
        _progressionAnimating = false;
      }, { once: true });
    });
  }, { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
  habitList = document.getElementById('habitList');
  addButton = document.getElementById('addButton');
  settingsIcon = document.getElementById('settingsIcon');
  settingsOverlay = document.getElementById('settingsOverlay');
  signInBtn = document.getElementById('signInBtn');
  signOutBtn = document.getElementById('signOutBtn');
  mobileHabitModal = document.getElementById('mobileHabitModal');
  mobileHabitTitle = document.getElementById('mobileHabitTitle');
  mobileHabitInterval = document.getElementById('mobileHabitInterval');
  mobileHabitSubmit = document.getElementById('mobileHabitSubmit');
  midnightReminder = document.getElementById('midnightReminder');
  progressionDays = document.getElementById('progressionDays');
  progressionPrev = document.getElementById('progressionPrev');
  progressionNext = document.getElementById('progressionNext');
  overlay = document.getElementById('overlay');

  selectedDate = todayStr();

  loadHabits();
  renderProgression();
  renderHabits();
  attachEventListeners();
  checkMidnight();

  Sync = SyncFactory.create({
    endpoint: 'habits',
    storageKey: 'habits',
    maxItems: null,
    getItems: () => habits,
    setItems: (v) => { habits = v; },
    buildPayload: (h) => ({
      title: h.title || '',
      intervalDays: h.intervalDays || 1,
      lastCompletedAt: h.lastCompletedAt || null,
      completions: h.completions || [],
      paused: h.paused || false,
    }),
    toLocal: (s) => ({
      title: s.title || '',
      intervalDays: s.intervalDays || s.interval_days || 1,
      lastCompletedAt: s.lastCompletedAt || s.last_completed_at || null,
      completions: s.completions || [],
      paused: s.paused || false,
    }),
    render: renderHabits,
  });
  Sync.init();

  updateAuthUI();
  Auth.onAuthChange(() => {
    if (!_signingOut) updateAuthUI();
  });

  window.addEventListener('resize', () => {
    requestAnimationFrame(animateHabitListCentering);
  });

  _midnightTimer = setInterval(checkMidnight, 60000);
});

function attachEventListeners() {
  addButton.addEventListener('click', handleAddButton);
  settingsIcon.addEventListener('click', openSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettingsPanel();
  });
  overlay.addEventListener('click', closeSettingsPanel);

  progressionPrev.addEventListener('click', () => {
    changeProgression(-1);
  });

  progressionNext.addEventListener('click', () => {
    changeProgression(1);
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

  mobileHabitSubmit.addEventListener('click', submitMobileHabit);
  mobileHabitTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitMobileHabit();
    if (e.key === 'Escape') closeMobileHabitModal();
  });
  mobileHabitInterval.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitMobileHabit();
    if (e.key === 'Escape') closeMobileHabitModal();
  });
  mobileHabitModal.addEventListener('click', (e) => {
    if (e.target === mobileHabitModal) closeMobileHabitModal();
  });
}

function handleAddButton() {
  if (window.innerWidth <= 768) {
    mobileHabitModal.classList.add('visible');
    mobileHabitTitle.value = '';
    mobileHabitInterval.value = '';
    mobileHabitTitle.focus();
  } else {
    addHabit(null, null);
  }
}

function closeMobileHabitModal() {
  mobileHabitModal.classList.remove('visible');
  mobileHabitTitle.blur();
  mobileHabitInterval.blur();
}

function submitMobileHabit() {
  const title = mobileHabitTitle.value.trim();
  const interval = parseInt(mobileHabitInterval.value) || 1;
  closeMobileHabitModal();
  addHabit(title || null, interval);
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

function addHabit(title, intervalDays) {
  const habit = {
    id: generateId(),
    _createdAt: Date.now(),
    title: title || '',
    intervalDays: intervalDays || 1,
    lastCompletedAt: null,
    completions: [],
    paused: false,
    order: habits.length,
    updated_at: Date.now(),
    deleted: false,
  };
  habits.push(habit);
  saveHabits();
  syncMutation([habit]);
  renderHabits();

  if (!title) {
    setTimeout(() => {
      const el = document.querySelector(`[data-habit-id="${habit.id}"] .habit-title`);
      if (el) el.focus();
    }, 50);
  }
}

function deleteHabit(habitId) {
  const el = document.querySelector(`[data-habit-id="${habitId}"]`);
  if (!el) return;

  el.classList.add('removing');
  el.addEventListener('animationend', () => {
    const habit = findHabit(habitId);
    if (habit) {
      habit.deleted = true;
      habit.updated_at = Date.now();
      syncMutation([habit]);
    }
    saveHabits();
    renderHabits();
  }, { once: true });
}

function toggleComplete(habitId, date) {
  const habit = findHabit(habitId);
  if (!habit) return;

  const dateObj = strToDate(date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today - dateObj) / 86400000);
  if (diffDays < -2 || diffDays > 21) return;

  const existing = habit.completions.findIndex(c => c.date === date);
  if (existing >= 0) {
    habit.completions.splice(existing, 1);
  } else {
    habit.completions.push({ date });
    habit.completions.sort((a, b) => a.date.localeCompare(b.date));
  }

  const sorted = habit.completions.filter(c => c.date <= todayStr());
  habit.lastCompletedAt = sorted.length > 0
    ? strToDate(sorted[sorted.length - 1].date).getTime()
    : null;

  habit.updated_at = Date.now();
  saveHabits();
  syncMutation([habit]);
  renderHabits();
}

function pauseHabit(habitId) {
  const habit = findHabit(habitId);
  if (!habit) return;
  habit.paused = !habit.paused;
  habit.updated_at = Date.now();
  saveHabits();
  syncMutation([habit]);
  renderHabits();
}

function updateTitle(habitId, title) {
  const habit = findHabit(habitId);
  if (!habit) return;
  habit.title = title;
  habit.updated_at = Date.now();
  saveHabits();
  debouncedSyncMutation([habit]);
}

function updateInterval(habitId, days) {
  const habit = findHabit(habitId);
  if (!habit) return;
  const parsed = parseInt(days);
  if (isNaN(parsed) || parsed < 1) return;
  habit.intervalDays = parsed;
  habit.updated_at = Date.now();
  saveHabits();
  syncMutation([habit]);
}

function isCompletedOn(habit, date) {
  return (habit.completions || []).some(c => c.date === date);
}

function isHabitDueOn(habit, date) {
  if (habit.paused) return false;
  if (habit.intervalDays <= 1) return true;
  if (!habit.lastCompletedAt) return true;

  const lastDate = dateToStr(new Date(habit.lastCompletedAt));
  if (date < lastDate) return true;

  const diff = diffDays(lastDate, date);
  return diff % habit.intervalDays === 0;
}

function renderHabits() {
  const inner = habitList.querySelector('.habit-list-inner');
  inner.innerHTML = '';

  const active = habits
    .filter(h => !h.deleted && isHabitDueOn(h, selectedDate))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  active.forEach(h => inner.appendChild(createHabitElement(h)));

  requestAnimationFrame(animateHabitListCentering);
}

function createHabitElement(habit) {
  const item = document.createElement('div');
  item.className = 'habit-item';
  item.dataset.habitId = habit.id;

  if (habit.paused) item.classList.add('paused');
  if (habit._createdAt && Date.now() - habit._createdAt < 1000) item.classList.add('adding');

  const content = document.createElement('div');
  content.className = 'habit-item-content';

  const completed = isCompletedOn(habit, selectedDate);

  content.appendChild(createCheckbox(completed, () => toggleComplete(habit.id, selectedDate)));

  const titleWrap = document.createElement('div');
  titleWrap.className = 'habit-title-wrap';

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'habit-title';
  title.value = habit.title;
  title.placeholder = 'habit title';
  title.autocomplete = 'off';
  if (window.innerWidth <= 768) {
    title.readOnly = true;
  }
  title.addEventListener('input', (e) => {
    updateTitle(habit.id, e.target.value);
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  titleWrap.appendChild(title);

  content.appendChild(titleWrap);

  const intervalEl = document.createElement('button');
  intervalEl.className = 'interval-badge';
  intervalEl.textContent = habit.intervalDays === 1 ? 'daily' : `every ${habit.intervalDays}d`;
  intervalEl.addEventListener('click', () => {
    if (_editingInterval) return;
    _editingInterval = true;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'interval-input';
    input.value = habit.intervalDays;
    input.min = 1;
    input.autocomplete = 'off';
    intervalEl.replaceWith(input);
    input.focus();
    input.select();
    const finish = () => {
      _editingInterval = false;
      const val = parseInt(input.value) || habit.intervalDays;
      updateInterval(habit.id, val);
      renderHabits();
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = habit.intervalDays;
        input.blur();
      }
    });
  });
  content.appendChild(intervalEl);

  item.appendChild(content);

  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'pause-button' + (habit.paused ? ' is-paused' : '');
  pauseBtn.innerHTML = habit.paused ? PLAY_SVG : PAUSE_SVG;
  pauseBtn.addEventListener('click', () => pauseHabit(habit.id));
  item.appendChild(pauseBtn);

  item.appendChild(createDeleteButton((e) => {
    e.stopPropagation();
    deleteHabit(habit.id);
  }));

  if (!habit.paused) {
    initDragAndDrop(item, habit);
    initMobileReorder(item, habit);
  }

  return item;
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

function animateHabitListCentering() {
  const inner = habitList.querySelector('.habit-list-inner');
  if (!inner) return;
  const h = habitList.clientHeight;
  const ch = inner.scrollHeight;
  const offset = ch < h ? Math.max(0, (h - ch) / 2) : 0;
  inner.style.transform = `translate(-50%, ${offset}px)`;
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

function checkMidnight() {
  const now = new Date();
  const hours = now.getHours();
  if (hours >= 0 && hours < 5) {
    const h = hours === 0 ? 12 : hours;
    const m = String(now.getMinutes()).padStart(2, '0');
    const text = midnightReminder.querySelector('.midnight-reminder-text');
    text.textContent = `it is ${h}:${m}am`;
    midnightReminder.classList.add('visible');
  } else {
    midnightReminder.classList.remove('visible');
  }
}

function initDragAndDrop(item, habit) {
  item.draggable = true;

  item.addEventListener('dragstart', (e) => {
    _draggedHabit = habit;
    _draggedEl = item;
    item.classList.add('dragging');
    document.body.classList.add('dragging-in-progress');
    document.body.style.cursor = 'move';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', habit.id);
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.body.classList.remove('dragging-in-progress');
    document.body.style.cursor = '';
    _draggedHabit = null;
    _draggedEl = null;
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = document.querySelector('.dragging');
    if (!dragging || dragging === item) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const inner = habitList.querySelector('.habit-list-inner');
    if (e.clientY < midY) {
      inner.insertBefore(dragging, item);
    } else {
      inner.insertBefore(dragging, item.nextElementSibling);
    }
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    saveDragOrder();
  });
}

function initMobileReorder(item, habit) {
  const titleInput = item.querySelector('.habit-title');
  if (!titleInput) return;

  let startY = 0;

  const resetReorder = () => {
    item.classList.remove('reordering');
    item.style.zIndex = '';
    item.style.position = '';
    item.style.transform = '';
    _isReordering = false;
    _reorderHabitId = null;
  };

  titleInput.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    startY = e.touches[0].clientY;
    _longPressTimer = setTimeout(() => {
      _isReordering = true;
      _reorderHabitId = habit.id;
      item.classList.add('reordering');
      item.style.zIndex = '100';
      item.style.position = 'relative';
      navigator.vibrate && navigator.vibrate(30);
    }, 400);
  }, { passive: true });

  titleInput.addEventListener('touchmove', (e) => {
    if (!_isReordering || _reorderHabitId !== habit.id) {
      clearTimeout(_longPressTimer);
      return;
    }
    e.preventDefault();
    const deltaY = e.touches[0].clientY - startY;
    item.style.transform = `translateY(${deltaY}px)`;

    const inner = habitList.querySelector('.habit-list-inner');
    const items = [...inner.querySelectorAll('.habit-item:not(.reordering)')];
    const rect = item.getBoundingClientRect();
    const itemMidY = rect.top + rect.height / 2;

    for (const other of items) {
      const otherRect = other.getBoundingClientRect();
      const otherMidY = otherRect.top + otherRect.height / 2;
      if (itemMidY < otherMidY && other.previousElementSibling === item) {
        inner.insertBefore(item, other);
        break;
      } else if (itemMidY > otherMidY && other.nextElementSibling && other.nextElementSibling !== item) {
        inner.insertBefore(item, other.nextElementSibling);
        break;
      } else if (itemMidY > otherMidY && !other.nextElementSibling) {
        inner.appendChild(item);
        break;
      }
    }
  }, { passive: false });

  titleInput.addEventListener('touchend', () => {
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderHabitId === habit.id) {
      resetReorder();
      saveDragOrder();
    }
  });

  titleInput.addEventListener('touchcancel', () => {
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderHabitId === habit.id) resetReorder();
  });
}

function saveDragOrder() {
  const inner = habitList.querySelector('.habit-list-inner');
  const items = inner.querySelectorAll('.habit-item');
  items.forEach((item, index) => {
    const habit = findHabit(item.dataset.habitId);
    if (habit) {
      habit.order = index;
      habit.updated_at = Date.now();
    }
  });
  saveHabits();
  const changedHabits = [...items].map(item => findHabit(item.dataset.habitId)).filter(Boolean);
  syncMutation(changedHabits);
}

function saveHabits() {
  try { localStorage.setItem('habits', JSON.stringify(habits)); } catch {}
}

function loadHabits() {
  try {
    const raw = localStorage.getItem('habits');
    const parsed = raw ? JSON.parse(raw) : [];
    habits = parsed.map(h => ({
      ...h,
      completions: Array.isArray(h.completions) ? h.completions : [],
      deleted: h.deleted ?? false,
    }));
  } catch {
    habits = [];
  }
}

function findHabit(id) {
  return habits.find(h => h.id === id);
}

function syncMutation(changedHabits) {
  if (!Auth.isAuthenticated()) return;
  Sync.pushToServer(changedHabits);
}

function debouncedSyncMutation(changedHabits) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => syncMutation(changedHabits), SYNC_DEBOUNCE_MS);
}