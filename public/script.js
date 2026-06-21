const socket = io();

// UI Elements Registration
const usernameModal = document.getElementById('username-modal');
const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('username-input');

const settingsModal = document.getElementById('settings-modal');
const settingsBtn = document.getElementById('settings-btn');
const settingsForm = document.getElementById('settings-form');
const newUsernameInput = document.getElementById('new-username-input');

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const messagesList = document.getElementById('messages');
const emptyState = document.getElementById('empty-state');
const activeCount = document.getElementById('active-count');
const typingIndicator = document.getElementById('typing-indicator');

let localClientUsername = '';
let remoteTypingTimeout;
let isCurrentlyTyping = false;
let localTypingCooldown;

// Name assignment logic
usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cleanValue = usernameInput.value.trim();
    if (cleanValue) {
        localClientUsername = cleanValue.toUpperCase();
        usernameModal.classList.add('hidden');
        chatInput.focus();
    }
});

settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    newUsernameInput.value = '';
    newUsernameInput.focus();
});

settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const changedValue = newUsernameInput.value.trim();
    if (changedValue) {
        localClientUsername = changedValue.toUpperCase();
        settingsModal.classList.add('hidden');
    }
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

// Message Outbound Event Sender
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const textMsg = chatInput.value.trim();
    if (textMsg && localClientUsername) {
        socket.emit('chat message', {
            username: localClientUsername,
            text: textMsg
        });
        chatInput.value = '';
        isCurrentlyTyping = false;
    }
});

// Throttled Typing Indicator broadcast
chatInput.addEventListener('input', () => {
    if (!localClientUsername) return;

    if (!isCurrentlyTyping) {
        isCurrentlyTyping = true;
        socket.emit('typing', localClientUsername);
    }

    // Reset cooldown window
    clearTimeout(localTypingCooldown);
    localTypingCooldown = setTimeout(() => {
        isCurrentlyTyping = false;
    }, 1500);
});

// Shared Renderer block
function renderMessageItem(msg) {
    if (emptyState) {
        emptyState.classList.add('hidden');
    }
    
    const messageItem = document.createElement('li');
    messageItem.classList.add('message-wrapper');
    
    if (msg.username === localClientUsername) {
        messageItem.style.alignSelf = 'flex-end';
        messageItem.style.alignItems = 'flex-end';
    }

    messageItem.innerHTML = `
        <div class="msg-bubble">${msg.text}</div>
        <div class="msg-meta">
            <span>${msg.username}</span>
            <span>${msg.time}</span>
        </div>
    `;
    
    messagesList.appendChild(messageItem);
}

// --- SOCKET SOCKET STREAM PIPELINES ---

// Process full initial database sync package loaded from messages.json
socket.on('message history', (historyArray) => {
    messagesList.innerHTML = '';
    if (historyArray && historyArray.length > 0) {
        historyArray.forEach(msg => renderMessageItem(msg));
        const chatContainer = messagesList.parentElement;
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});

// Catch instant real-time incoming messages
socket.on('chat message', (msg) => {
    renderMessageItem(msg);
    const chatContainer = messagesList.parentElement;
    chatContainer.scrollTop = chatContainer.scrollHeight;
});

socket.on('update active users', (count) => {
    activeCount.textContent = `${count} ACTIVE`;
});

// Catch real-time active typing packets
socket.on('typing', (username) => {
    typingIndicator.textContent = `${username} IS TYPING...`;
    typingIndicator.classList.remove('hidden');
    
    // Automatically fade out the indicator if they stop typing for 2 seconds
    clearTimeout(remoteTypingTimeout);
    remoteTypingTimeout = setTimeout(() => {
        typingIndicator.classList.add('hidden');
    }, 2000);
});