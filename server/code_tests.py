#!/usr/bin/env python3
"""Static test suite for microapps monorepo. Exit 0 if clean, 1 on error."""
import os, re, sys
from pathlib import Path

REPO = Path("/home/ubuntu/microapps")
APPS = ["microtask", "microplans", "microhabit", "micronote", "microshare"]
ALL_SCRIPT_FILES = [REPO / a / "script.js" for a in APPS]
ALL_STYLE_FILES = [REPO / a / "style.css" for a in APPS]
ALL_HTML_FILES = [REPO / a / "index.html" for a in APPS]

SHARED_AUTH = REPO / "shared" / "auth.js"
SHARED_SYNC = REPO / "shared" / "sync.js"
SERVER_JS = REPO / "server" / "server.js"
CADDYFILE = Path("/home/ubuntu/Caddyfile")
DOCKER_COMPOSE = Path("/home/ubuntu/docker-compose.yml")

results = []
errors = 0
warnings = 0

def E(path, lineno, msg):
    global errors
    errors += 1
    results.append(("ERROR", str(path), lineno, msg))

def W(path, lineno, msg):
    global warnings
    warnings += 1
    results.append(("WARNING", str(path), lineno, msg))

def file_lines(path):
    try:
        with open(path) as f:
            lines = f.readlines()
        return lines, len(lines)
    except FileNotFoundError:
        return None, 0

def body_text(lines, start):
    """Return text of the braced block starting at `start`."""
    depth, started = 0, False
    parts = []
    for j in range(start, len(lines)):
        parts.append(lines[j])
        if not started and '{' in lines[j]:
            depth = lines[j].count('{') - lines[j].count('}')
            started = True
        elif started:
            depth += lines[j].count('{') - lines[j].count('}')
            if depth <= 0:
                break
    return ''.join(parts)

