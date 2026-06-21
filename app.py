# MUST BE AT THE ABSOLUTE TOP OF THE FILE BEFORE ANY OTHER IMPORTS
import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO, emit
import os
import json
from datetime import datetime

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

@socketio.on('chat message')
def handle_message(data):
    current_time = datetime.now().strftime("%I:%M, %m/%d").lstrip("0")
    
    msg_obj = {
        'username': data.get('username', 'ANONYMOUS'),
        'text': data.get('text', ''),
        'time': current_time
    }
    
    chat_history.append(msg_obj)
    
    # Save directly to file
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(chat_history, f, indent=4)
    except Exception as e:
        print(f"Error saving message to JSON: {e}")
        
    # Broadcast to all connected browsers instantly
    emit('chat message', msg_obj, broadcast=True)

@socketio.on('typing')
def handle_typing(username):
    # Broadcast real-time typing alerts to everyone else instantly
    emit('typing', username, broadcast=True, include_self=False)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)