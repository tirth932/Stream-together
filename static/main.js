const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA'; // <--- REPLACE THIS
const ROOM_ID = document.location.pathname.split('/').pop();
const IS_ADMIN_FLAG = document.querySelector('p:not(.text-blue-400) > .text-purple-400') !== null;

// --- DOM Elements ---
const urlInput = document.getElementById('youtube-url');
const addToQueueBtn = document.getElementById('add-to-queue-btn');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const userListContainer = document.getElementById('user-list');
const participantCount = document.getElementById('participant-count');
const queueListContainer = document.getElementById('queue-list');
const nowPlayingCard = document.getElementById('now-playing-card');
const dynamicBackground = document.getElementById('dynamic-background');
const waitingOverlay = document.getElementById('waiting-overlay');
const playerWrapper = document.getElementById('player-wrapper');
// Viewer-specific controls
const fullscreenBtn = document.getElementById('fullscreen-btn');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeOnIcon = document.getElementById('volume-on-icon');
const volumeOffIcon = document.getElementById('volume-off-icon');
// Room Control Buttons
const leaveRoomBtn = document.getElementById('leave-room-btn');
const changeNameBtn = document.getElementById('change-name-btn');
const endRoomBtn = document.getElementById('end-room-btn');

// --- State ---
let player;
let isEventFromAbly = false;
let isYouTubeApiReady = false;
let currentVideoId = null;
let lastPlayerState = -1;
let NICKNAME;
let CLIENT_ID; // --- NEW: Stable Client ID ---
let lastVolume = 100;
let videoQueue = [];
let nowPlayingItem = null;
const defaultBackground = 'radial-gradient(at 20% 20%, hsla(273, 91%, 60%, 0.2) 0px, transparent 50%), radial-gradient(at 80% 20%, hsla(193, 91%, 60%, 0.2) 0px, transparent 50%)';
let isResyncing = false;

// --- Helper Functions ---
function getIdentity() {
    if (IS_ADMIN_FLAG) {
        NICKNAME = 'Admin';
        CLIENT_ID = 'admin-client'; // Stable ID for admin
        return;
    }
    let name = '';
    while (!name || name.trim().length === 0) { name = prompt("Please enter your name to join the room:", ""); if (name === null) { name = `Guest-${Math.random().toString(36).substring(2, 6)}`; break; } }
    NICKNAME = name.trim();
    // Create a unique, random ID for viewers
    CLIENT_ID = `viewer-${Math.random().toString(36).substring(2, 10)}`;
}

// --- Ably Connection & Main Logic ---
let ably, channel;
async function main() {
    getIdentity(); // Get both CLIENT_ID and NICKNAME
    
    ably = new Ably.Realtime.Promise({ key: ABLY_API_KEY, clientId: CLIENT_ID });
    channel = ably.channels.get(`stream-together:${ROOM_ID}`);

    // Restore state from history BEFORE subscribing
    try {
        await channel.attach();
        const history = await channel.history({ limit: 10, direction: 'backwards' });
        
        const lastNowPlayingMsg = history.items.find(msg => msg.name === 'now-playing-updated');
        const lastQueueMsg = history.items.find(msg => msg.name === 'queue-updated');

        if (lastQueueMsg) handleQueueUpdated(lastQueueMsg.data);
        if (lastNowPlayingMsg) {
            handleNowPlayingUpdated(lastNowPlayingMsg.data);
            // --- FIX: If state is restored, load the video into the player ---
            if (nowPlayingItem && isYouTubeApiReady) {
                createPlayer(nowPlayingItem.videoId);
            } else if (nowPlayingItem) {
                // Wait for API to be ready, then create player
                window.onYouTubeIframeAPIReady = () => { isYouTubeApiReady = true; createPlayer(nowPlayingItem.videoId); };
            }
        }
        
        console.log("✅ Room state restored from history.");

    } catch (err) { console.error("Could not retrieve channel history:", err); }

    // Continue with normal setup
    await channel.presence.enter({ nickname: NICKNAME });
    channel.subscribe(handleAblyMessages);
    channel.presence.subscribe(['enter', 'leave', 'update'], updateParticipantList);
    updateParticipantList();
    
    // --- FIX: Viewer always requests sync on join/refresh ---
    if (!IS_ADMIN_FLAG) {
        if (waitingOverlay) waitingOverlay.style.display = 'flex'; // Ensure overlay is visible
        channel.publish('request-join', { nickname: NICKNAME });
    }
    window.addEventListener('beforeunload', () => { if (channel) channel.presence.leave(); });
}

