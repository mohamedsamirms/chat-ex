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

// Newly Added Target Controls
const plusBtn = document.getElementById('plus-btn');
const fileAttachmentInput = document.getElementById('file-attachment-input');
const gifToggleBtn = document.getElementById('gif-toggle-btn');
const gifPopover = document.getElementById('gif-popover');
const gifSearchField = document.getElementById('gif-search-field');
const gifResultsGrid = document.getElementById('gif-results-grid');

let localClientUsername = '';
let remoteTypingTimeout;
let isCurrentlyTyping = false;
let localTypingCooldown;

// GIPHY API Public Key configuration reference
const GIPHY_API_KEY = "dc6zaTOxFJmzC"; 

// --- FEATURE: INITIAL USERNAME AUTO-FILL RETRIEVAL ---
document.addEventListener('DOMContentLoaded', () => {
    const cachedName = localStorage.getItem('chat_saved_username');
    if (cachedName) {
        localClientUsername = cachedName.toUpperCase();
        usernameInput.value = localClientUsername;
        usernameModal.classList.add('hidden');
        chatInput.focus();
    }
});

// Name assignment logic
usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cleanValue = usernameInput.value.trim();
    if (cleanValue) {
        localClientUsername = cleanValue.toUpperCase();
        
        // Save name value into storage cache permanently
        localStorage.setItem('chat_saved_username', localClientUsername);
        
        usernameModal.classList.add('hidden');
        chatInput.focus();
    }
});

settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    newUsernameInput.value = localClientUsername;
    newUsernameInput.focus();
});

settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const changedValue = newUsernameInput.value.trim();
    if (changedValue) {
        localClientUsername = changedValue.toUpperCase();
        
        // Sync updated modifications back into storage cache
        localStorage.setItem('chat_saved_username', localClientUsername);
        
        settingsModal.classList.add('hidden');
    }
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

// --- FEATURE: FILE ATTACHMENT DRIVERS ---
plusBtn.addEventListener('click', () => {
    fileAttachmentInput.click();
});

fileAttachmentInput.addEventListener('change', (e) => {
    const activeFile = e.target.files[0];
    if (!activeFile || !localClientUsername) return;

    const fileReader = new FileReader();
    fileReader.onload = function(event) {
        socket.emit('chat message', {
            username: localClientUsername,
            type: 'file',
            text: event.target.result, // Contains the Base64 DataURL
            filename: activeFile.name,
            fileType: activeFile.type
        });
    };
    fileReader.readAsDataURL(activeFile);
    e.target.value = ''; // Flush file stream input array buffer
});

// --- FEATURE: GIPHY COMPONENT ENGINE ---
gifToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = gifPopover.classList.contains('hidden');
    if (isHidden) {
        gifPopover.classList.remove('hidden');
        fetchTrendingGifs();
    } else {
        gifPopover.classList.add('hidden');
    }
});

// Avoid panel dismissal while utilizing text inputs within the popup context overlay frame
gifPopover.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => gifPopover.classList.add('hidden'));

let searchDebounceTimer;
gifSearchField.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const searchString = e.target.value.trim();
    
    searchDebounceTimer = setTimeout(() => {
        if (searchString) {
            queryGiphySearch(searchString);
        } else {
            fetchTrendingGifs();
        }
    }, 400);
});

async function fetchTrendingGifs() {
    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=9&rating=g`;
    try {
        const response = await fetch(url);
        const parsed = await response.json();
        populateGifGrid(parsed.data);
    } catch (err) {
        console.error("Giphy target connection error:", err);
    }
}

async function queryGiphySearch(term) {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(term)}&limit=9&offset=0&rating=g&lang=en`;
    try {
        const response = await fetch(url);
        const parsed = await response.json();
        populateGifGrid(parsed.data);
    } catch (err) {
        console.error("Giphy query error:", err);
    }
}

