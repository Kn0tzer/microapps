let notes = [];
let currentNoteId = null;

let notesListInner, editorPanel, noteTitle, noteEditor, notePreview, previewToggle;
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

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;
let _signingOut = false;

let _draggedNote = null;
let _draggedEl = null;
let _longPressTimer = null;
let _isReordering = false;
let _reorderNoteId = null;

let _previewMode = false;

const ARCHIVE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 7L12 16M12 16L15 12.6667M12 16L9 12.6667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14M6 4V2H10V4M5 7V13M8 7V13M11 7V13M3 4L4 14H12L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const RESTORE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21L12 12M12 12L15 15.3333M12 12L9 15.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 7V13C20.5 16.7712 20.5 18.6569 19.3284 19.8284C18.1569 21 16.2712 21 12.5 21H11.5C7.72876 21 5.84315 21 4.67157 19.8284C3.5 18.6569 3.5 16.7712 3.5 13V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5C2 4.05719 2 3.58579 2.29289 3.29289C2.58579 3 3.05719 3 4 3H20C20.9428 3 21.4142 3 21.7071 3.29289C22 3.58579 22 4.05719 22 5C22 5.94281 22 6.41421 21.7071 6.70711C21.4142 7 20.9428 7 20 7H4C3.05719 7 2.58579 7 2.29289 6.70711C2 6.41421 2 5.94281 2 5Z" stroke="currentColor" stroke-width="1.5"/></svg>';

document.addEventListener('DOMContentLoaded', () => {
  notesListInner = document.getElementById('notesListInner');
  editorPanel = document.getElementById('editorPanel');
  editorStage = document.querySelector('.editor-stage');
  editorContent = document.getElementById('editorContent');
  editorEmptyState = document.getElementById('editorEmptyState');
  noteTitle = document.getElementById('noteTitle');
  noteEditor = document.getElementById('noteEditor');
  notePreview = document.getElementById('notePreview');
  previewToggle = document.getElementById('previewToggle');
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
  });
  noteTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  noteEditor.addEventListener('input', handleEditorInput);
  previewToggle.addEventListener('click', togglePreview);

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

function handleEditorInput() {
  if (currentNoteId === null) return;
  const note = findNote(currentNoteId);
  if (!note) return;
  note.content = noteEditor.value;
  note.updated_at = Date.now();
  saveNotes();
  debouncedSyncMutation([note]);
  updateNoteTimestamp(note);
  if (_previewMode) renderPreview();
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

function generateId() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  let id = '';
  for (let i = 0; i < arr.length; i++) {
    id += arr[i].toString(36).padStart(2, '0');
  }
  return id + Date.now().toString(36);
}

function addNote(title) {
  const minOrder = notes.length ? Math.min(...notes.map(n => n.order ?? 0)) : 0;
  const note = {
    id: generateId(),
    title: title || '',
    content: '',
    archived: false,
    _createdAt: Date.now(),
    order: minOrder - 1,
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
  const listItem = document.querySelector(`.note-item[data-note-id="${noteId}"] .note-item-title`);
  if (listItem) listItem.textContent = title || '';
}

function openNote(noteId) {
  const note = findNote(noteId);
  if (!note) return;
  const previousNoteId = currentNoteId;
  currentNoteId = noteId;
  setEditorStage('editor');
  noteTitle.value = note.title || '';
  noteEditor.value = note.content || '';
  if (_previewMode) {
    renderPreview();
  } else {
    noteEditor.style.display = 'block';
    notePreview.style.display = 'none';
  }
  updateEditorButtons();
  updateNoteTimestamp(note);
  
  if (previousNoteId !== null && previousNoteId !== noteId) {
    const prevItem = document.querySelector(`.note-item[data-note-id="${previousNoteId}"]`);
    if (prevItem) prevItem.classList.remove('selected');
  }
  const currItem = document.querySelector(`.note-item[data-note-id="${noteId}"]`);
  if (currItem) currItem.classList.add('selected');
  
  if (window.innerWidth <= 768) {
    editorPanel.classList.add('open');
    leftPanel.classList.add('hidden');
    setTimeout(() => noteEditor.focus(), 350);
  } else {
    noteEditor.focus();
    const len = noteEditor.value.length;
    noteEditor.setSelectionRange(len, len);
  }
}

function closeEditorPanel() {
  const previousNoteId = currentNoteId;
  currentNoteId = null;
  editorPanel.classList.remove('open', 'fullscreen');
  leftPanel.classList.remove('hidden');
  noteTitle.value = '';
  noteEditor.value = '';
  notePreview.innerHTML = '';
  noteTimestamp.textContent = '';
  setEditorStage('empty');
  updateEditorButtons();
  
  if (previousNoteId !== null) {
    const prevItem = document.querySelector(`.note-item[data-note-id="${previousNoteId}"]`);
    if (prevItem) prevItem.classList.remove('selected');
  }
}

function toggleFullscreen() {
  editorPanel.classList.toggle('fullscreen');
}

function togglePreview() {
  _previewMode = !_previewMode;
  if (_previewMode) {
    renderPreview();
    noteEditor.style.display = 'none';
    notePreview.style.display = 'block';
    previewToggle.classList.add('active');
  } else {
    notePreview.style.display = 'none';
    noteEditor.style.display = 'block';
    previewToggle.classList.remove('active');
    noteEditor.focus();
    const len = noteEditor.value.length;
    noteEditor.setSelectionRange(len, len);
  }
}

function sanitizeHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  const scripts = d.querySelectorAll('script, iframe, object, embed');
  for (const el of scripts) el.remove();
  for (const el of d.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  }
  return d.innerHTML;
}

function renderPreview() {
  if (!notePreview || typeof marked === 'undefined') return;
  try {
    notePreview.innerHTML = sanitizeHtml(marked.parse(noteEditor.value || '', { breaks: true, gfm: true }));
  } catch (e) {
    notePreview.textContent = noteEditor.value || '';
    console.warn('[micronote] Markdown render failed, showing raw text');
  }
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

  refreshOpenEditorIfStale();
}

function refreshOpenEditorIfStale() {
  if (currentNoteId === null) return;
  const note = findNote(currentNoteId);
  if (!note) return;
  if (document.activeElement === noteEditor || document.activeElement === noteTitle) return;
  const content = note.content || '';
  const title = note.title || '';
  if (noteEditor.value === content && noteTitle.value === title) return;
  noteTitle.value = title;
  noteEditor.value = content;
  if (_previewMode) {
    renderPreview();
  } else {
    const len = noteEditor.value.length;
    noteEditor.setSelectionRange(len, len);
  }
  updateNoteTimestamp(note);
}

function createNoteElement(note) {
  const item = document.createElement('div');
  item.className = 'note-item';
  item.dataset.noteId = note.id;
  if (note.id === currentNoteId) item.classList.add('selected');
  if (note._createdAt && Date.now() - note._createdAt < 1000) item.classList.add('adding');

  const content = document.createElement('div');
  content.className = 'note-item-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'note-item-title';
  titleEl.textContent = note.title || '';
  content.appendChild(titleEl);

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

  if (!note.archived) {
    initDragAndDrop(item, note);
    initMobileReorder(item, note);
  }

  return item;
}

function initDragAndDrop(item, note) {
  item.draggable = true;
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

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!_draggedNote || _draggedNote.id === note.id) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      notesListInner.insertBefore(_draggedEl, item);
    } else {
      notesListInner.insertBefore(_draggedEl, item.nextElementSibling);
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
