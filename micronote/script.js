let notes = [];
let currentNoteId = null;

let notesListInner, editorPanel, noteTitle, noteEditor;
let editorContent, editorEmptyState, editorStage;
let settingsIcon, settingsOverlay;
let addNoteButton, deleteNoteButton, restoreNoteButton, closeEditorBtn;
let fullscreenButton, noteTimestamp;
let archivedHeader, archivedList;
let signInBtn, signOutBtn;
let overlay;
let mobileNewNoteModal, mobileNoteInput, mobileNoteSubmit;
let leftPanel;
let resizeHandle;
let subtasksList, addSubtaskButton;

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;
let _signingOut = false;

let _draggedNote = null;
let _draggedEl = null;
let _longPressTimer = null;
let _isReordering = false;
let _reorderNoteId = null;

let _draggedSubtask = null;
let _draggedSubtaskEl = null;
let _subtaskLongPressTimer = null;
let _isReorderingSubtask = false;
let _reorderSubtaskNoteId = null;
let _reorderSubtaskId = null;

let _editorRawText = '';

const ARCHIVE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 7L12 16M12 16L15 12.6667M12 16L9 12.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M6 4V2H10V4M5 7V13M8 7V13M11 7V13M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const RESTORE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21L12 12M12 12L15 15.3333M12 12L9 15.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z" stroke="currentColor" stroke-width="1.5"/></svg>';
const DRAG_HANDLE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/></svg>';

document.addEventListener('DOMContentLoaded', () => {
  notesListInner = document.getElementById('notesListInner');
  editorPanel = document.getElementById('editorPanel');
  editorStage = document.querySelector('.editor-stage');
  editorContent = document.getElementById('editorContent');
  editorEmptyState = document.getElementById('editorEmptyState');
  noteTitle = document.getElementById('noteTitle');
  noteEditor = document.getElementById('noteEditor');
  settingsIcon = document.getElementById('settingsIcon');
  settingsOverlay = document.getElementById('settingsOverlay');
  addNoteButton = document.getElementById('addNoteButton');
  deleteNoteButton = document.getElementById('deleteNoteButton');
  restoreNoteButton = document.getElementById('restoreNoteButton');
  closeEditorBtn = document.getElementById('closeEditor');
  fullscreenButton = document.getElementById('fullscreenButton');
  noteTimestamp = document.getElementById('noteTimestamp');
  archivedHeader = document.getElementById('archivedHeader');
  archivedList = document.getElementById('archivedList');
  signInBtn = document.getElementById('signInBtn');
  signOutBtn = document.getElementById('signOutBtn');
  overlay = document.getElementById('overlay');
  mobileNewNoteModal = document.getElementById('mobileNewNoteModal');
  mobileNoteInput = document.getElementById('mobileNoteInput');
  mobileNoteSubmit = document.getElementById('mobileNoteSubmit');
  leftPanel = document.getElementById('leftPanel');
  resizeHandle = document.getElementById('resizeHandle');
  subtasksList = document.getElementById('subtasksList');
  addSubtaskButton = document.getElementById('addSubtaskButton');

  loadData();
  renderNotes();
  attachEventListeners();
  Sync = SyncFactory.create({
    endpoint: 'notes',
    storageKey: 'micronote_notes',
    getItems: () => notes,
    setItems: (v) => { notes = v; },
    buildPayload: (n) => ({
      title: n.title || '',
      content: n.content || '',
      archived: n.archived || false,
    }),
    toLocal: (s) => ({
      title: s.title || '',
      content: s.content || '',
      archived: s.archived || false,
    }),
    render: renderNotes,
  });
  Sync.init();
  updateAuthUI();
  Auth.onAuthChange(() => {
    if (!_signingOut) updateAuthUI();
  });
  setEditorStage('empty');
});