// --- Ably Message Handler (rest of the file is mostly the same, with small fixes) ---
function handleAblyMessages(message) {
    switch (message.name) {
        case 'set-video': handleSetVideo(message.data); break;
        case 'play': handlePlay(message.data); break;
        case 'pause': handlePause(); break;
        case 'request-join': if (IS_ADMIN_FLAG) handleJoinRequest(message.data); break;
        case 'approve-join': if (message.data.approvedNickname === NICKNAME) handleApproval(); break;
        case 'sync-request': if (IS_ADMIN_FLAG) handleSyncRequest(message.data); break;
        case 'sync-response': if (message.data.targetClientId === CLIENT_ID) handleSync(message.data); break;
        case 'kick-user': if (message.data.kickedClientId === CLIENT_ID) handleKick(); break;
        case 'chat-message': displayChatMessage(message.data.nickname, message.data.text, message.data.isSystem); break;
        case 'add-to-queue': if (IS_ADMIN_FLAG) handleAddToQueue(message.data); break;
        case 'queue-updated': handleQueueUpdated(message.data); break;
        case 'now-playing-updated': handleNowPlayingUpdated(message.data); break;
        case 'room-ended': handleRoomEnded(message.data); break;
    }
}

// --- Background Sync Logic ---
function updateBackgroundColor(imageUrl) {
    if (!imageUrl || typeof ColorThief === 'undefined') { dynamicBackground.style.backgroundImage = defaultBackground; return; }
    const highQualityUrl = imageUrl.replace('default.jpg', 'hqdefault.jpg');
    const colorThief = new ColorThief();
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = highQualityUrl;
    img.addEventListener('load', () => {
        try {
            const palette = colorThief.getPalette(img, 2);
            const color1 = palette[0]; const color2 = palette[1];
            dynamicBackground.style.backgroundImage = `radial-gradient(at 20% 20%, rgba(${color1[0]}, ${color1[1]}, ${color1[2]}, 0.3) 0px, transparent 50%), radial-gradient(at 80% 80%, rgba(${color2[0]}, ${color2[1]}, ${color2[2]}, 0.25) 0px, transparent 50%)`;
        } catch(e) { dynamicBackground.style.backgroundImage = defaultBackground; }
    });
    img.addEventListener('error', () => { dynamicBackground.style.backgroundImage = defaultBackground; });
}

