const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA'; // <--- REPLACE THIS
const ROOM_ID = document.location.pathname.split('/').pop();
const IS_ADMIN = document.getElementById('add-to-queue-controls') === null; // Logic inverted, but this element is now gone. Let's find a better way. The Jinja template still tells us.
const IS_ADMIN_FLAG = document.querySelector('p:not(.text-blue-400) > .text-purple-400') !== null; // A robust way to check if the user is admin based on the welcome text.

// --- DOM Elements ---
const urlInput = document.getElementById('youtube-url');
const addToQueueBtn = document.getElementById('add-to-queue-btn');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const userListContainer = document.getElementById('user-list');
const participantCount = document.getElementById('participant-count');
const queueListContainer = document.getElementById('queue-list');
const waitingOverlay = document.getElementById('waiting-overlay');
const playerWrapper = document.getElementById('player-wrapper');
// Viewer-specific controls
const fullscreenBtn = document.getElementById('fullscreen-btn');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeOnIcon = document.getElementById('volume-on-icon');
const volumeOffIcon = document.getElementById('volume-off-icon');

// --- State ---
let player;
let isEventFromAbly = false;
let isYouTubeApiReady = false;
let currentVideoId = null;
let lastPlayerState = -1;
let NICKNAME;
let lastVolume = 100;
let videoQueue = []; // NEW: The shared video queue

// --- Helper Functions ---
function getUserNickname() {
    if (IS_ADMIN_FLAG) return 'Admin';
    let name = '';
    while (!name || name.trim().length === 0) {
        name = prompt("Please enter your name to join the room:", "");
        if (name === null) { name = `Guest-${Math.random().toString(36).substring(2, 6)}`; break; }
    }
    return name.trim();
}

// --- Ably Connection & Main Logic ---
let ably, channel;
async function main() {
    NICKNAME = getUserNickname();
    ably = new Ably.Realtime.Promise({ key: ABLY_API_KEY, clientId: NICKNAME });
    channel = ably.channels.get(`stream-together:${ROOM_ID}`);
    
    await channel.presence.enter();
    channel.subscribe(handleAblyMessages);
    channel.presence.subscribe(['enter', 'leave'], updateParticipantList);
    updateParticipantList();

    if (!IS_ADMIN_FLAG) {
        channel.publish('request-join', { nickname: NICKNAME });
    }
    window.addEventListener('beforeunload', () => { if (channel) channel.presence.leave(); });
}

// --- Ably Message Handler ---
function handleAblyMessages(message) {
    switch (message.name) {
        case 'set-video': handleSetVideo(message.data); break;
        case 'play': handlePlay(message.data); break;
        case 'pause': handlePause(); break;
        case 'request-join': if (IS_ADMIN_FLAG) handleJoinRequest(message.data); break;
        case 'approve-join': if (message.data.approvedNickname === NICKNAME) handleApproval(); break;
        case 'sync-request': if (IS_ADMIN_FLAG) handleSyncRequest(message.data); break;
        case 'sync-response': if (message.data.targetNickname === NICKNAME) handleSync(message.data); break;
        case 'kick-user': if (message.data.kickedNickname === NICKNAME) handleKick(); break;
        case 'chat-message': displayChatMessage(message.data.nickname, message.data.text, message.data.isSystem); break;
        
        // --- NEW: Queue Management Messages ---
        case 'add-to-queue': if (IS_ADMIN_FLAG) handleAddToQueue(message.data); break;
        case 'queue-updated': handleQueueUpdated(message.data); break;
    }
}

// --- Queue Logic ---
async function addVideoToQueue() {
    const videoId = extractVideoID(urlInput.value);
    if (!videoId) {
        alert("Invalid YouTube URL.");
        return;
    }

    try {
        addToQueueBtn.disabled = true;
        addToQueueBtn.textContent = "Adding...";
        const response = await fetch(`/api/video-details?id=${videoId}`);
        if (!response.ok) throw new Error("Could not fetch video details.");
        
        const details = await response.json();
        const queueItem = {
            videoId: videoId,
            title: details.title,
            thumbnail: details.thumbnail,
            addedBy: NICKNAME
        };
        
        // Send the request to the admin to add the item
        channel.publish('add-to-queue', queueItem);
        urlInput.value = '';

    } catch (error) {
        console.error("Error adding video to queue:", error);
        alert(error.message);
    } finally {
        addToQueueBtn.disabled = false;
        addToQueueBtn.textContent = "Add to Queue";
    }
}