function attachEventListeners() {
  addNoteButton.addEventListener('click', handleAddNote);
  closeEditorBtn.addEventListener('click', closeEditorPanel);
  fullscreenButton.addEventListener('click', toggleFullscreen);
  settingsIcon.addEventListener('click', openSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettingsPanel();
  });
  overlay.addEventListener('click', closeAllOverlays);
  archivedHeader.addEventListener('click', toggleArchived);
  addSubtaskButton.addEventListener('click', addSubtask);

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

  noteTitle.addEventListener('input', (e) => {
    updateNoteTitle(currentNoteId, e.target.value);
    renderNotes();
  });
  noteTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  noteEditor.addEventListener('input', handleEditorInputFallback);

  deleteNoteButton.addEventListener('click', () => permanentlyDeleteNote(currentNoteId));
  restoreNoteButton.addEventListener('click', () => restoreNote(currentNoteId));

  mobileNoteSubmit.addEventListener('click', submitMobileNote);
  mobileNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitMobileNote();
    if (e.key === 'Escape') closeMobileNoteModal();
  });
  mobileNewNoteModal.addEventListener('click', (e) => {
    if (e.target === mobileNewNoteModal) closeMobileNoteModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (editorPanel.classList.contains('fullscreen')) {
        toggleFullscreen();
      } else {
        closeMobileNoteModal();
      }
    }
  });

  document.getElementById('notesList').addEventListener('click', (e) => {
    if (currentNoteId !== null && !e.target.closest('.note-item')) {
      closeEditorPanel();
    }
  });

  initResizeHandle();
}

function setEditorStage(stage) {
  if (stage === 'editor') {
    editorContent.classList.add('active');
    editorEmptyState.classList.add('inactive');
  } else {
    editorContent.classList.remove('active');
    editorEmptyState.classList.remove('inactive');
  }
}

function createCheckbox(checked, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'checkbox-wrapper';
  wrapper.draggable = false;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.draggable = false;
  cb.addEventListener('change', onChange);
  const custom = document.createElement('div');
  custom.className = 'checkbox-custom';
  custom.draggable = false;
  wrapper.appendChild(cb);
  wrapper.appendChild(custom);
  return wrapper;
}

function createDeleteButton(onClick) {
  const btn = document.createElement('button');
  btn.className = 'delete-button';
  btn.draggable = false;
  btn.innerHTML = DELETE_SVG;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return btn;
}

function handleEditorInput(markdown) {
  if (currentNoteId === null) return;
  _editorRawText = markdown;
  const note = findNote(currentNoteId);
  if (note) {
    note.content = _editorRawText;
    note.updated_at = Date.now();
    saveNotes();
    debouncedSyncMutation([note]);
  }
  updateNoteTimestamp(note);
}

function handleEditorInputFallback() {
  if (window.MilkdownEditor) return;
  handleEditorInput(noteEditor.textContent);
}