// --- Queue & Now Playing Logic ---
async function addVideoToQueue() {
    const videoId = extractVideoID(urlInput.value);
    if (!videoId) { alert("Invalid YouTube URL."); return; }
    try {
        addToQueueBtn.disabled = true; addToQueueBtn.textContent = "Adding...";
        const response = await fetch(`/api/video-details?id=${videoId}`);
        if (!response.ok) throw new Error("Could not fetch video details.");
        const details = await response.json();
        const queueItem = { videoId: videoId, title: details.title, thumbnail: details.thumbnail, addedBy: NICKNAME };
        channel.publish('add-to-queue', queueItem);
        urlInput.value = '';
    } catch (error) { console.error("Error adding video to queue:", error); alert(error.message);
    } finally { addToQueueBtn.disabled = false; addToQueueBtn.textContent = "Add to Queue"; }
}
function handleAddToQueue(newItem) {
    if (!IS_ADMIN_FLAG) return;
    videoQueue.push(newItem);
    if (!nowPlayingItem && (!player || player.getPlayerState() === YT.PlayerState.ENDED || player.getPlayerState() === -1)) {
        playNextInQueue();
    } else {
        channel.publish('queue-updated', { queue: videoQueue });
    }
}
function handleQueueUpdated({ queue }) { videoQueue = queue; renderQueue(); }
function handleNowPlayingUpdated({ item }) {
    nowPlayingItem = item;
    renderNowPlaying();
    updateBackgroundColor(item ? item.thumbnail : null);
}
function renderQueue() {
    if (!queueListContainer) return;
    queueListContainer.innerHTML = '';
    if (videoQueue.length === 0) { queueListContainer.innerHTML = `<p class="text-gray-400 text-sm italic">The queue is empty.</p>`; return; }
    videoQueue.forEach((item, index) => {
        const queueEl = document.createElement('div');
        queueEl.className = 'flex items-center gap-3 bg-gray-800/50 p-2 rounded-md';
        queueEl.innerHTML = `<span class="font-bold text-gray-400">${index + 1}</span><img src="${item.thumbnail}" class="w-16 h-12 object-cover rounded"><div class="flex-1 text-sm min-w-0"><p class="font-semibold text-gray-200 truncate">${item.title}</p><p class="text-gray-400">Added by: ${item.addedBy}</p></div>`;
        queueListContainer.appendChild(queueEl);
    });
}
function renderNowPlaying() {
    if (!nowPlayingCard) return;
    if (!nowPlayingItem) {
        nowPlayingCard.innerHTML = `<p class="text-gray-400 text-sm italic">Nothing is currently playing.</p>`;
        return;
    }
    nowPlayingCard.innerHTML = `<div class="flex items-center gap-3 bg-green-900/30 p-2 rounded-md border border-green-500"><img src="${nowPlayingItem.thumbnail}" class="w-16 h-12 object-cover rounded"><div class="flex-1 text-sm min-w-0"><p class="font-semibold text-gray-100 truncate">${nowPlayingItem.title}</p><p class="text-green-300">Added by: ${nowPlayingItem.addedBy}</p></div></div>`;
}
function playNextInQueue() {
    if (!IS_ADMIN_FLAG) return;
    if (videoQueue.length === 0) { channel.publish('now-playing-updated', { item: null }); console.log("Queue finished."); return; }
    const nextItem = videoQueue.shift();
    channel.publish('chat-message', { nickname: 'System', text: `Now playing "${nextItem.title}" (added by ${nextItem.addedBy})`, isSystem: true });
    channel.publish('now-playing-updated', { item: nextItem });
    channel.publish('set-video', { videoId: nextItem.videoId });
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
    if (isSystem) { messageEl.innerHTML = `<p class="text-sm text-purple-300 italic">${text}</p>`;
    } else { messageEl.innerHTML = `<p class="text-sm"><strong class="${isAdminMessage ? 'text-purple-400' : 'text-blue-300'}">${nickname}:</strong> <span class="text-gray-200">${text}</span></p>`; }
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
        // --- FIX: Reliably get the display name from presence data ---
        const displayName = member.data ? member.data.nickname : member.clientId;
        const isAdmin = member.clientId === 'admin-client';
        const kickButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-kick-id="${member.clientId}" class="kick-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-2 rounded">Kick</button>` : '';
        const adminTagHTML = isAdmin ? `<span class="text-xs font-bold text-purple-400">[Admin]</span>` : '';
        const userEl = document.createElement('div');
        userEl.className = 'flex justify-between items-center bg-gray-800 p-2 rounded';
        userEl.innerHTML = `<div class="flex items-center gap-2"><span class="text-gray-300">${displayName}</span>${adminTagHTML}</div>${kickButtonHTML}`;
        userListContainer.appendChild(userEl);
    });
}
function handleJoinRequest(data) { channel.publish('approve-join', { approvedNickname: data.nickname }); }
function kickUser(clientId) { if (!IS_ADMIN_FLAG) return; channel.publish('kick-user', { kickedClientId: clientId }); }

// --- Sync & User Logic ---
function handleSyncRequest(data) {
    if (!player || player.getPlayerState() === -1) return;
    const syncData = { videoId: currentVideoId, currentTime: player.getCurrentTime(), state: player.getPlayerState(), targetClientId: data.requesterClientId, nowPlaying: nowPlayingItem, queue: videoQueue };
    channel.publish('sync-response', syncData);
}
function handleSync(data) {
    if(data.nowPlaying) handleNowPlayingUpdated({ item: data.nowPlaying });
    if(data.queue) handleQueueUpdated({ queue: data.queue });
    const applyVideoSync = () => {
        isEventFromAbly = true; if(data.videoId) {
            isResyncing = true;
            if (player.getVideoData().video_id === data.videoId) {
                player.seekTo(data.currentTime, true);
            } else {
                player.loadVideoById(data.videoId, data.currentTime);
            }
            if (data.state === YT.PlayerState.PLAYING) player.playVideo(); else player.pauseVideo();
        }
    };
    if (!isYouTubeApiReady) { window.onYouTubeIframeAPIReady = () => { isYouTubeApiReady = true; createPlayer(data.videoId, applyVideoSync); };
    } else if (!player) { createPlayer(data.videoId, applyVideoSync);
    } else { applyVideoSync(); }
}
function handleApproval() {
    if (waitingOverlay) waitingOverlay.style.display = 'none';
    channel.publish('sync-request', { requesterClientId: CLIENT_ID });
    displayChatMessage('System', 'You have been admitted to the room.', true);
}
function handleKick() {
    alert("You have been removed from the room by the admin."); ably.close(); window.location.href = '/';
}
function handleRoomEnded(data) {
    alert(data.message); ably.close(); window.location.href = '/';
}

// --- Real-time Video Control Handlers ---
function handleSetVideo(data) {
    currentVideoId = data.videoId; lastPlayerState = -1;
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
        events: { 'onReady': (event) => { 
            // --- FIX: If admin refreshes, resync the room from t=0 ---
            if (IS_ADMIN_FLAG && nowPlayingItem) {
                displayChatMessage('System', 'Admin has reconnected, re-syncing room...', true);
                channel.publish('play', { currentTime: 0 });
            }
            if (onReadyCallback) onReadyCallback(event);
        }, 'onStateChange': onPlayerStateChange }
    });
}
function onPlayerStateChange(event) {
    if (isEventFromAbly) { isEventFromAbly = false; return; }
    if (isResyncing && event.data === YT.PlayerState.PLAYING) { isResyncing = false; return; }
    if (!IS_ADMIN_FLAG) {
        if (event.data === YT.PlayerState.PLAYING) {
            player.pauseVideo();
            displayChatMessage('System', 'Re-syncing with the room...', true);
            channel.publish('sync-request', { requesterClientId: CLIENT_ID });
        }
        return;
    }
    if (event.data === lastPlayerState) return;
    lastPlayerState = event.data;
    switch (event.data) {
        case YT.PlayerState.PLAYING: channel.publish('play', { currentTime: player.getCurrentTime() }); break;
        case YT.PlayerState.PAUSED: channel.publish('pause', {}); break;
        case YT.PlayerState.ENDED: playNextInQueue(); break;
    }
}

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// --- Event Listeners ---
addToQueueBtn.addEventListener('click', addVideoToQueue);
if (IS_ADMIN_FLAG) {
    userListContainer.addEventListener('click', (e) => {
        const kickBtn = e.target.closest('.kick-btn');
        if (kickBtn) { const clientIdToKick = kickBtn.dataset.kickId; if (clientIdToKick) kickUser(clientIdToKick); }
    });
    endRoomBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to end the session for everyone?")) {
            channel.publish('room-ended', { message: 'The admin has ended the session.' });
            setTimeout(() => { ably.close(); window.location.href = '/'; }, 500);
        }
    });
} else {
    leaveRoomBtn.addEventListener('click', () => { ably.close(); window.location.href = '/'; });
    changeNameBtn.addEventListener('click', async () => {
        const newName = prompt("Enter your new name:", NICKNAME);
        if (newName && newName.trim() !== '') {
            const oldName = NICKNAME;
            NICKNAME = newName.trim();
            await channel.presence.update({ nickname: NICKNAME });
            displayChatMessage('System', `"${oldName}" is now known as "${NICKNAME}"`, true);
        }
    });
    if (fullscreenBtn && playerWrapper) { fullscreenBtn.addEventListener('click', () => { if (playerWrapper.requestFullscreen) { playerWrapper.requestFullscreen(); } else if (playerWrapper.webkitRequestFullscreen) { playerWrapper.webkitRequestFullscreen(); } }); }
    if (muteBtn && volumeSlider && volumeOnIcon && volumeOffIcon) {
        muteBtn.addEventListener('click', () => {
            if (player.isMuted()) { player.unMute(); player.setVolume(lastVolume); volumeSlider.value = lastVolume; volumeOnIcon.classList.remove('hidden'); volumeOffIcon.classList.add('hidden');
            } else { lastVolume = player.getVolume(); player.mute(); volumeSlider.value = 0; volumeOnIcon.classList.add('hidden'); volumeOffIcon.classList.remove('hidden'); }
        });
        volumeSlider.addEventListener('input', (e) => {
            const newVolume = e.target.value;
            player.setVolume(newVolume); lastVolume = newVolume;
            if (newVolume > 0 && player.isMuted()) { player.unMute(); volumeOnIcon.classList.remove('hidden'); volumeOffIcon.classList.add('hidden');
            } else if (newVolume == 0 && !player.isMuted()) { player.mute(); volumeOnIcon.classList.add('hidden'); volumeOffIcon.classList.remove('hidden'); }
        });
    }
}
sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });

main();