function handleAddToQueue(newItem) {
    if (!IS_ADMIN_FLAG) return; // Only admin manages the queue
    videoQueue.push(newItem);
    // If nothing is playing and this is the first item, start playing it
    if (!player || player.getPlayerState() === YT.PlayerState.ENDED || player.getPlayerState() === -1) {
        playNextInQueue();
    } else {
        // Otherwise, just notify everyone of the updated queue
        channel.publish('queue-updated', { queue: videoQueue });
    }
}

function handleQueueUpdated({ queue }) {
    videoQueue = queue;
    renderQueue();
}

function renderQueue() {
    if (!queueListContainer) return;
    queueListContainer.innerHTML = '';
    if (videoQueue.length === 0) {
        queueListContainer.innerHTML = `<p class="text-gray-400 text-sm italic">The queue is empty.</p>`;
        return;
    }
    videoQueue.forEach((item, index) => {
        const queueEl = document.createElement('div');
        queueEl.className = 'flex items-center gap-3 bg-gray-800/50 p-2 rounded-md';
        queueEl.innerHTML = `
            <span class="font-bold text-gray-400">${index + 1}</span>
            <img src="${item.thumbnail}" class="w-16 h-12 object-cover rounded">
            <div class="flex-1 text-sm">
                <p class="font-semibold text-gray-200 truncate">${item.title}</p>
                <p class="text-gray-400">Added by: ${item.addedBy}</p>
            </div>
        `;
        queueListContainer.appendChild(queueEl);
    });
}

function playNextInQueue() {
    if (!IS_ADMIN_FLAG) return; // Only admin can trigger next video
    if (videoQueue.length === 0) {
        console.log("Queue finished.");
        return;
    }
    const nextItem = videoQueue.shift(); // Get and remove the first item
    
    // Announce the new video
    channel.publish('chat-message', { 
        nickname: 'System', 
        text: `Now playing "${nextItem.title}" (added by ${nextItem.addedBy})`,
        isSystem: true
    });
    
    // Tell everyone to set the new video
    channel.publish('set-video', { videoId: nextItem.videoId });
    
    // Tell everyone about the updated queue
    channel.publish('queue-updated', { queue: videoQueue });
}