function initResizeHandle() {
  let isResizing = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 200 && newWidth <= window.innerWidth - 200) {
      leftPanel.style.width = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function handleAddNote() {
  if (window.innerWidth <= 768) {
    mobileNewNoteModal.classList.add('visible');
    mobileNoteInput.value = '';
    mobileNoteInput.focus();
  } else {
    addNote();
  }
}

function closeMobileNoteModal() {
  mobileNewNoteModal.classList.remove('visible');
  mobileNoteInput.blur();
}

function submitMobileNote() {
  const title = mobileNoteInput.value.trim();
  closeMobileNoteModal();
  addNote(title || null);
}

function addNote(title) {
  const note = {
    id: Date.now(),
    title: title || '',
    content: '',
    archived: false,
    subtasks: [],
    order: notes.length,
    updated_at: Date.now(),
    deleted: false,
  };
  notes.push(note);
  saveNotes();
  syncMutation([note]);
  renderNotes();
  openNote(note.id);
  if (!title) {
    setTimeout(() => noteTitle.focus(), 50);
  }
}

function animateAndExecute(noteId, action) {
  const note = findNote(noteId);
  if (!note) return;
  const el = document.querySelector(`[data-note-id="${noteId}"]`);
  if (el) {
    el.classList.add('removing');
    el.addEventListener('animationend', () => {
      action(note);
      if (currentNoteId === noteId) closeEditorPanel();
      renderNotes();
    }, { once: true });
  } else {
    action(note);
    if (currentNoteId === noteId) closeEditorPanel();
    renderNotes();
  }
}

function archiveNote(noteId) {
  animateAndExecute(noteId, (note) => {
    note.archived = true;
    note.updated_at = Date.now();
    saveNotes();
    syncMutation([note]);
  });
}

function permanentlyDeleteNote(noteId) {
  animateAndExecute(noteId, (note) => {
    note.deleted = true;
    note.updated_at = Date.now();
    saveNotes();
    syncMutation([note]);
  });
}

function restoreNote(noteId) {
  const note = findNote(noteId);
  if (!note) return;
  note.archived = false;
  note.updated_at = Date.now();
  saveNotes();
  syncMutation([note]);
  renderNotes();
}

function updateNoteTitle(noteId, title) {
  const note = findNote(noteId);
  if (!note) return;
  note.title = title;
  note.updated_at = Date.now();
  saveNotes();
  debouncedSyncMutation([note]);
}

async function openNote(noteId) {
  currentNoteId = noteId;
  const note = findNote(noteId);
  if (!note) return;
  setEditorStage('editor');
  noteTitle.value = note.title || '';
  _editorRawText = note.content || '';
  if (window.MilkdownEditor) {
    await MilkdownEditor.create(noteEditor, _editorRawText, handleEditorInput);
  } else {
    noteEditor.textContent = _editorRawText;
  }
  renderSubtasks();
  updateEditorButtons();
  updateNoteTimestamp(note);
  renderNotes();
  if (window.innerWidth <= 768) {
    editorPanel.classList.add('open');
    leftPanel.classList.add('hidden');
  } else {
    if (window.MilkdownEditor) {
      MilkdownEditor.focus();
    } else {
      noteEditor.focus();
    }
  }
}

function closeEditorPanel() {
  currentNoteId = null;
  editorPanel.classList.remove('open', 'fullscreen');
  leftPanel.classList.remove('hidden');
  noteTitle.value = '';
  _editorRawText = '';
  if (window.MilkdownEditor) {
    MilkdownEditor.destroy();
  } else {
    noteEditor.textContent = '';
  }
  noteTimestamp.textContent = '';
  subtasksList.innerHTML = '';
  setEditorStage('empty');
  updateEditorButtons();
  renderNotes();
}

function toggleFullscreen() {
  editorPanel.classList.toggle('fullscreen');
}

function updateEditorButtons() {
  const note = findNote(currentNoteId);
  if (!note) {
    deleteNoteButton.style.display = 'none';
    restoreNoteButton.style.display = 'none';
    noteTimestamp.textContent = '';
    return;
  }
  if (note.archived) {
    deleteNoteButton.style.display = 'flex';
    restoreNoteButton.style.display = 'flex';
  } else {
    deleteNoteButton.style.display = 'none';
    restoreNoteButton.style.display = 'none';
  }
  updateNoteTimestamp(note);
}

function updateNoteTimestamp(note) {
  if (!note || !noteTimestamp) return;
  noteTimestamp.textContent = formatTime(note.updated_at);
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

function closeAllOverlays() {
  closeSettingsPanel();
  closeMobileNoteModal();
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

function toggleArchived() {
  archivedHeader.classList.toggle('collapsed');
  archivedList.classList.toggle('collapsed');
}

function renderNotes() {
  notesListInner.innerHTML = '';

  const active = notes.filter(n => !n.deleted && !n.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  active.forEach(n => notesListInner.appendChild(createNoteElement(n)));

  const archived = notes.filter(n => !n.deleted && n.archived)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  archivedList.innerHTML = '';
  archived.forEach(n => archivedList.appendChild(createNoteElement(n)));
}

function createNoteElement(note) {
  const item = document.createElement('div');
  item.className = 'note-item';
  item.dataset.noteId = note.id;
  if (note.id === currentNoteId) item.classList.add('selected');
  if (note.id > Date.now() - 1000) item.classList.add('adding');
  item.draggable = true;

  const content = document.createElement('div');
  content.className = 'note-item-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'note-item-title';
  titleEl.textContent = note.title || '';
  content.appendChild(titleEl);

  if (Array.isArray(note.subtasks) && note.subtasks.length > 0) {
    const done = note.subtasks.filter(s => s.completed).length;
    const counter = document.createElement('div');
    counter.className = 'subtask-counter';
    counter.textContent = `${done}/${note.subtasks.length}`;
    content.appendChild(counter);
  }

  item.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'note-item-actions';
  if (note.archived) {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'action-button';
    restoreBtn.draggable = false;
    restoreBtn.innerHTML = RESTORE_SVG;
    restoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreNote(note.id);
    });
    actions.appendChild(restoreBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-button';
    deleteBtn.draggable = false;
    deleteBtn.innerHTML = DELETE_SVG;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      permanentlyDeleteNote(note.id);
    });
    actions.appendChild(deleteBtn);
  } else {
    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'action-button';
    archiveBtn.draggable = false;
    archiveBtn.innerHTML = ARCHIVE_SVG;
    archiveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      archiveNote(note.id);
    });
    actions.appendChild(archiveBtn);
  }
  item.appendChild(actions);

  item.addEventListener('click', () => {
    if (!_isReordering) openNote(note.id);
  });

  initDragAndDrop(item, note);
  initMobileReorder(item, note);

  return item;
}