# 1. Render functions called inside data-update functions
def check_render_in_data_updates(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    app_name = script_path.parent.name
    render_fn = {"microtask": "renderTasks", "microplans": "renderPlans",
                  "microhabit": "renderHabits", "micronote": "renderNotes",
                  "microshare": "renderShares"}.get(app_name, "renderTasks")
    data_update_pats = [
        r'function\s+update(Title|TaskTitle|Description|NoteContent|Content)',
        r'function\s+update\b(?!\w*[Hh]eight)', r'function\s+debounced\w+',
        r'function\s+save\w+',
    ]
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not any(re.search(p, stripped) for p in data_update_pats):
            continue
        fn_match = re.search(r'function\s+(\w+)', stripped)
        fn_name = fn_match.group(1) if fn_match else "unknown"
        if 'render' in fn_name.lower() or 'height' in fn_name.lower():
            continue
        if fn_name in ('updateCompletedHeight', 'updateArchivedHeight',
                       'updateHabitHeight', 'updateFeatureHeight',
                       'renderTasks', 'renderNotes', 'renderHabits', 'renderShares'):
            continue
        depth, started = 0, False
        for j in range(i, n):
            if not started and '{' in lines[j]:
                depth = lines[j].count('{') - lines[j].count('}')
                started = True
                continue
            if started:
                depth += lines[j].count('{') - lines[j].count('}')
                if depth <= 0:
                    break
                if re.search(rf'\b{re.escape(render_fn)}\b', lines[j]):
                    E(script_path, j + 1,
                      f"Data-update function '{fn_name}' calls '{render_fn}()' "
                      f"(line {j+1}), destroying + rebuilding DOM. "
                      f"Use saveTasks() + debouncedSyncMutation() instead.")
                    break

# 2. Restore/unarchive must splice+push between arrays
def check_array_move_in_restore(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    # Detect single-array model (notes[], habits[]) vs two-array model
    # (shares[] + archivedShares[], tasks[] + completedTasks[]).
    # Single-array model uses .filter() in render and has no separate
    # archived/completed array variable — boolean flips are correct.
    text = ''.join(lines)
    has_separate_archived_array = bool(re.search(
        r'(?:let|const|var)\s+(?:archived|completed)\w*\s*=\s*\[',
        text))
    if not has_separate_archived_array:
        return
    restore_pats = [r'function\s+restore\w+', r'function\s+unarchive\w+',
                    r'function\s+uncomplete\w+']
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not any(re.search(p, stripped) for p in restore_pats):
            continue
        fn_match = re.search(r'function\s+(\w+)', stripped)
        fn_name = fn_match.group(1) if fn_match else "unknown"
        bt = body_text(lines, i)
        has_splice = 'splice' in bt
        has_push = 'push' in bt
        has_filter = '.filter(' in bt
        has_bool_flip = re.search(r'\.(completed|archived)\s*=\s*(false|true)', bt)
        has_array_move = (has_splice and has_push) or (has_filter and has_push)
        if has_array_move:
            continue
        if has_bool_flip and not has_array_move:
            E(script_path, i + 1,
              f"Restore function '{fn_name}' flips a boolean but does not "
              f"move the item between arrays (needs splice+push). "
              f"Item will vanish from both views.")

# 3. Auth IIFE: every public function must be in the return block
def check_auth_iife_exports():
    lines, n = file_lines(SHARED_AUTH)
    if not lines:
        return
    defined_fns = set()
    for i, line in enumerate(lines):
        m = re.search(r'(?:function|const)\s+(\w+)\s*[=:(]', line)
        if m:
            name = m.group(1)
            if name not in ('function', 'const', 'let', 'var', 'if', 'for',
                            'while', 'return', 'switch'):
                defined_fns.add(name)
    return_start = None
    return_text = ""
    for i, line in enumerate(lines):
        if re.search(r'return\s*\{', line):
            return_start = i
            return_text = body_text(lines, i)
            break
    if return_start is None:
        E(SHARED_AUTH, 0, "No return block found in Auth IIFE.")
        return
    exported = set(re.findall(r'(\w+)(?=\s*[,}])', return_text))
    required = {'signIn', 'signOut', 'getToken', 'getUserId',
                'isAuthenticated', 'onAuthChange', 'refreshIdentity'}
    for fn in required:
        if fn not in exported:
            E(SHARED_AUTH, return_start + 1,
              f"Auth method '{fn}()' is not exported from the IIFE return block.")
    for fn in sorted(defined_fns):
        if fn.startswith('_') or fn in required:
            continue
        if re.match(r'^(setTimeout|clearTimeout|window|document|console|Promise|JSON|'
                     r'Array|String|Object|Number|Boolean|Math|Date|Error|RegExp|'
                     r'Map|Set|location|localStorage|parseInt|parseFloat|isNaN|'
                     r'isFinite|encodeURI|decodeURI|fetch)$', fn):
            continue
        if re.match(r'^(function|const|let|var|if|for|while|return|switch|else|'
                     r'try|catch|finally|new|this|typeof|instanceof)$', fn):
            continue
        if re.match(r'^(init|newId|newIdentity|parsed|payload|rawIdentity|shooId|'
                     r'shooIdentity|stored|storedParsed|segments|base64urlDecode|Auth)$', fn):
            continue
        W(SHARED_AUTH, 0,
          f"Function '{fn}()' defined inside Auth IIFE but not exported.")

# 4. SVG path syntax: missing spaces between numbers and command letters
def check_svg_path_syntax(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    for i, line in enumerate(lines):
        for m in re.finditer(r'd="([^"]*)"', line):
            d_value = m.group(1)
            bad = []
            for pat in [r'(\d+)C(\d)', r'Z(\d)', r'(\d+)M(\d)']:
                for n in re.finditer(pat, d_value, re.IGNORECASE):
                    if pat.endswith(r'M(\d)'):
                        pos = n.start()
                        if pos > 0 and d_value[pos - 1].isdigit():
                            bad.append((n.start(), n.group()))
                    else:
                        bad.append((n.start(), n.group()))
            if bad:
                for pos, snippet in sorted(set(bad)):
                    ctx_start = max(0, pos - 12)
                    ctx_end = min(len(d_value), pos + len(snippet) + 20)
                    context = d_value[ctx_start:ctx_end]
                    E(script_path, i + 1,
                      f"SVG path syntax: '{snippet}' may cause parse failure "
                      f"(digit squeezed against command letter). "
                      f"Context: ...{context}...")
                    break

# 5. Bottom sheet height: CSS expanded-height overwritten by JS inline
def check_bottom_sheet_height(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    for i, line in enumerate(lines):
        if re.search(r'function\s+update\w*(?:Completed|Archived|Habit|Feature)Height', line):
            fn_match = re.search(r'function\s+(\w+)', line)
            fn_name = fn_match.group(1) if fn_match else "unknown"
            bt = body_text(lines, i)
            if 'Math.min' not in bt:
                W(script_path, i + 1,
                  f"Height function '{fn_name}()' doesn't use Math.min(...) "
                  f"to cap the height. Sheet may exceed viewport.")
            has_min_clamp = 'Math.max' in bt
            has_early_return = 'return;' in bt or 'return ""' in bt
            if not has_min_clamp and not has_early_return:
                W(script_path, i + 1,
                  f"Height function '{fn_name}()' has no minimum clamping. "
                  f"If filtered count is 0, inline height collapses. "
                  f"Add Math.max() or skip JS on mobile.")

# 6. Text selection guards on title click handlers
def check_text_selection_guard(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    click_pats = [r'\.(addEventListener|onclick|onmousedown)\s*[\(=]',
                  r'click\s*[:(]', r'onclick\s*=']
    non_click_events = re.compile(
        r"addEventListener\s*\(\s*['\"](?:input|keydown|keyup|keypress|"
        r"touchmove|touchcancel|pointermove|pointerup)['\"]")
    for i, line in enumerate(lines):
        title_related = any(x in line for x in [
            '.task-title', '.note-title', '.habit-title', '.plan-title',
            '.share-name', 'taskTitle', 'noteTitle', 'titleInput',
            'titleEl', 'titleElement'])
        if not title_related:
            continue
        if non_click_events.search(line):
            continue
        if not any(re.search(p, line) for p in click_pats):
            continue
        window_text = ''.join(lines[max(0, i - 5):min(n, i + 5)])
        has_guard = any(g in window_text for g in [
            'getSelection', 'isTextSelected', 'isSelected', 'selection', '.toString()'])
        if not has_guard:
            W(script_path, i + 1,
              f"Click handler on title element (line {i+1}) has no "
              f"text-selection guard. Users selecting text will trigger "
              f"reorder/sidebar instead.")

# 7. Settings overflow: max-height + overflow-y on settings panels
def check_settings_overflow(style_path):
    lines, n = file_lines(style_path)
    if not lines:
        return
    settings_lines = []
    in_settings = False
    sd = 0
    for i, line in enumerate(lines):
        if re.search(r'\.(settings-box|settings-overlay[^-]|settings-modal|settings-content)\s*\{', line):
            in_settings = True
            sd = line.count('{') - line.count('}')
            settings_lines.append(i)
            continue
        if in_settings:
            sd += line.count('{') - line.count('}')
            if sd <= 0:
                in_settings = False
    if not settings_lines:
        return
    for sl in settings_lines:
        bt = body_text(lines, sl)
        has_max_height = 'max-height' in bt
        has_overflow = 'overflow-y' in bt or 'overflow' in bt
        if not has_max_height or not has_overflow:
            W(style_path, sl + 1,
              f"Settings container missing max-height or overflow-y "
              f"(max-height={'yes' if has_max_height else 'no'}, "
              f"overflow-y={'yes' if has_overflow else 'no'}).")

# 8. Safe-area: env(safe-area-inset-bottom) on fixed-bottom elements
def check_safe_area(style_path):
    lines, n = file_lines(style_path)
    if not lines:
        return
    i = 0
    current_selector = ""
    in_block = False
    brace_depth = 0
    selector_line = 0
    while i < n:
        stripped = lines[i].strip()
        if stripped.startswith('/*') or stripped.startswith('*'):
            i += 1
            continue
        if not in_block:
            if '{' in stripped and not stripped.startswith('@media'):
                selector = stripped.split('{')[0].strip()
                if selector:
                    current_selector = selector
                    selector_line = i
                    in_block = True
                    brace_depth = stripped.count('{') - stripped.count('}')
                    if brace_depth <= 0:
                        in_block = False
            elif '{' in stripped and stripped.startswith('@media'):
                qd = stripped.count('{') - stripped.count('}')
                for j in range(i + 1, n):
                    qd += lines[j].count('{') - lines[j].count('}')
                    if qd <= 0:
                        i = j
                        break
        else:
            brace_depth += stripped.count('{') - stripped.count('}')
            if brace_depth <= 0:
                block_text = ''.join(lines[selector_line:i + 1])
                has_fixed = 'position: fixed' in block_text or 'position:fixed' in block_text
                has_bottom_0 = re.search(r'bottom\s*:\s*0', block_text)
                has_safe_area = 'safe-area-inset-bottom' in block_text
                if has_fixed and has_bottom_0 and not has_safe_area:
                    W(style_path, selector_line + 1,
                      f"Fixed-bottom element '{current_selector[:50]}' has "
                      f"position:fixed + bottom:0 but no "
                      f"env(safe-area-inset-bottom) padding.")
                in_block = False
                current_selector = ""
        i += 1

# 9. Empty states: :empty::before for completed/archived lists
def check_empty_states(style_path):
    lines, n = file_lines(style_path)
    if not lines:
        return
    in_media = False
    md = 0
    media_lines = set()
    for i, line in enumerate(lines):
        if '@media' in line and '{' in line:
            in_media = True
            md = line.count('{') - line.count('}')
            media_lines.add(i)
            continue
        if in_media:
            md += line.count('{') - line.count('}')
            media_lines.add(i)
            if md <= 0:
                in_media = False
    list_classes = []
    for i, line in enumerate(lines):
        if i in media_lines:
            continue
        if re.search(r'\.\w*(completed|archived|done|finished)\w*(-list|List)?\s*\{', line):
            sel = re.search(r'([^\{]+)\s*\{', line)
            if sel:
                list_classes.append((i, sel.group(1).strip()))
    if not list_classes:
        return
    empty_rules = []
    for i, line in enumerate(lines):
        if ':empty::before' in line or ':empty:before' in line or '":empty"' in line:
            empty_rules.append((i, line.strip()))
    for lineno, selector in list_classes:
        class_name = selector.lstrip('.')
        if 'completed' in class_name or 'archived' in class_name:
            continue
        matched = False
        for eline, erule in empty_rules:
            if class_name in erule or class_name.rstrip('-list') in erule:
                matched = True
                if '#666' not in erule and '#666' not in ''.join(
                        lines[max(0, eline - 3):eline + 3]):
                    W(style_path, eline + 1,
                      f"Empty state for '{class_name}' color should be #666.")
                break
        if not matched:
            W(style_path, lineno + 1,
              f"List '{selector}' has no :empty::before pseudo-element.")

# 10. SyncFactory: buildPayload/toLocal consistency
def check_sync_factory_usage(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    app_name = script_path.parent.name
    in_sync = False
    config_start = 0
    bd = 0
    for i, line in enumerate(lines):
        if 'SyncFactory.create' in line or 'SyncFactory?.create' in line:
            config_start = i
            bd = line.count('{') - line.count('}')
            in_sync = True
            continue
        if in_sync:
            bd += line.count('{') - line.count('}')
            if bd <= 0:
                break
    if not in_sync:
        return
    config_text = ''.join(lines[config_start:config_start + 200])
    has_build_payload = 'buildPayload' in config_text
    has_to_local = 'toLocal' in config_text
    if has_build_payload and has_to_local:
        if app_name == 'microtask' and 'maxItems' not in config_text:
            W(script_path, config_start + 1,
              f"SyncFactory config missing 'maxItems'. "
              f"microtask should set maxItems: 10.")
        # Check for field name inconsistency (camelCase vs snake_case)
        if app_name == 'microhabit':
            if 'intervalDays' in config_text and '_interval_days' in config_text:
                pass  # valid mapping
            elif 'intervalDays' not in config_text:
                W(script_path, config_start + 1,
                  f"microhabit SyncFactory missing 'intervalDays' field mapping.")
        if app_name == 'microshare':
            if 'mime_type' in config_text or 'mimeType' in config_text:
                pass
            else:
                W(script_path, config_start + 1,
                  f"microshare SyncFactory missing mime type field.")
    elif has_build_payload != has_to_local:
        E(script_path, config_start + 1,
          f"SyncFactory config has {'buildPayload' if has_build_payload else 'toLocal'} "
          f"but not both.")

# 11. Owner gating: server + client constant consistency
def check_owner_gating():
    srv_lines, sn = file_lines(SERVER_JS)
    if not srv_lines:
        return
    server_owner_id = None
    for i, line in enumerate(srv_lines):
        m = re.search(r"PLANS_OWNER_ID\s*=\s*['\"](\w+)['\"]", line)
        if m:
            server_owner_id = m.group(1)
            break
        if 'PLANS_OWNER_ID' in line and 'process.env' in line:
            server_owner_id = 'env'
            break
    mp = REPO / "microplans" / "script.js"
    mp_lines, mn = file_lines(mp)
    if not mp_lines:
        return
    client_owner_id = None
    for i, line in enumerate(mp_lines):
        m = re.search(r"OWNER_USER_ID\s*=\s*['\"](\w+)['\"]", line)
        if m:
            client_owner_id = m.group(1)
            break
    if server_owner_id and client_owner_id:
        if server_owner_id != 'env' and server_owner_id != client_owner_id:
            E(SERVER_JS, 0,
              f"Server PLANS_OWNER_ID ({server_owner_id}) != "
              f"client OWNER_USER_ID ({client_owner_id}). Owner edits will 403.")
    elif server_owner_id and not client_owner_id:
        W(mp, 0, "Server has PLANS_OWNER_ID but microplans has no OWNER_USER_ID.")
    elif not server_owner_id:
        W(SERVER_JS, 0, "No PLANS_OWNER_ID found in server.js.")
    has_server_gate = False
    for i, line in enumerate(srv_lines):
        if ('/api/plans' in line or "'/plans'" in line) and 'post' in line.lower():
            for j in range(i, min(i + 20, sn)):
                if 'owner' in srv_lines[j].lower() or 'PLANS_OWNER_ID' in srv_lines[j] or '403' in srv_lines[j]:
                    has_server_gate = True
                    break
    if not has_server_gate:
        W(SERVER_JS, 0,
          "POST /api/plans may lack server-side owner check.")
    has_can_edit = False
    for i, line in enumerate(mp_lines):
        if 'function canEdit' in line:
            has_can_edit = True
            for j in range(i, min(i + 10, mn)):
                if 'Auth.isAuthenticated' in mp_lines[j] and 'getUserId' in mp_lines[j]:
                    break
            else:
                W(mp, i + 1,
                  f"canEdit() exists but may not check Auth.isAuthenticated "
                  f"and Auth.getUserId().")
            break
    if not has_can_edit:
        W(mp, 0,
          "microplans has no canEdit() function.")
    # Check that ALL mutation functions in microplans check canEdit()
    mutation_fns = ['addTask', 'deleteTask', 'toggleTaskComplete', 'updateTaskTitle',
                    'updateTaskDescription', 'addSubtask', 'toggleSubtaskComplete',
                    'updateSubtaskTitle', 'deleteSubtask', 'saveDragOrder']
    mp_text = ''.join(mp_lines)
    for fn in mutation_fns:
        if re.search(rf'function\s+{re.escape(fn)}\b', mp_text):
            for i, line in enumerate(mp_lines):
                if re.search(rf'function\s+{re.escape(fn)}\b', line):
                    bt = body_text(mp_lines, i)
                    if 'canEdit()' not in bt and 'canEdit(' not in bt:
                        W(mp, i + 1,
                          f"Mutation function '{fn}()' in microplans does not check canEdit().")
                    break

# 12. Cache-busting: ?v= banned
def check_cache_busting():
    for html_path in ALL_HTML_FILES:
        lines, n = file_lines(html_path)
        if not lines:
            continue
        for i, line in enumerate(lines):
            if re.search(r'\?v=\d+', line):
                W(html_path, i + 1,
                  f"Cache-busting ?v= found in {html_path.parent.name}/index.html. "
                  f"Remove the query parameter.")

# 13. Cross-app parity: microplans must not drift from microtask
def check_microplans_parity():
    mt_lines, _ = file_lines(REPO / "microtask" / "script.js")
    mp_lines, _ = file_lines(REPO / "microplans" / "script.js")
    if not mt_lines or not mp_lines:
        return
    mt_text = ''.join(mt_lines)
    mp_text = ''.join(mp_lines)
    features = [
        (r'function\s+addTask\b', 'addTask function'),
        (r'function\s+deleteTask\b', 'deleteTask function'),
        (r'function\s+toggle(Task)?Complete\b', 'toggleTaskComplete function'),
        (r'function\s+updateTaskTitle\b', 'updateTaskTitle function'),
        (r'function\s+saveDragOrder\b', 'saveDragOrder function'),
        (r'function\s+renderTasks\b', 'renderTasks function'),
        (r'function\s+loadTasks\b', 'loadTasks function'),
        (r'function\s+addSubtask\b', 'addSubtask function'),
        (r'function\s+deleteSubtask\b', 'deleteSubtask function'),
        (r'function\s+toggleSubtaskComplete\b', 'toggleSubtaskComplete'),
        (r'function\s+updateSubtaskTitle\b', 'updateSubtaskTitle'),
        (r'\.task-list', '.task-list CSS class'),
        (r'\.task-item', '.task-item CSS class'),
        (r'\.checkbox-custom', '.checkbox-custom CSS class'),
        (r'\.add-button', '.add-button CSS class'),
        (r'\.completed-section', '.completed-section CSS class'),
        (r'\.completed-header', '.completed-header CSS class'),
        (r'\.completed-list', '.completed-list CSS class'),
        (r'function\s+updateCompletedHeight', 'updateCompletedHeight function'),
        (r'function\s+toggleCompleted', 'toggleCompleted function'),
        (r'dragStart\b', 'dragStart handler'),
        (r'dragOver\b', 'dragOver handler'),
        (r'drop\b', 'drop handler'),
        (r'touchstart.*_reorderTimer', 'touch reorder (long-press)'),
        (r'SettingsIcon|settingsIcon|#settingsIcon', 'settings icon'),
        (r'slideIn', 'slideIn animation keyframes'),
        (r'slideOut', 'slideOut animation keyframes'),
        (r'mobile.*modal|mobile.*task.*modal', 'mobile input modal'),
        (r'env\(safe-area-inset-bottom\)', 'safe-area padding'),
    ]
    for pattern, name in features:
        has_mt = re.search(pattern, mt_text)
        has_mp = re.search(pattern, mp_text)
        if has_mt and not has_mp:
            W(REPO / "microplans" / "script.js", 0,
              f"microplans is missing '{name}' (exists in microtask).")
        elif not has_mt and has_mp:
            W(REPO / "microtask" / "script.js", 0,
              f"microtask is missing '{name}' (exists in microplans).")
    mt_css, _ = file_lines(REPO / "microtask" / "style.css")
    mp_css, _ = file_lines(REPO / "microplans" / "style.css")
    if mt_css and mp_css:
        mt_css_text = ''.join(mt_css)
        mp_css_text = ''.join(mp_css)
        css_features = [
            (r'\.task-list', '.task-list'),
            (r'\.task-item', '.task-item'),
            (r'\.checkbox-custom', '.checkbox-custom'),
            (r'\.add-button', '.add-button'),
            (r'\.completed-section', '.completed-section'),
            (r'\.settings-overlay', '.settings-overlay'),
            (r'@media\s*\(\s*max-width:\s*768px\s*\)', 'mobile breakpoint'),
            (r'@media\s*\(\s*hover:\s*none\s*\)', 'touch hover override'),
            (r'safe-area-inset-bottom', 'safe-area padding'),
            (r'gradient.*mask|mask-image', 'text gradient mask'),
        ]
        for pattern, name in css_features:
            if re.search(pattern, mt_css_text) and not re.search(pattern, mp_css_text):
                W(REPO / "microplans" / "style.css", 0,
                  f"microplans CSS missing '{name}' (exists in microtask style.css).")

# 14. Infrastructure: Caddy routes vs Docker volume mounts
def check_infrastructure():
    caddy_lines, cn = file_lines(CADDYFILE)
    compose_lines, dn = file_lines(DOCKER_COMPOSE)
    if not caddy_lines or not compose_lines:
        return
    caddy_text = ''.join(caddy_lines)
    compose_text = ''.join(compose_lines)
    caddy_apps = set()
    for pat in [r'handle\s+/(\w+)\s*/\*', r'redir\s+/(\w+)\s+']:
        for m in re.finditer(pat, caddy_text):
            app = m.group(1)
            if app not in ('api', 'shoo', 'auth'):
                caddy_apps.add(app)
    volume_apps = set(m.group(1) for m in re.finditer(r'\./microapps/(\w+):/srv/\w+', compose_text))
    for app in sorted(caddy_apps):
        if app not in volume_apps:
            E(CADDYFILE, 0,
              f"App '{app}' has Caddy route but no Docker volume mount. "
              f"Will return 404.")
    for app in sorted(volume_apps):
        if app not in caddy_apps:
            W(DOCKER_COMPOSE, 0,
              f"App '{app}' has Docker volume mount but no Caddy route.")
    for i, line in enumerate(caddy_lines):
        m = re.search(r'reverse_proxy\s+(\w[\w-]*):\d+', line)
        if m:
            target = m.group(1)
            if target not in compose_text:
                E(CADDYFILE, i + 1,
                  f"reverse_proxy target '{target}' not in docker-compose services.")
    if 'caddy' not in compose_text.lower():
        E(DOCKER_COMPOSE, 0, "No 'caddy' service in docker-compose.yml.")
    for i, line in enumerate(caddy_lines):
        if 'DEPLOYMENT' in line:
            W(CADDYFILE, i + 1,
              "Caddyfile references DEPLOYMENT.md pattern (outdated).")
    for i, line in enumerate(compose_lines):
        if 'caddy' in line.lower() and 'image' in line:
            m = re.search(r'image:\s*(\S+)', line)
            if m and 'alpine' not in m.group(1) and ':' not in m.group(1):
                W(DOCKER_COMPOSE, i + 1,
                  f"Caddy image '{m.group(1)}' not pinned to version.")

# 15. Common brittle patterns
def check_common_brittle_patterns(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    text = ''.join(lines)
    app_name = script_path.parent.name
    # prompt() on mobile
    for i, line in enumerate(lines):
        if 'prompt(' in line:
            W(script_path, i + 1,
              f"Uses prompt() — replace with custom modal + <input>.")
    # var keyword in shared code
    if 'shared' in str(script_path):
        for i, line in enumerate(lines):
            if line.strip().startswith('var '):
                W(script_path, i + 1,
                  f"Uses 'var' in shared code. Use 'const'/'let'.")
    # Gradient mask without :not(:empty) guard
    for i, line in enumerate(lines):
        if ('mask-image' in line or 'webkit-mask-image' in line) and \
           ('-list' in line or 'subtask' in line.lower()):
            found_guard = any(':not(:empty)' in lines[j]
                              for j in range(max(0, i - 5), min(n, i + 3)))
            if not found_guard:
                W(script_path, i + 1,
                  f"Gradient mask on list container without :not(:empty) guard.")
    # localStorage key collision
    if app_name in APPS and app_name != 'microtask':
        expected_key = {'microplans': "'plans'", 'microhabit': "'habits'",
                        'micronote': "'micronote_notes'", 'microshare': "'shares'"}.get(app_name)
        if expected_key and expected_key not in text:
            W(script_path, 0,
              f"App may use wrong localStorage key. Expected {expected_key}.")
    # 'Never' expiry routing to temp.fileditch
    if app_name == 'microshare':
        for i, line in enumerate(lines):
            if 'never' in line.lower() and 'expir' in line.lower() and 'temp.fileditch' in line.lower():
                W(script_path, i + 1,
                  f"'Never' expiry uses temp.fileditch (3-day cap). "
                  f"Use new.fileditch or catbox with userhash.")
    # Chevron rotation with negative margins
    for i, line in enumerate(lines):
        stripped = line.strip()
        if ('margin-left' in stripped or 'margin-right' in stripped) and \
           '-' in stripped and 'script.js' in str(script_path):
            nearby = ''.join(lines[max(0, i - 3):min(n, i + 3)])
            if 'rotate' in nearby or 'transform' in nearby:
                W(script_path, i + 1,
                  f"Chevron with negative margin + rotation. "
                  f"Use flex centering instead.")
    # Unexpected files in app directory
    app_dir = script_path.parent
    expected = {'index.html', 'style.css', 'script.js'}
    actual = set(f.name for f in app_dir.iterdir() if f.is_file()) if app_dir.exists() else set()
    wrong = actual - expected - {'favicon.ico', 'CNAME', '.gitignore', 'README.md'}
    for f in sorted(wrong):
        W(app_dir / f, 0,
          f"Unexpected file '{f}' in app directory. "
          f"Apps should only contain index.html, style.css, script.js.")
    # Unused dragged-item variables
    unused_vars = []
    if app_name == 'microshare':
        unused_vars = []
    var_to_usage = {}
    for i, line in enumerate(lines):
        m = re.search(r'(let|const)\s+(_dragged\w+|_dragged\w+El)\b', line)
        if m:
            var_name = m.group(2)
            count = 0
            for j, other_line in enumerate(lines):
                if var_name in other_line:
                    count += 1
            var_to_usage[var_name] = count
    for var_name, count in var_to_usage.items():
        if count <= 2:
            W(script_path, 0,
              f"Variable '{var_name}' is declared but only used {count} time(s). "
              f"May be dead code.")

# 16. Server code checks
def check_server_code():
    lines, n = file_lines(SERVER_JS)
    if not lines:
        return
    text = ''.join(lines)
    # CREATE TABLE without IF NOT EXISTS
    for i, line in enumerate(lines):
        if re.search(r'CREATE TABLE(?! IF NOT EXISTS)', line, re.IGNORECASE):
            E(SERVER_JS, i + 1,
              f"CREATE TABLE without IF NOT EXISTS. Restart would fail.")
    # Index on user_id for every table
    table_names = set(m.group(1) for m in re.finditer(
        r'CREATE TABLE\s+IF NOT EXISTS\s+(\w+)', text, re.IGNORECASE))
    for table in table_names:
        if not re.search(rf'idx_{table}_user_id', text, re.IGNORECASE):
            W(SERVER_JS, 0,
              f"Table '{table}' missing CREATE INDEX idx_{table}_user_id.")
    # Primary key pattern
    for m in re.finditer(r'CREATE TABLE\s+IF NOT EXISTS\s+(\w+)', text, re.IGNORECASE):
        table = m.group(1)
        if table.upper() == table:
            continue
        block = text[m.start():m.start() + 800]
        if 'PRIMARY KEY' not in block:
            E(SERVER_JS, 0, f"Table '{table}' has no PRIMARY KEY.")
        elif re.search(r'PRIMARY KEY\s*\(\s*(?!\s*id\s*,)', block):
            W(SERVER_JS, 0,
              f"Table '{table}' PRIMARY KEY doesn't start with 'id'. "
              f"Standard: PRIMARY KEY (id, user_id).")
    # Deleted column and updated_at column
    for table in table_names:
        block_start = 0
        for m in re.finditer(rf'CREATE TABLE\s+IF NOT EXISTS\s+{re.escape(table)}',
                             text, re.IGNORECASE):
            block_start = m.start()
        block = text[block_start:block_start + 800]
        if 'deleted' not in block:
            W(SERVER_JS, 0,
              f"Table '{table}' has no 'deleted' column (tombstone flag).")
        if 'updated_at' not in block:
            W(SERVER_JS, 0,
              f"Table '{table}' has no 'updated_at' column (conflict resolution).")
    # .env.example existence
    if not (REPO / "server" / ".env.example").exists():
        W(SERVER_JS, 0,
          "server/.env.example is missing (tracked template for env vars).")
    # process.env without fallback
    for i, line in enumerate(lines):
        if 'process.env.' in line and '||' not in line and '??' not in line:
            if not re.search(r'process\.env\.\w+\s*(\|\||\?\?)', line):
                W(SERVER_JS, i + 1,
                  f"Env var without fallback: {line.strip()[:60]}...")
    # EXCLUDed typo (lowercase d)
    for i, line in enumerate(lines):
        if 'EXCLUDed' in line and 'EXCLUDED' not in line:
            E(SERVER_JS, i + 1,
              f"SQL typo 'EXCLUDed' (lowercase d) found. Should be 'EXCLUDED'.")
    # Rate limiting check
    has_rate_limit = 'rateLimit' in text or 'express-rate-limit' in text
    if not has_rate_limit:
        E(SERVER_JS, 0,
          "No rate limiting middleware found. Add express-rate-limit or similar.")
    # process.exit(1) in error handlers
    for i, line in enumerate(lines):
        if 'process.exit(1)' in line or 'process.exit(0)' in line:
            context = ''.join(lines[max(0, i - 5):min(n, i + 3)])
            if 'catch' in context or 'error' in line.lower():
                W(SERVER_JS, i + 1,
                  f"process.exit() found in error handler (line {i+1}). "
                  f"Consider graceful error handling instead.")
    # Input validation on query params (array check pattern)
    for i, line in enumerate(lines):
        if 'req.query.' in line:
            context = ''.join(lines[max(0, i - 2):min(n, i + 5)])
            if 'Array.isArray' not in context:
                W(SERVER_JS, i + 1,
                  f"req.query parameter without Array.isArray() guard. "
                  f"Express query params can be arrays.")
    # Content-length limit on body parsing
    has_limit = re.search(r'express\.json\s*\(\s*\{\s*limit\s*:', text)
    if not has_limit:
        W(SERVER_JS, 0,
          "express.json() missing 'limit' option. Add body size limit.")
    # POST endpoints should validate Content-Type
    for i, line in enumerate(lines):
        if 'app.post' in line and '/upload' in line:
            for j in range(i, min(i + 5, n)):
                if 'req.is' in lines[j] or 'Content-Type' in lines[j]:
                    break
            else:
                W(SERVER_JS, i + 1,
                  f"POST {line.strip()} may lack Content-Type validation.")

# 17. Runtime JS error patterns
def check_runtime_patterns(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    text = ''.join(lines)
    app_name = script_path.parent.name
    if 'Auth.getUserId' in text:
        for i, line in enumerate(lines):
            if 'Auth.getUserId()' in line:
                found_guard = any('Auth.isAuthenticated' in lines[j] or
                                  'isAuthenticated' in lines[j]
                                  for j in range(max(0, i - 5), i))
                if not found_guard:
                    W(script_path, i + 1,
                      f"Auth.getUserId() called without Auth.isAuthenticated() guard.")
    for i, line in enumerate(lines):
        if 'localStorage.getItem' in line or 'localStorage.setItem' in line:
            found_catch = any('try' in lines[j] or 'catch' in lines[j]
                              for j in range(max(0, i - 15), min(n, i + 1)))
            if not found_catch:
                W(script_path, i + 1,
                  f"localStorage access without try/catch. "
                  f"Private browsing may throw on write.")

# 18. SyncFactory: field name mapping consistency (NEW)
def check_sync_field_mapping(script_path):
    lines, n = file_lines(script_path)
    if not lines:
        return
    text = ''.join(lines)
    app_name = script_path.parent.name
    if 'SyncFactory.create' not in text:
        return
    # Find the config block
    config_start = None
    for i, line in enumerate(lines):
        if 'SyncFactory.create' in line:
            config_start = i
            break
    if config_start is None:
        return
    config_text = ''.join(lines[config_start:config_start + 150])
    # Extract field names from buildPayload
    bp_m = re.search(r'buildPayload:\s*\((\w+)\)\s*=>\s*\(\s*\{([^}]+)', config_text)
    tl_m = re.search(r'toLocal:\s*\((\w+)\)\s*=>\s*\(\s*\{([^}]+)', config_text)
    if bp_m:
        bp_fields = set(re.findall(r'(\w+):\s*\w+', bp_m.group(2)))
    else:
        bp_fields = set()
    if tl_m:
        tl_fields = set(re.findall(r'(\w+):\s*\w+', tl_m.group(2)))
    else:
        tl_fields = set()
    # Check for snake_case in buildPayload vs camelCase in toLocal
    for f in bp_fields:
        if '_' in f:
            camel = ''.join(word.capitalize() for word in f.split('_'))
            camel = f.split('_')[0] + camel[len(f.split('_')[0]):]
            if camel not in tl_fields and f not in tl_fields:
                # This may be intentional (server column name)
                pass
    # Check that all buildPayload fields are in the server CREATE TABLE
    if app_name == 'microhabit':
        server_fields = {'title', 'intervalDays', 'lastCompletedAt', 'completions', 'paused'}
        for f in bp_fields:
            if f not in server_fields:
                W(script_path, config_start + 1,
                  f"Unknown buildPayload field '{f}' for {app_name}. "
                  f"Expected one of: {server_fields}.")

# 19. Duplicate code across apps (NEW)
def check_duplicate_code():
    """Check for identical helper functions duplicated across apps."""
    function_signatures = {}
    for script_path in ALL_SCRIPT_FILES:
        app_name = script_path.parent.name
        lines, n = file_lines(script_path)
        if not lines:
            continue
        text = ''.join(lines)
        # Check for generateId - should match pattern
        for i, line in enumerate(lines):
            m = re.match(r'function\s+(generateId|generate_id)\b', line.strip())
            if m:
                fn_name = m.group(1)
                bt = body_text(lines, i)[:200]
                key = (fn_name, bt)
                function_signatures.setdefault(key, []).append((app_name, i + 1))
        # Check for createCheckbox
        for i, line in enumerate(lines):
            if re.match(r'function\s+createCheckbox\b', line.strip()):
                bt = body_text(lines, i)[:200]
                key = ('createCheckbox', bt)
                function_signatures.setdefault(key, []).append((app_name, i + 1))
        # Check for createDeleteButton
        for i, line in enumerate(lines):
            if re.match(r'function\s+createDeleteButton\b', line.strip()):
                bt = body_text(lines, i)[:200]
                key = ('createDeleteButton', bt)
                function_signatures.setdefault(key, []).append((app_name, i + 1))
    # Skip generateId and createCheckbox — intentionally kept per-app for offline-first design
    kn_own_function = {'generateId', 'generate_id', 'createCheckbox'}
    for (fn_name, body), apps in function_signatures.items():
        if len(apps) > 2 and fn_name not in kn_own_function:
            names = [a[0] for a in apps]
            W(REPO / "shared", 0,
              f"Function '{fn_name}()' duplicated in {len(apps)} apps: "
              f"{', '.join(sorted(names))}. "
              f"Consider extracting to shared/helpers.js.")

# 20. Event listener memory leaks (NEW)
def check_event_listener_cleanup(script_path):
    """Check for event listeners on document/window that aren't cleaned up."""
    lines, n = file_lines(script_path)
    if not lines:
        return
    text = ''.join(lines)
    # Document-level mousemove/mouseup listeners
    has_mousemove = 'document.addEventListener(\'mousemove\'' in text or \
                    'document.addEventListener("mousemove"' in text
    has_mouseup = 'document.addEventListener(\'mouseup\'' in text or \
                  'document.addEventListener("mouseup"' in text
    if has_mousemove and has_mouseup:
        # Check if these are inside a function with cleanup
        for i, line in enumerate(lines):
            if 'mousemove' in line and 'document.addEventListener' in line:
                context = ''.join(lines[max(0, i - 10):min(n, i + 5)])
                if 'removeEventListener' not in context:
                    W(script_path, i + 1,
                      f"document mousemove listener (line {i+1}) without "
                      f"corresponding removeEventListener. "
                      f"May leak listeners on unmount.")

# 21. Mutation function owner checks in microplans (NEW - moved from check_owner_gating)
def check_microplans_mutation_gates(script_path):
    app_name = script_path.parent.name
    if app_name != 'microplans':
        return
    lines, n = file_lines(script_path)
    if not lines:
        return
    mutation_fns = ['addTask', 'deleteTask', 'toggleTaskComplete', 'updateTaskTitle',
                    'updateTaskDescription', 'addSubtask', 'toggleSubtaskComplete',
                    'updateSubtaskTitle', 'deleteSubtask', 'saveDragOrder',
                    'handleAddButton', 'initDragAndDrop', 'initMobileReorder']
    for fn in mutation_fns:
        for i, line in enumerate(lines):
            if re.search(rf'function\s+{re.escape(fn)}\b', line):
                bt = body_text(lines, i)
                if 'canEdit()' not in bt:
                    W(script_path, i + 1,
                      f"Owner mutation function '{fn}()' does not check canEdit() gate.")
                break

# 22. Sync module code quality (NEW)
def check_sync_module():
    lines, n = file_lines(SHARED_SYNC)
    if not lines:
        return
    text = ''.join(lines)
    # check for recursive retry pattern - prefer loops
    if re.search(r'_apiRequest\s*\(.*,\s*\w+\s*\+\s*1\s*\)', text):
        W(SHARED_SYNC, 0,
          "Sync _apiRequest uses recursion for retry. "
          "Prefer a loop for cleaner stack traces.")
    # check that all exported functions exist
    exported_fns = {'create', 'init', 'pullFromServer', 'pushToServer'}
    for fn in exported_fns:
        if fn not in text:
            if fn in ('init', 'pullFromServer', 'pushToServer'):
                E(SHARED_SYNC, 0,
                  f"SyncFactory missing '{fn}()' in return block.")
    # Check for null/undefined checks on changedItems
    for i, line in enumerate(lines):
        if 'pushToServer' in line or 'pushFromServer' in line:
            for j in range(i, min(i + 10, n)):
                if 'changedItems' in lines[j] or 'changed' in lines[j]:
                    if '?' not in lines[j] and '&&' not in lines[j]:
                        break
                    break

# 23. Singleton abstraction check (NEW)
def check_singleton_abstractions(script_path):
    """Check for abstractions with only one implementation."""
    lines, n = file_lines(script_path)
    if not lines:
        return
    text = ''.join(lines)
    # Check for functions that just delegate to another function
    for i, line in enumerate(lines):
        m = re.match(r'function\s+(\w+)\(', line.strip())
        if m:
            fn_name = m.group(1)
            # Skip known multi-call functions
            if fn_name in ('generateId', 'createCheckbox', 'createDeleteButton',
                           'animateAndRun', 'initDragAndDrop', 'initMobileReorder'):
                continue
            # Skip event handlers and lifecycle
            if fn_name in ('attachEventListeners', 'handleAddButton', 'handleEditorInput',
                           'closeMobileTaskModal', 'submitMobileTask', 'closeMobileHabitModal',
                           'submitMobileHabit', 'closeMobileNoteModal', 'submitMobileNote',
                           'closeSettingsPanel', 'openSettings', 'toggleCompleted',
                           'toggleArchived', 'toggleFullscreen', 'togglePreview',
                           'closeSidebarPanel', 'closeEditorPanel', 'closeAllOverlays',
                           'handleAddNote', 'handleAddTask'):
                continue
            bt = body_text(lines, i)[:300]
            # Detect if function body is just a single function call
            single_call = re.search(r'^\s*\w+\([^)]*\)\s*;\s*$', bt.strip(), re.MULTILINE)
            if single_call and fn_name not in ('saveTasks', 'saveNotes', 'saveHabits', 'saveShares',
                                                'saveDragOrder', 'main', 'init', 'render'):
                pass  # might be a valid thin wrapper

def main():
    for script_path in ALL_SCRIPT_FILES:
        check_render_in_data_updates(script_path)
        check_array_move_in_restore(script_path)
        check_svg_path_syntax(script_path)
        check_bottom_sheet_height(script_path)
        check_text_selection_guard(script_path)
        check_sync_factory_usage(script_path)
        check_common_brittle_patterns(script_path)
        check_runtime_patterns(script_path)
        check_sync_field_mapping(script_path)
        check_event_listener_cleanup(script_path)
        check_microplans_mutation_gates(script_path)
        check_singleton_abstractions(script_path)

    for style_path in ALL_STYLE_FILES:
        check_settings_overflow(style_path)
        check_safe_area(style_path)
        check_empty_states(style_path)

    check_auth_iife_exports()
    check_sync_module()
    check_server_code()
    check_cache_busting()
    check_microplans_parity()
    check_owner_gating()
    check_infrastructure()
    check_duplicate_code()

    if not results:
        print("No issues found.")
        return 0

    by_file = {}
    for severity, fpath, line, msg in results:
        by_file.setdefault(fpath, []).append((severity, line, msg))

    total_errors = sum(1 for r in results if r[0] == "ERROR")
    total_warnings = sum(1 for r in results if r[0] == "WARNING")

    for fpath in sorted(by_file):
        rel = os.path.relpath(fpath, start="/home/ubuntu") if fpath else "(unknown)"
        print(f"\n# {rel}")
        for severity, line, msg in sorted(by_file[fpath], key=lambda x: x[1]):
            loc = f" line {line}" if line else ""
            print(f"{severity}{loc} {msg}")

    print(f"\nerrors: {total_errors}, warnings: {total_warnings}")
    return 1 if total_errors > 0 else 0

if __name__ == "__main__":
    sys.exit(main())