function populateGifGrid(gifObjectsArray) {
    gifResultsGrid.innerHTML = '';
    if (!gifObjectsArray || gifObjectsArray.length === 0) {
        gifResultsGrid.innerHTML = '<div style="font-size:0.75rem; text-align:center; padding:10px; color:#000;">NO GIFS FOUND</div>';
        return;
    }
    
    gifObjectsArray.forEach(gifItem => {
        const outputSourceUrl = gifItem.images.fixed_height.url;
        const thumbnailSourceUrl = gifItem.images.fixed_height_small.url;
        
        const imgElement = document.createElement('img');
        imgElement.src = thumbnailSourceUrl;
        imgElement.style.width = "100%";
        imgElement.style.height = "75px";
        imgElement.style.objectFit = "cover";
        imgElement.style.cursor = "pointer";
        
        imgElement.addEventListener('click', () => {
            if (!localClientUsername) return;
            socket.emit('chat message', {
                username: localClientUsername,
                type: 'gif',
                url: outputSourceUrl
            });
            gifPopover.classList.add('hidden');
            gifSearchField.value = '';
        });
        
        gifResultsGrid.appendChild(imgElement);
    });
}

// Message Outbound Event Sender
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const textMsg = chatInput.value.trim();
    if (textMsg && localClientUsername) {
        socket.emit('chat message', {
            username: localClientUsername,
            type: 'text',
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
    messageItem.setAttribute('data-message-id', msg.id);
    
    if (msg.username === localClientUsername) {
        messageItem.style.alignSelf = 'flex-end';
        messageItem.style.alignItems = 'flex-end';
    }

    // Adapt layout context blocks by rendering raw text, interactive downloaded items, or media blocks
    let innerContentHtml = '';
    
    if (!msg.type || msg.type === 'text') {
        innerContentHtml = `<div class="msg-bubble">${msg.text}</div>`;
    } 
    else if (msg.type === 'gif') {
        innerContentHtml = `<div class="msg-bubble" style="padding: 8px;"><img src="${msg.url}" style="max-width: 100%; border-radius: 12px; display: block;" alt="GIF content"></div>`;
    } 
    else if (msg.type === 'file') {
        if (msg.fileType && msg.fileType.startsWith('image/')) {
            innerContentHtml = `<div class="msg-bubble" style="padding: 8px;"><img src="${msg.text}" style="max-width: 100%; border-radius: 12px; display: block;" alt="Uploaded Attachment"><div style="font-size:0.75rem; color:#444; margin-top:4px; text-align:center;">${msg.filename}</div></div>`;
        } else {
            innerContentHtml = `
                <div class="msg-bubble" style="font-size: 1rem; padding: 14px 20px;">
                    <a href="${msg.text}" download="${msg.filename}" style="color: #000; text-decoration: underline; display: flex; align-items: center; gap: 8px;">
                        📁 DOWNLOAD FILE:<br>${msg.filename.toUpperCase()}
                    </a>
                </div>`;
        }
    }

    const deleteButtonHtml = msg.username === localClientUsername ? 
        `<button class="msg-delete-btn" title="Delete message">✕</button>` : '';

    messageItem.innerHTML = `
        <div style="display: flex; gap: 8px; align-items: flex-start;">
            ${innerContentHtml}
            ${deleteButtonHtml}
        </div>
        <div class="msg-meta">
            <span>${msg.username}</span>
            <span>${msg.time}</span>
        </div>
    `;
    
    // Add delete button event listener
    if (msg.username === localClientUsername) {
        const deleteBtn = messageItem.querySelector('.msg-delete-btn');
        deleteBtn.addEventListener('click', () => {
            socket.emit('delete message', { id: msg.id });
        });
    }
    
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

// Handle message deletion
socket.on('message deleted', (data) => {
    const messageElement = messagesList.querySelector(`[data-message-id="${data.id}"]`);
    if (messageElement) {
        messageElement.remove();
    }
    
    // If no messages left, show empty state
    if (messagesList.children.length === 0 && emptyState) {
        emptyState.classList.remove('hidden');
    }
});