function initDragAndDrop(item, note) {
  item.addEventListener('dragstart', (e) => {
    _draggedNote = note;
    _draggedEl = item;
    item.classList.add('dragging');
    document.body.classList.add('dragging-in-progress');
    document.body.style.cursor = 'move';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', note.id);
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.body.classList.remove('dragging-in-progress');
    document.body.style.cursor = '';
    _draggedNote = null;
    _draggedEl = null;
  });

  if (note.archived) return;

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!_draggedNote || _draggedNote.id === note.id) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      notesListInner.insertBefore(_draggedEl, item);
    } else {
      notesListInner.insertBefore(_draggedEl, item.nextSibling);
    }
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    saveDragOrder();
  });
}

function initMobileReorder(item, note) {
  if (note.archived) return;
  let startY = 0;

  const resetReorder = () => {
    item.classList.remove('reordering');
    item.style.zIndex = '';
    item.style.position = '';
    item.style.transform = '';
    _isReordering = false;
    _reorderNoteId = null;
  };

  item.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    startY = e.touches[0].clientY;
    _longPressTimer = setTimeout(() => {
      _isReordering = true;
      _reorderNoteId = note.id;
      item.classList.add('reordering');
      item.style.zIndex = '100';
      item.style.position = 'relative';
      navigator.vibrate && navigator.vibrate(30);
    }, 400);
  }, { passive: true });

  item.addEventListener('touchmove', (e) => {
    if (!_isReordering || _reorderNoteId !== note.id) {
      clearTimeout(_longPressTimer);
      return;
    }
    e.preventDefault();
    const deltaY = e.touches[0].clientY - startY;
    item.style.transform = `translateY(${deltaY}px)`;

    const items = [...notesListInner.querySelectorAll('.note-item:not(.reordering)')];
    const rect = item.getBoundingClientRect();
    const itemMidY = rect.top + rect.height / 2;

    for (const other of items) {
      const otherRect = other.getBoundingClientRect();
      const otherMidY = otherRect.top + otherRect.height / 2;
      if (itemMidY < otherMidY && other.previousElementSibling === item) {
        notesListInner.insertBefore(item, other);
        break;
      } else if (itemMidY > otherMidY && other.nextElementSibling && other.nextElementSibling !== item) {
        notesListInner.insertBefore(item, other.nextElementSibling);
        break;
      } else if (itemMidY > otherMidY && !other.nextElementSibling) {
        notesListInner.appendChild(item);
        break;
      }
    }
  }, { passive: false });

  item.addEventListener('touchend', () => {
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderNoteId === note.id) {
      resetReorder();
      saveDragOrder();
    }
  });

  item.addEventListener('touchcancel', () => {
    clearTimeout(_longPressTimer);
    if (_isReordering && _reorderNoteId === note.id) resetReorder();
  });
}

function saveDragOrder() {
  const items = notesListInner.querySelectorAll('.note-item');
  items.forEach((item, index) => {
    const note = findNote(Number(item.dataset.noteId));
    if (note) {
      note.order = index;
      note.updated_at = Date.now();
    }
  });
  saveNotes();
  const changed = [...items].map(item => findNote(Number(item.dataset.noteId))).filter(Boolean);
  syncMutation(changed);
}

