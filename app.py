# MUST BE AT THE ABSOLUTE TOP OF THE FILE BEFORE ANY OTHER IMPORTS
import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO, emit
import os
import json
from datetime import datetime
import re
import time


app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'chunky_arcade_secret_key_1337'

# Force eventlet mode explicitly now that monkey-patching is active
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

active_users = 0
DATA_FILE = 'messages.json'
chat_history = []

# Load history from json database file if it exists
if os.path.exists(DATA_FILE):
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            chat_history = json.load(f)
    except Exception as e:
        print(f"Error reading JSON history: {e}")
        chat_history = []

@app.route('/')
def index():
    return app.send_static_file('index.html')

@socketio.on('connect')
def handle_connect():
    global active_users
    active_users += 1
    emit('update active users', active_users, broadcast=True)
    # Instantly sync historical posts on page load
    emit('message history', chat_history)

@socketio.on('disconnect')
def handle_disconnect():
    global active_users
    active_users -= 1
    emit('update active users', active_users, broadcast=True)

# Basic anti-nuke + input validation.
# Goal: prevent “run code via chat” (XSS) and block obvious nuking attempts.
ALLOWED_MESSAGE_TYPES = {'text', 'gif', 'file'}
MAX_USERNAME_LEN = 24
MAX_TEXT_LEN = 2000
MAX_FILENAME_LEN = 128
MAX_URL_LEN = 2048
MAX_HISTORY_LEN = 500

NUKE_KEYWORDS = [
    'nuclear', 'nuke', 'exploit', 'rce', 'shell', 'reverse shell',
    'proc', 'cmd', 'powershell', 'bash', 'curl', 'wget', 'base64',
    '<script', '</script', 'javascript:', 'onerror=', 'onload=', 'onmouseover='
]

# Very small heuristic filter for XSS vectors.
# (Defense-in-depth; client side also stops using innerHTML.)
SUSPICIOUS_XSS_RE = re.compile(
    r"(<\/?\w+[^>]*>)|(javascript:)|(on\w+\s*=)|(\beval\b)|(new\s+Function\b)",
    re.IGNORECASE,
)

def _safe_str(v, max_len):
    if v is None:
        return ''
    s = str(v)
    s = s.replace('\x00', '')
    return s[:max_len]

def _blocked_by_keywords(text: str) -> bool:
    t = (text or '').lower()
    return any(k in t for k in NUKE_KEYWORDS)

def _sanitize_text_only(plain: str) -> str:
    # Reject common tag-based payloads.
    if _blocked_by_keywords(plain) or SUSPICIOUS_XSS_RE.search(plain or ''):
        raise ValueError('blocked')
    # Remove any angle brackets just in case.
    return (plain or '').replace('<', '').replace('>', '')[:MAX_TEXT_LEN]

def _is_safe_url(url: str) -> bool:
    u = (url or '').strip()
    if len(u) > MAX_URL_LEN:
        return False
    # Only allow http(s) URLs.
    if not (u.startswith('http://') or u.startswith('https://')):
        return False
    # Block inline-script-ish vectors.
    if _blocked_by_keywords(u) or SUSPICIOUS_XSS_RE.search(u):
        return False
    return True

def _sanitize_gif_url(url: str) -> str:
    if not _is_safe_url(url):
        raise ValueError('blocked')
    return url

def _sanitize_file_payload(payload: dict) -> tuple[str, str, str]:
    # For safety, only allow image data URLs.
    file_type = _safe_str(payload.get('fileType'), 64).lower()
    filename = _safe_str(payload.get('filename'), MAX_FILENAME_LEN)
    data_url = payload.get('text', '')

    if not file_type.startswith('image/'):
        raise ValueError('blocked')

    if not isinstance(data_url, str):
        raise ValueError('blocked')

    # Allow only data:image/...;base64,...
    # This prevents arbitrary HTML/JS or javascript: urls being used.
    if not data_url.startswith('data:image/'):
        raise ValueError('blocked')
    if ';base64,' not in data_url:
        raise ValueError('blocked')
    if _blocked_by_keywords(filename) or SUSPICIOUS_XSS_RE.search(filename):
        raise ValueError('blocked')
    if _blocked_by_keywords(data_url) or SUSPICIOUS_XSS_RE.search(data_url):
        raise ValueError('blocked')

    return filename, file_type, data_url

# very small in-memory rate limiting (anti-nuke spam)
_last_msg_ts_by_sid = {}
_last_delete_ts_by_sid = {}
_last_typing_ts_by_sid = {}

@socketio.on('chat message')
def handle_message(data):
    current_time = datetime.now().strftime("%I:%M, %m/%d").lstrip("0")

    sid = None
    try:
        # eventlet/socketio provides request context; this is best-effort.
        from flask import request
        sid = getattr(request, 'sid', None)
    except Exception:
        sid = None

    now = time.time()
    if sid is not None:
        last = _last_msg_ts_by_sid.get(sid, 0)
        # 1 msg per 500ms per socket (coarse throttle)
        if now - last < 0.5:
            return
        _last_msg_ts_by_sid[sid] = now

    if not isinstance(data, dict):
        return

    msg_type = _safe_str(data.get('type', 'text'), 16).lower()
    if msg_type not in ALLOWED_MESSAGE_TYPES:
        return

    username = _safe_str(data.get('username', 'ANONYMOUS'), MAX_USERNAME_LEN).upper()
    if _blocked_by_keywords(username) or SUSPICIOUS_XSS_RE.search(username):
        username = 'ANONYMOUS'

    msg_obj = {
        'id': len(chat_history),
        'username': username,
        'type': msg_type,
        'text': '',
        'url': '',
        'filename': '',
        'fileType': '',
        'time': current_time
    }

    try:
        if msg_type == 'text':
            msg_obj['text'] = _sanitize_text_only(data.get('text', ''))
        elif msg_type == 'gif':
            msg_obj['url'] = _sanitize_gif_url(data.get('url', ''))
        elif msg_type == 'file':
            filename, file_type, data_url = _sanitize_file_payload(data)
            msg_obj['fileType'] = file_type
            msg_obj['filename'] = filename
            msg_obj['text'] = data_url
    except ValueError:
        # Anti-nuke: block the message silently
        return

    # Keep history bounded to avoid memory/file blowups
    chat_history.append(msg_obj)
    if len(chat_history) > MAX_HISTORY_LEN:
        chat_history = chat_history[-MAX_HISTORY_LEN:]

    # Save directly to file
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(chat_history, f, indent=4)
    except Exception as e:
        print(f"Error saving message to JSON: {e}")

    emit('chat message', msg_obj, broadcast=True)


@socketio.on('delete message')
def handle_delete_message(data):
    msg_id = data.get('id')
    if msg_id is not None and 0 <= msg_id < len(chat_history):
        # Remove the message
        chat_history.pop(msg_id)
        
        # Reassign IDs to remaining messages
        for idx, msg in enumerate(chat_history):
            msg['id'] = idx
        
        # Save updated history to file
        try:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(chat_history, f, indent=4)
        except Exception as e:
            print(f"Error saving after deletion: {e}")
        
        # Broadcast deletion to all clients
        emit('message deleted', {'id': msg_id}, broadcast=True)

@socketio.on('typing')
def handle_typing(username):
    # Broadcast real-time typing alerts to everyone else instantly
    emit('typing', username, broadcast=True, include_self=False)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)