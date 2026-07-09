let notes = [];
let currentNoteId = null;

let notesListInner, editorPanel, noteTitle, noteEditor, notePreview, previewToggle;
let editorContent, editorEmptyState, editorStage;
let settingsIcon, settingsOverlay;
let addNoteButton, deleteNoteButton, restoreNoteButton, closeEditorBtn;
let fullscreenButton;
let archivedHeader, archivedList;
let signInBtn, signOutBtn;
let overlay;
let mobileNewNoteModal, mobileNoteInput, mobileNoteSubmit;
let leftPanel;
let resizeHandle;

let _syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 500;

const RESTORE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21 L12 12 M12 12 L15 15.3333 M12 12 L9 15.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.5 7 V13 C20.5 16.7712 20.5 18.6569 19.3284 19.8284 C18.1569 21 16.2712 21 12.5 21 H11.5 C7.72876 21 5.84315 21 4.67157 19.8284 C3.5 18.6569 3.5 16.7712 3.5 13 V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5 C2 4.05719 2 3.58579 2.29289 3.29289 C2.58579 3 3.05719 3 4 3 H20 C20.9428 3 21.4142 3 21.7071 3.29289 C22 3.58579 22 4.05719 22 5 C22 5.94281 C22 6.82863 21.4142 7.20712 20.9428 7.5 C20.4714 7.79288 20 7.5 20 7.5 H4 C4 7.5 3.5286 7.79288 3.05719 7.5 C2.58579 7.20712 2 6.82863 2 5 Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const DELETE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4 H14 M6 4 V2 H10 V4 M5 7 V13 M8 7 V13 M11 7 V13 M3 4 L4 14 H12 L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARCHIVE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7 V13 C20.5 16.7712 20.5 18.6569 19.3284 19.8284 C18.1569 21 16.2712 21 12.5 21 H11.5 C7.72876 21 5.84315 21 4.67157 19.8284 C3.5 18.6569 3.5 16.7712 3.5 13 V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 5 C2 4.05719 2 3.58579 2.29289 3.29289 C2.58579 3 3.05719 3 4 3 H20 C20.9428 3 21.4142 3 21.7071 3.29289 C22 3.58579 22 4.05719 22 5 C22 5.94281 C22 6.82863 21.4142 7.20712 20.9428 7.5 C20.4714 7.79288 20 7.5 20 7.5 H4 C4 7.5 3.5286 7.79288 3.05719 7.5 C2.58579 7.20712 2 6.82863 2 5 Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

let _longPressTimer = null;
let _isReordering = false;
let _reorderNoteId = null;
let _addingNote = false;

let previewMode = false;

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

  loadNotes();
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
  Auth.onAuthChange(() => updateAuthUI());
  editorContent.classList.remove('active');
  editorEmptyState.classList.remove('inactive');
  deleteNoteButton.innerHTML = DELETE_SVG;
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
    Auth.signOut();
    updateAuthUI();
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

  window.addEventListener('storage', (e) => {
    if (e.key === 'micronote_notes') {
      loadNotes();
      renderNotes();
    }
  });

  initResizeHandle();
}

function handleEditorInput() {
  if (currentNoteId === null) return;
  const note = findNote(currentNoteId);
  if (!note) return;
  note.content = noteEditor.value;
  note.updated_at = Date.now();
  saveNotes();
  debouncedPushSync([note]);
  if (previewMode) renderPreview();
}

function initResizeHandle() {
  let isResizing = false;

  const onResize = (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 200 && newWidth <= window.innerWidth - 200) {
      leftPanel.style.width = newWidth + 'px';
    }
  };

  const onUp = () => {
    if (isResizing) {
      isResizing = false;
      resizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', onUp);
    }
  };

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