function addSubtask() {
  const note = findNote(currentNoteId);
  if (!note) return;
  if (!Array.isArray(note.subtasks)) note.subtasks = [];
  const subtask = { id: Date.now() + Math.floor(Math.random() * 1000), title: '', completed: false };
  note.subtasks.push(subtask);
  note.updated_at = Date.now();
  saveNotes();
  syncMutation([note]);
  renderSubtasks();
  renderNotes();
  setTimeout(() => {
    const el = document.querySelector(`[data-subtask-id="${subtask.id}"] .subtask-title`);
    if (el) el.focus();
  }, 50);
}

function renderSubtasks() {
  const note = findNote(currentNoteId);
  if (!note) {
    subtasksList.innerHTML = '';
    return;
  }
  if (!Array.isArray(note.subtasks)) note.subtasks = [];
  subtasksList.innerHTML = '';

  note.subtasks.forEach(subtask => {
    const item = document.createElement('div');
    item.className = 'subtask-item';
    item.dataset.subtaskId = subtask.id;
    item.draggable = true;

    if (subtask.id && subtask.id > Date.now() - 1000) item.classList.add('adding');

    const dragHandle = document.createElement('div');
    dragHandle.className = 'subtask-drag-handle';
    dragHandle.innerHTML = DRAG_HANDLE_SVG;
    item.appendChild(dragHandle);

    item.appendChild(createCheckbox(subtask.completed, () => toggleSubtaskComplete(note.id, subtask.id)));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'subtask-title';
    input.value = subtask.title;
    input.placeholder = 'subtask';
    input.autocomplete = 'off';
    input.draggable = false;
    input.addEventListener('input', (e) => updateSubtaskTitle(note.id, subtask.id, e.target.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    item.appendChild(input);

    item.appendChild(createDeleteButton(() => deleteSubtask(note.id, subtask.id)));
    subtasksList.appendChild(item);

    initSubtaskDrag(item, subtask, note);
    initSubtaskMobileReorder(item, subtask, note);
  });
}

function toggleSubtaskComplete(noteId, subtaskId) {
  const note = findNote(noteId);
  if (!note || !Array.isArray(note.subtasks)) return;
  const st = note.subtasks.find(s => String(s.id) === String(subtaskId));
  if (!st) return;
  st.completed = !st.completed;
  note.updated_at = Date.now();
  saveNotes();
  syncMutation([note]);
  renderSubtasks();
  renderNotes();
}

function updateSubtaskTitle(noteId, subtaskId, title) {
  const note = findNote(noteId);
  if (!note || !Array.isArray(note.subtasks)) return;
  const st = note.subtasks.find(s => String(s.id) === String(subtaskId));
  if (!st) return;
  st.title = title;
  note.updated_at = Date.now();
  saveNotes();
  debouncedSyncMutation([note]);
}

function deleteSubtask(noteId, subtaskId) {
  const note = findNote(noteId);
  if (!note || !Array.isArray(note.subtasks)) return;
  const el = document.querySelector(`[data-subtask-id="${subtaskId}"]`);
  if (!el) {
    removeSubtaskFromNote(note, subtaskId);
    return;
  }
  el.classList.add('removing');
  el.addEventListener('animationend', () => {
    removeSubtaskFromNote(note, subtaskId);
  }, { once: true });
}

function removeSubtaskFromNote(note, subtaskId) {
  note.subtasks = note.subtasks.filter(s => String(s.id) !== String(subtaskId));
  note.updated_at = Date.now();
  saveNotes();
  syncMutation([note]);
  renderSubtasks();
  renderNotes();
}

function initSubtaskDrag(item, subtask, note) {
  item.addEventListener('dragstart', (e) => {
    _draggedSubtask = subtask;
    _draggedSubtaskEl = item;
    item.classList.add('dragging');
    document.body.classList.add('dragging-in-progress');
    document.body.style.cursor = 'move';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(subtask.id));
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.body.classList.remove('dragging-in-progress');
    document.body.style.cursor = '';
    _draggedSubtask = null;
    _draggedSubtaskEl = null;
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!_draggedSubtask || String(_draggedSubtask.id) === String(subtask.id)) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      subtasksList.insertBefore(_draggedSubtaskEl, item);
    } else {
      subtasksList.insertBefore(_draggedSubtaskEl, item.nextSibling);
    }
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    saveSubtaskOrder(note.id);
  });
}