// --- Chat Logic ---
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text) { channel.publish('chat-message', { nickname: NICKNAME, text: text }); chatInput.value = ''; }
}
function displayChatMessage(nickname, text, isSystem = false) {
    const isAdminMessage = nickname.toLowerCase() === 'admin';
    const messageEl = document.createElement('div');
    if (isSystem) {
        messageEl.innerHTML = `<p class="text-sm text-purple-300 italic">${text}</p>`;
    } else {
        messageEl.innerHTML = `<p class="text-sm"><strong class="${isAdminMessage ? 'text-purple-400' : 'text-blue-300'}">${nickname}:</strong> <span class="text-gray-200">${text}</span></p>`;
    }
    chatMessagesContainer.appendChild(messageEl);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// --- Participant & Admin Logic ---
async function updateParticipantList() {
    if (!userListContainer || !participantCount) return;
    const members = await channel.presence.get();
    participantCount.textContent = members.length;
    userListContainer.innerHTML = '';
    members.forEach(member => {
        const isAdmin = member.clientId.toLowerCase() === 'admin';
        const kickButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-kick-id="${member.clientId}" class="kick-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-2 rounded">Kick</button>` : '';
        const adminTagHTML = isAdmin ? `<span class="text-xs font-bold text-purple-400">[Admin]</span>` : '';
        const userEl = document.createElement('div');
        userEl.className = 'flex justify-between items-center bg-gray-800 p-2 rounded';
        userEl.innerHTML = `<div class="flex items-center gap-2"><span class="text-gray-300">${member.clientId}</span>${adminTagHTML}</div>${kickButtonHTML}`;
        userListContainer.appendChild(userEl);
    });
}
function handleJoinRequest(data) { channel.publish('approve-join', { approvedNickname: data.nickname }); }
function kickUser(nickname) { if (!IS_ADMIN_FLAG) return; channel.publish('kick-user', { kickedNickname: nickname }); }

// --- Sync & User Logic ---
function handleSyncRequest(data) {
    if (!player || !currentVideoId || player.getPlayerState() === -1) return;
    const syncData = { videoId: currentVideoId, currentTime: player.getCurrentTime(), state: player.getPlayerState(), targetNickname: data.requesterNickname };
    channel.publish('sync-response', syncData);
}
function handleSync(data) {
    const applySyncData = () => { isEventFromAbly = true; player.loadVideoById(data.videoId, data.currentTime); };
    if (!isYouTubeApiReady) { window.onYouTubeIframeAPIReady = () => { isYouTubeApiReady = true; createPlayer(data.videoId, applySyncData); };
    } else if (!player) { createPlayer(data.videoId, applySyncData);
    } else { applySyncData(); }
}
function handleApproval() {
    if (waitingOverlay) waitingOverlay.style.display = 'none';
    channel.publish('sync-request', { requesterNickname: NICKNAME });
    displayChatMessage('System', 'You have been admitted to the room.', true);
}
function handleKick() {
    alert("You have been removed from the room by the admin.");
    ably.close();
    document.body.innerHTML = '<div class="fixed inset-0 bg-black flex items-center justify-center"><h1 class="text-2xl text-red-500">You have been kicked.</h1></div>';
}

// --- Real-time Video Control Handlers ---
function handleSetVideo(data) {
    currentVideoId = data.videoId;
    lastPlayerState = -1;
    if (player && typeof player.loadVideoById === 'function') { isEventFromAbly = true; player.loadVideoById(currentVideoId);
    } else if (isYouTubeApiReady) { createPlayer(currentVideoId); }
}
function handlePlay(data) { if (!player) return; isEventFromAbly = true; player.seekTo(data.currentTime, true); player.playVideo(); }
function handlePause() { if (!player) return; isEventFromAbly = true; player.pauseVideo(); }

// --- YouTube IFrame API Setup ---
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
function onYouTubeIframeAPIReady() { isYouTubeApiReady = true; }
function createPlayer(videoId, onReadyCallback) {
    if (player) { if (onReadyCallback) onReadyCallback(); return; }
    player = new YT.Player('player', {
        height: '100%', width: '100%', videoId: videoId,
        playerVars: { playsinline: 1, autoplay: 1, controls: IS_ADMIN_FLAG ? 1 : 0, origin: window.location.origin },
        events: { 'onReady': (event) => { if (onReadyCallback) onReadyCallback(event); }, 'onStateChange': onPlayerStateChange }
    });
}
function onPlayerStateChange(event) {
    if (isEventFromAbly) { isEventFromAbly = false; return; }
    if (!IS_ADMIN_FLAG && event.data === YT.PlayerState.PAUSED) { player.playVideo(); return; }
    if (!IS_ADMIN_FLAG) return;
    if (event.data === lastPlayerState) return;
    lastPlayerState = event.data;
    switch (event.data) {
        case YT.PlayerState.PLAYING: channel.publish('play', { currentTime: player.getCurrentTime() }); break;
        case YT.PlayerState.PAUSED: channel.publish('pause', {}); break;
        case YT.PlayerState.ENDED: playNextInQueue(); break; // NEW: Play next video when one ends
    }
}

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// --- Event Listeners ---
addToQueueBtn.addEventListener('click', addVideoToQueue);

if (IS_ADMIN_FLAG) {
    userListContainer.addEventListener('click', (e) => {
        if (e.target.closest('.kick-btn')) {
            const nicknameToKick = e.target.closest('.kick-btn').dataset.kickId;
            if (nicknameToKick) kickUser(nicknameToKick);
        }
    });
} else {
    // Viewer-Specific Control Logic
    if (fullscreenBtn && playerWrapper) {
        fullscreenBtn.addEventListener('click', () => {
            if (playerWrapper.requestFullscreen) { playerWrapper.requestFullscreen();
            } else if (playerWrapper.webkitRequestFullscreen) { playerWrapper.webkitRequestFullscreen(); }
        });
    }
    if (muteBtn && volumeSlider && volumeOnIcon && volumeOffIcon) {
        muteBtn.addEventListener('click', () => {
            if (player.isMuted()) {
                player.unMute(); player.setVolume(lastVolume); volumeSlider.value = lastVolume;
                volumeOnIcon.classList.remove('hidden'); volumeOffIcon.classList.add('hidden');
            } else {
                lastVolume = player.getVolume(); player.mute(); volumeSlider.value = 0;
                volumeOnIcon.classList.add('hidden'); volumeOffIcon.classList.remove('hidden');
            }
        });
        volumeSlider.addEventListener('input', (e) => {
            const newVolume = e.target.value;
            player.setVolume(newVolume); lastVolume = newVolume;
            if (newVolume > 0 && player.isMuted()) {
                player.unMute();
                volumeOnIcon.classList.remove('hidden'); volumeOffIcon.classList.add('hidden');
            } else if (newVolume == 0 && !player.isMuted()) {
                player.mute();
                volumeOnIcon.classList.add('hidden'); volumeOffIcon.classList.remove('hidden');
            }
        });
    }
}
sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });

main();