function handleAddNote() {
  if (_addingNote) return;
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
  try {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    let id = '';
    for (let i = 0; i < arr.length; i++) {
      id += arr[i].toString(36).padStart(2, '0');
    }
    return id + Date.now().toString(36);
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

function addNote(title) {
  if (_addingNote) return;
  _addingNote = true;
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
  Sync.pushToServer([note]);
  renderNotes();
  openNote(note.id);
  if (!title) {
    setTimeout(() => noteTitle.focus(), 50);
  }
  setTimeout(() => { _addingNote = false; }, 300);
}

function animateAndExecute(noteId, action) {
  const note = findNote(noteId);
  if (!note) return;
  const el = document.querySelector(`[data-note-id="${noteId}"]`);
  const execute = () => {
    action(note);
    if (currentNoteId === noteId) closeEditorPanel();
    renderNotes();
  };
  if (el) {
    el.classList.add('removing');
    el.addEventListener('animationend', () => execute(), { once: true });
    setTimeout(execute, 600);
  } else {
    execute();
  }
}

function archiveNote(noteId) {
  animateAndExecute(noteId, (note) => {
    note.archived = true;
    note.updated_at = Date.now();
    saveNotes();
    Sync.pushToServer([note]);
  });
}

function permanentlyDeleteNote(noteId) {
  animateAndExecute(noteId, (note) => {
    note.deleted = true;
    note.updated_at = Date.now();
    saveNotes();
    Sync.pushToServer([note]);
  });
}

function restoreNote(noteId) {
  animateAndExecute(noteId, (note) => {
    note.archived = false;
    note.updated_at = Date.now();
    saveNotes();
    Sync.pushToServer([note]);
  });
}

function updateNoteTitle(noteId, title) {
  const note = findNote(noteId);
  if (!note) return;
  note.title = title;
  note.updated_at = Date.now();
  saveNotes();
  debouncedPushSync([note]);
  const listItem = document.querySelector(`.note-item[data-note-id="${noteId}"] .note-item-title`);
  if (listItem) listItem.textContent = title || '';
}

function openNote(noteId) {
  const note = findNote(noteId);
  if (!note) return;
  const previousNoteId = currentNoteId;
  currentNoteId = noteId;
  editorContent.classList.add('active');
  editorEmptyState.classList.add('inactive');
  noteTitle.value = note.title || '';
  noteEditor.value = note.content || '';
  if (previewMode) {
    renderPreview();
  } else {
    noteEditor.style.display = 'block';
    notePreview.style.display = 'none';
  }
  updateEditorButtons();

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
  editorContent.classList.remove('active');
  editorEmptyState.classList.remove('inactive');
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
  previewMode = !previewMode;
  if (previewMode) {
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
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  for (const el of body.querySelectorAll('script, iframe, object, embed, link, style')) {
    el.remove();
  }
  for (const el of body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
    for (const attr of ['href', 'action', 'src', 'xlink:href']) {
      const val = el.getAttribute(attr);
      if (val && /^\s*javascript\s*:/i.test(val)) {
        el.removeAttribute(attr);
      }
    }
  }
  return body.innerHTML;
}

function renderPreview() {
  if (!notePreview || typeof marked === 'undefined') return;
  try {
    notePreview.innerHTML = sanitizeHtml(marked.parse(noteEditor.value || '', { breaks: true, gfm: true }));
  } catch (e) {
    notePreview.textContent = noteEditor.value || '';
  }
}

function updateEditorButtons() {
  const note = findNote(currentNoteId);
  if (!note) {
    deleteNoteButton.style.display = 'none';
    restoreNoteButton.style.display = 'none';
    return;
  }
  deleteNoteButton.style.display = note.archived ? 'flex' : 'none';
  restoreNoteButton.style.display = note.archived ? 'flex' : 'none';
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
  const fragment = document.createDocumentFragment();
  active.forEach(n => fragment.appendChild(createNoteElement(n)));
  notesListInner.appendChild(fragment);

  const archived = notes.filter(n => !n.deleted && n.archived)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  archivedList.innerHTML = '';
  const archivedSection = document.getElementById('archivedSection');
  if (archived.length === 0) {
    archivedHeader.style.display = 'none';
    if (archivedSection) archivedSection.style.display = 'none';
  } else {
    archivedHeader.style.display = 'flex';
    if (archivedSection) archivedSection.style.display = 'block';
    archived.forEach(n => archivedList.appendChild(createNoteElement(n)));
  }

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
  if (previewMode) {
    renderPreview();
  } else {
    const len = noteEditor.value.length;
    noteEditor.setSelectionRange(len, len);
  }
}

function createActionButton(svg, action) {
  const btn = document.createElement('button');
  btn.className = 'action-button';
  btn.draggable = false;
  btn.innerHTML = svg;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    action();
  });
  return btn;
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
    actions.appendChild(createActionButton(RESTORE_SVG, () => restoreNote(note.id)));
    actions.appendChild(createActionButton(DELETE_SVG, () => permanentlyDeleteNote(note.id)));
  } else {
    actions.appendChild(createActionButton(ARCHIVE_SVG, () => archiveNote(note.id)));
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
    if (window.getSelection() && window.getSelection().toString().length > 0) {
      e.preventDefault();
      item.draggable = false;
      setTimeout(() => item.draggable = true, 0);
      return;
    }
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
    saveDragOrder();
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = document.querySelector('.dragging');
    if (!dragging) return;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      notesListInner.insertBefore(dragging, item);
    } else {
      notesListInner.insertBefore(dragging, item.nextElementSibling);
    }
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
  });
}

function initMobileReorder(item, note) {
  let startY = 0;
  let reorderStartY = 0;

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
    reorderStartY = e.touches[0].clientY;
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
    const itemRect = item.getBoundingClientRect();
    const itemMidY = itemRect.top + itemRect.height / 2;

    let bestTarget = null;
    let bestPos = null;
    for (const other of items) {
      const otherRect = other.getBoundingClientRect();
      const otherMidY = otherRect.top + otherRect.height / 2;
      if (itemMidY < otherMidY) {
        bestTarget = other;
        bestPos = 'before';
        break;
      }
    }
    if (bestTarget) {
      notesListInner.insertBefore(item, bestTarget);
    } else {
      notesListInner.appendChild(item);
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
  const noteMap = new Map(notes.map(n => [n.id, n]));
  let changed = [];
  items.forEach((item, index) => {
    const note = noteMap.get(item.dataset.noteId);
    if (note && note.order !== index) {
      note.order = index;
      note.updated_at = Date.now();
      changed.push(note);
    }
  });
  if (changed.length > 0) {
    saveNotes();
    Sync.pushToServer(changed);
  }
}

function saveNotes() {
  try {
    localStorage.setItem('micronote_notes', JSON.stringify(notes));
  } catch (e) {
    console.error('micronote: failed to save notes to localStorage', e);
  }
}

function loadNotes() {
  try {
    const raw = localStorage.getItem('micronote_notes');
    notes = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 7 * 86400000;
    const before = notes.length;
    notes = notes.filter(n => !n.deleted || (n.updated_at || 0) >= cutoff);
    if (notes.length < before) saveNotes();
  } catch (e) {
    console.error('micronote: failed to load notes from localStorage', e);
    notes = [];
  }
}

function findNote(id) {
  return notes.find(n => n.id === id);
}

function debouncedPushSync(changedNotes) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => Sync.pushToServer(changedNotes), SYNC_DEBOUNCE_MS);
}