function initSubtaskMobileReorder(item, subtask, note) {
  let startY = 0;

  const resetReorder = () => {
    item.classList.remove('reordering');
    item.style.zIndex = '';
    item.style.position = '';
    item.style.transform = '';
    _isReorderingSubtask = false;
    _reorderSubtaskNoteId = null;
    _reorderSubtaskId = null;
  };

  item.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    startY = e.touches[0].clientY;
    _subtaskLongPressTimer = setTimeout(() => {
      _isReorderingSubtask = true;
      _reorderSubtaskNoteId = note.id;
      _reorderSubtaskId = subtask.id;
      item.classList.add('reordering');
      item.style.zIndex = '100';
      item.style.position = 'relative';
      navigator.vibrate && navigator.vibrate(30);
    }, 400);
  }, { passive: true });

  item.addEventListener('touchmove', (e) => {
    if (!_isReorderingSubtask || _reorderSubtaskId !== subtask.id) {
      clearTimeout(_subtaskLongPressTimer);
      return;
    }
    e.preventDefault();
    const deltaY = e.touches[0].clientY - startY;
    item.style.transform = `translateY(${deltaY}px)`;

    const items = [...subtasksList.querySelectorAll('.subtask-item:not(.reordering)')];
    const rect = item.getBoundingClientRect();
    const itemMidY = rect.top + rect.height / 2;

    for (const other of items) {
      const otherRect = other.getBoundingClientRect();
      const otherMidY = otherRect.top + otherRect.height / 2;
      if (itemMidY < otherMidY && other.previousElementSibling === item) {
        subtasksList.insertBefore(item, other);
        break;
      } else if (itemMidY > otherMidY && other.nextElementSibling && other.nextElementSibling !== item) {
        subtasksList.insertBefore(item, other.nextElementSibling);
        break;
      } else if (itemMidY > otherMidY && !other.nextElementSibling) {
        subtasksList.appendChild(item);
        break;
      }
    }
  }, { passive: false });

  item.addEventListener('touchend', () => {
    clearTimeout(_subtaskLongPressTimer);
    if (_isReorderingSubtask && _reorderSubtaskId === subtask.id) {
      resetReorder();
      saveSubtaskOrder(note.id);
    }
  });

  item.addEventListener('touchcancel', () => {
    clearTimeout(_subtaskLongPressTimer);
    if (_isReorderingSubtask && _reorderSubtaskId === subtask.id) resetReorder();
  });
}

function saveSubtaskOrder(noteId) {
  const note = findNote(noteId);
  if (!note || !Array.isArray(note.subtasks)) return;
  const items = subtasksList.querySelectorAll('.subtask-item');
  note.subtasks = [...items].map(item => {
    const id = item.dataset.subtaskId;
    return note.subtasks.find(s => String(s.id) === String(id));
  }).filter(Boolean);
  note.updated_at = Date.now();
  saveNotes();
  syncMutation([note]);
}

function formatTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '1m';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function saveNotes() {
  try { localStorage.setItem('micronote_notes', JSON.stringify(notes)); } catch {}
}

function loadData() {
  try {
    const raw = localStorage.getItem('micronote_notes');
    notes = raw ? JSON.parse(raw) : [];
    notes.forEach(n => {
      if (!Array.isArray(n.subtasks)) n.subtasks = [];
    });
  } catch { notes = []; }
}

function findNote(id) {
  return notes.find(n => n.id === id);
}

function syncMutation(changedNotes) {
  if (!Auth.isAuthenticated()) return;
  Sync.pushToServer(changedNotes);
}

function debouncedSyncMutation(changedNotes) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => syncMutation(changedNotes), SYNC_DEBOUNCE_MS);
}
