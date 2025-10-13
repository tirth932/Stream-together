// stream-together-client.js
const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA'; // <--- REPLACE THIS
const ROOM_ID = document.location.pathname.split('/').pop();
const IS_ADMIN_FLAG = window.location.pathname.startsWith('/admin/');

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
const playImmediatelyBtn = document.getElementById('play-immediately-btn');
const syncRoomBtn = document.getElementById('sync-room-btn');
// Modal and Emoji Elements
const nameModalOverlay = document.getElementById('name-modal-overlay');
const nameModalContent = document.getElementById('name-modal-content');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const nameError = document.getElementById('name-error');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
// Copy Button Elements
const copyRoomIdBtn = document.getElementById('copy-room-id-btn');
const roomIdText = document.getElementById('room-id-text');
const copyFeedback = document.getElementById('copy-feedback');
// Notification Elements
const toggleNotificationsBtn = document.getElementById('toggle-notifications-btn');
const notificationsOnIcon = document.getElementById('notifications-on-icon');
const notificationsOffIcon = document.getElementById('notifications-off-icon');
const chatNotificationSound = document.getElementById('chat-notification-sound');


// --- State ---
let player;
let isEventFromAbly = false;
let isYouTubeApiReady = false;
let currentVideoId = null;
let lastPlayerState = -1;
let NICKNAME;
let CLIENT_ID;
let lastVolume = 100;
let videoQueue = [];
let nowPlayingItem = null;
const defaultBackground = 'radial-gradient(at 20% 20%, hsla(273, 91%, 60%, 0.2) 0px, transparent 50%), radial-gradient(at 80% 20%, hsla(193, 91%, 60%, 0.2) 0px, transparent 50%)';
let isResyncing = false;
let lastKnownTime = 0;
let isUpdatingList = false;
// Notification State
let areNotificationsMuted = false;
let hasInteracted = false; // For fixing audio playback
let unreadCount = 0; // For tracking unread messages when tab is hidden


// --- Helper Functions ---
function isNameValid(name) {
    nameError.textContent = '';
    if (!name || name.trim().length === 0) {
        nameError.textContent = "Name cannot be empty."; return false;
    }
    if (name.length < 2 || name.length > 20) {
        nameError.textContent = "Name must be between 2 and 20 characters."; return false;
    }
    if (name.trim().toLowerCase() === 'admin' && !IS_ADMIN_FLAG) {
        nameError.textContent = "That name is reserved."; return false;
    }
    return true;
}

function getIdentity() {
    return new Promise((resolve) => {
        nameModalOverlay.classList.remove('hidden');
        nameModalOverlay.classList.add('visible');
        if (IS_ADMIN_FLAG) { nameInput.value = "Admin"; }

        nameForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = nameInput.value.trim();
            if (isNameValid(name)) {
                NICKNAME = name;
                if (IS_ADMIN_FLAG) { CLIENT_ID = `admin-${Math.random().toString(36).substring(2, 10)}`; } 
                else { CLIENT_ID = `viewer-${Math.random().toString(36).substring(2, 10)}`; }
                nameModalContent.style.transform = 'scale(0.95)';
                nameModalContent.style.opacity = '0';
                setTimeout(() => {
                    nameModalOverlay.classList.add('hidden');
                    nameModalOverlay.classList.remove('visible');
                }, 300);
                resolve();
            }
        });
    });
}


// --- Ably Connection & Main Logic ---
let ably, channel;
async function main() {
    await getIdentity();
    initNotificationControls();
    
    // Request notification permission on load
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    try {
        const saved = localStorage.getItem(`lastVideoState_${ROOM_ID}`);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.videoId) {
                currentVideoId = parsed.videoId;
                lastKnownTime = parsed.time || 0;
            }
        }
    } catch (e) { console.warn("Could not parse saved state:", e); }

    ably = new Ably.Realtime.Promise({ key: ABLY_API_KEY, clientId: CLIENT_ID });
    channel = ably.channels.get(`stream-together:${ROOM_ID}`);

    try {
        await channel.attach();
        const history = await channel.history({ limit: 50, direction: 'backwards' });
        const lastNowPlayingMsg = history.items.slice().reverse().find(msg => msg.name === 'now-playing-updated');
        const lastQueueMsg = history.items.slice().reverse().find(msg => msg.name === 'queue-updated');
        const timeUpdateMsgs = history.items.slice().reverse().filter(msg => msg.name === 'time-update');
        let lastTimeForVideo = null;
        if (timeUpdateMsgs.length > 0) {
            if (currentVideoId) {
                lastTimeForVideo = timeUpdateMsgs.find(m => m.data && m.data.videoId === currentVideoId);
            }
            if (!lastTimeForVideo) lastTimeForVideo = timeUpdateMsgs[0];
        }
        if (lastQueueMsg) handleQueueUpdated(lastQueueMsg.data);
        if (lastNowPlayingMsg) {
            handleNowPlayingUpdated(lastNowPlayingMsg.data);
            if (lastTimeForVideo && lastTimeForVideo.data) {
                lastKnownTime = lastTimeForVideo.data.currentTime || lastKnownTime;
            }
            if (nowPlayingItem) {
                if (isYouTubeApiReady) { createPlayer(nowPlayingItem.videoId); } 
                else { window.onYouTubeIframeAPIReady = () => { isYouTubeApiReady = true; createPlayer(nowPlayingItem.videoId); }; }
            }
        } else if (currentVideoId) {
            if (isYouTubeApiReady) { createPlayer(currentVideoId); } 
            else { window.onYouTubeIframeAPIReady = () => { isYouTubeApiReady = true; createPlayer(currentVideoId); }; }
        }
    } catch (err) { console.error("Could not retrieve channel history:", err); }

    const presenceData = { nickname: NICKNAME, isAdmin: IS_ADMIN_FLAG, notificationsMuted: areNotificationsMuted };
    await channel.presence.enter(presenceData);

    if (IS_ADMIN_FLAG) {
        setTimeout(async () => {
            try {
                const members = await channel.presence.get();
                const admins = members.filter(m => m.data.isAdmin);
                if (admins.length > 1) {
                    admins.sort((a, b) => a.timestamp - b.timestamp);
                    if (admins[0].clientId !== CLIENT_ID) {
                        alert("An admin is already present in this room. You will be connected as a viewer.");
                        window.location.href = `/join/${ROOM_ID}`;
                        return;
                    }
                }
            } catch (err) { console.error("Failed to verify admin status:", err); }
        }, 1000);
    }
    
    channel.subscribe(handleAblyMessages);
    channel.presence.subscribe(['enter', 'leave', 'update'], updateParticipantList);
    updateParticipantList();

    if (!IS_ADMIN_FLAG) {
        if (waitingOverlay) waitingOverlay.style.display = 'flex';
        requestToJoinWithRetry();
    }
    window.addEventListener('beforeunload', () => { if (channel) channel.presence.leave(); });

    startAdminTimeBroadcast();
}

// --- Ably Message Handler ---
function handleAblyMessages(message) {
    switch (message.name) {
        case 'set-video': handleSetVideo(message.data); break;
        case 'play': handlePlay(message.data); break;
        case 'pause': handlePause(); break;
        case 'request-join': if (IS_ADMIN_FLAG) handleJoinRequest(message.data); break;
        case 'approve-join': if (message.data.approvedClientId === CLIENT_ID) handleApproval(); break;
        case 'sync-request': if (IS_ADMIN_FLAG) handleSyncRequest(message.data); break;
        case 'sync-response': if (message.data.targetClientId === CLIENT_ID) handleSync(message.data); break;
        case 'kick-user': if (message.data.kickedClientId === CLIENT_ID) handleKick(); break;
        case 'chat-message': 
            if (message.clientId !== CLIENT_ID) {
                displayChatMessage(message.data, message.clientId);
            }
            break;
        case 'add-to-queue': if (IS_ADMIN_FLAG) handleAddToQueue(message.data); break;
        case 'queue-updated': handleQueueUpdated(message.data); break;
        case 'now-playing-updated': handleNowPlayingUpdated(message.data); break;
        case 'room-ended': handleRoomEnded(message.data); break;
        case 'promote-to-admin': handlePromotion(message.data); break;
        case 'time-update':
            if (message.data && message.data.videoId) {
                if (!currentVideoId) currentVideoId = message.data.videoId;
                if (message.data.videoId === currentVideoId) {
                    lastKnownTime = message.data.currentTime || 0;
                }
            }
            break;
        case 'toggle-user-notifications':
            if (message.data.targetClientId === CLIENT_ID) {
                const newMuted = !areNotificationsMuted;
                areNotificationsMuted = newMuted;
                localStorage.setItem('notificationsMuted', newMuted.toString());
                channel.presence.update({ nickname: NICKNAME, notificationsMuted: newMuted });
                // Update UI
                if (toggleNotificationsBtn) {
                    if (newMuted) {
                        notificationsOnIcon.classList.add('hidden');
                        notificationsOffIcon.classList.remove('hidden');
                        toggleNotificationsBtn.setAttribute('title', 'Unmute Notifications');
                    } else {
                        notificationsOnIcon.classList.remove('hidden');
                        notificationsOffIcon.classList.add('hidden');
                        toggleNotificationsBtn.setAttribute('title', 'Mute Notifications');
                    }
                }
                showToast(`Notifications ${newMuted ? 'muted' : 'unmuted'} by admin`, 'info');
            }
            break;
    }
}

// --- Background Sync Logic ---
function updateBackgroundColor(imageUrl) {
    if (!imageUrl || typeof ColorThief === 'undefined') { if(dynamicBackground) dynamicBackground.style.backgroundImage = defaultBackground; return; }
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
async function getVideoItemFromUrl() {
    const videoId = extractVideoID(urlInput.value);
    if (!videoId) { alert("Invalid YouTube URL."); return null; }
    try {
        const response = await fetch(`/api/video-details?id=${videoId}`);
        if (!response.ok) throw new Error("Could not fetch video details.");
        const details = await response.json();
        urlInput.value = '';
        return { videoId: videoId, title: details.title, thumbnail: details.thumbnail, addedBy: NICKNAME };
    } catch (error) { console.error("Error getting video details:", error); alert(error.message); return null; }
}

function handleAddToQueue(newItem) {
    if (!IS_ADMIN_FLAG) return;
    videoQueue.push(newItem);
    if (!nowPlayingItem && (!player || [YT.PlayerState.ENDED, YT.PlayerState.UNSTARTED, -1].includes(player.getPlayerState()))) {
        playNextInQueue();
    } else {
        channel.publish('queue-updated', { queue: videoQueue });
    }
}
function handleQueueUpdated({ queue }) { videoQueue = queue; renderQueue(); }
function handleNowPlayingUpdated({ item }) {
    nowPlayingItem = item;
    if (item && item.videoId) currentVideoId = item.videoId;
    renderNowPlaying();
    updateBackgroundColor(item ? item.thumbnail : null);
}
function renderQueue() {
    if (!queueListContainer) return;
    queueListContainer.innerHTML = '';
    if (videoQueue.length === 0) { queueListContainer.innerHTML = `<p class="text-gray-400 text-sm italic">The queue is empty.</p>`; return; }
    videoQueue.forEach((item) => {
        const queueEl = document.createElement('div');
        queueEl.className = 'flex items-center gap-3 bg-gray-800/50 p-2 rounded-md';
        const removeButtonHTML = IS_ADMIN_FLAG ? `<button title="Remove from queue" data-video-id="${item.videoId}" class="remove-queue-btn ml-auto p-1 text-red-400 hover:text-red-200">❌</button>` : '';
        queueEl.innerHTML = `<img src="${item.thumbnail}" class="w-16 h-10 object-cover rounded"><div class="flex-1 text-sm min-w-0"><p class="font-semibold text-gray-200 truncate">${item.title}</p><p class="text-gray-400">Added by: ${item.addedBy}</p></div>${removeButtonHTML}`;
        queueListContainer.appendChild(queueEl);
    });
}
function renderNowPlaying() {
    if (!nowPlayingCard) return;
    if (!nowPlayingItem) { nowPlayingCard.innerHTML = `<p class="text-gray-400 text-sm italic">Nothing is currently playing.</p>`; return; }
    nowPlayingCard.innerHTML = `<div class="flex items-center gap-3 bg-green-900/30 p-2 rounded-md border border-green-500"><img src="${nowPlayingItem.thumbnail}" class="w-16 h-12 object-cover rounded"><div class="flex-1 text-sm min-w-0"><p class="font-semibold text-gray-100 truncate">${nowPlayingItem.title}</p><p class="text-green-300">Added by: ${nowPlayingItem.addedBy}</p></div></div>`;
}

function playItemNow(item) {
    if (!IS_ADMIN_FLAG || !item) return;
    channel.publish('chat-message', { nickname: 'System', text: `Now playing "${item.title}" (added by ${item.addedBy})`, isSystem: true });
    channel.publish('now-playing-updated', { item: item });
    channel.publish('set-video', { videoId: item.videoId });
}

function playNextInQueue() {
    if (!IS_ADMIN_FLAG) return;
    if (videoQueue.length > 0) {
        const nextItem = videoQueue.shift();
        playItemNow(nextItem);
        channel.publish('queue-updated', { queue: videoQueue });
    } else {
        channel.publish('now-playing-updated', { item: null });
        console.log("Queue finished.");
    }
}

// --- Chat Logic ---
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text === '') return;
    if (text.length > 280) { alert("Your message is too long (max 280 characters)."); return; }
    // Display own message immediately for better UX
    displayChatMessage({ nickname: NICKNAME, text: text }, CLIENT_ID);
    channel.publish('chat-message', { nickname: NICKNAME, text: text });
    chatInput.value = '';
    sendChatBtn.disabled = true;
    setTimeout(() => { sendChatBtn.disabled = false; }, 2000);
}

// --- displayChatMessage for WhatsApp-like UI and Notifications ---
function displayChatMessage(data, clientId) {
    const { nickname, text, isSystem } = data;
    const isMyOwnMessage = (clientId === CLIENT_ID);
    const isAdminMessage = nickname && nickname.toLowerCase() === 'admin';
    const messageEl = document.createElement('div');
    messageEl.className = 'flex space-y-2 mb-2'; // Adjusted spacing

    if (isSystem) {
        messageEl.innerHTML = `<div class="flex justify-center"><div class="bg-purple-900/50 text-purple-300 italic px-4 py-2 rounded-full text-sm max-w-xs">${text}</div></div>`;
    } else if (isMyOwnMessage) {
        // Own message: right-aligned, blue bubble
        messageEl.innerHTML = `<div class="flex justify-end"><div class="bg-blue-500 text-white px-4 py-2 rounded-lg rounded-tr-sm max-w-xs text-sm break-words">${text}</div></div>`;
    } else {
        // Other message: left-aligned, gray bubble with name
        const nameColor = isAdminMessage ? 'text-purple-400' : 'text-blue-300';
        messageEl.innerHTML = `<div class="flex justify-start"><div class="bg-gray-700 text-white px-4 py-2 rounded-lg rounded-tl-sm max-w-xs text-sm"><div class="font-semibold ${nameColor} text-xs mb-1">${nickname}:</div><div class="text-gray-200">${text}</div></div></div>`;
    }
    chatMessagesContainer.appendChild(messageEl);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

    // Enhanced Notification Logic
    if (!isSystem && !isMyOwnMessage && !areNotificationsMuted) {
        unreadCount++;
        // Play sound if user has interacted with the page
        if (hasInteracted) {
            chatNotificationSound.play().catch(e => console.warn("Could not play notification sound:", e.message));
        }
        // Show browser notification if tab is hidden
        if (document.hidden && Notification.permission === 'granted') {
            new Notification(`${nickname}: ${text}`, {
                body: `New message in room ${ROOM_ID}`,
                icon: '/static/favicon.ico' // Optional: add a favicon
            });
        }
    }
}

// --- Toast Notification Function ---
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `p-4 rounded-lg shadow-lg transform transition-all duration-300 ease-in-out fixed top-4 right-4 z-50 ${type === 'error' ? 'bg-red-500 text-white' : 'bg-purple-500/90 text-white backdrop-blur-sm'}`;
    toast.style.transform = 'translateX(100%)';
    toast.textContent = message;

    document.body.appendChild(toast); // Append directly to body since container might not be available

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, duration);
}

// --- Participant & Admin Logic ---
async function updateParticipantList() {
    if (isUpdatingList) return; 
    isUpdatingList = true;

    try {
        if (!userListContainer || !participantCount) return;
        
        const members = await channel.presence.get();
        participantCount.textContent = members.length;
        userListContainer.innerHTML = '';
        members.sort((a, b) => (b.data.isAdmin ? 1 : 0) - (a.data.isAdmin ? 1 : 0));
        
        members.forEach(member => {
            const displayName = member.data.nickname;
            const isAdmin = member.data.isAdmin;
            const notificationsMuted = member.data.notificationsMuted || false;
            const kickButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-kick-id="${member.clientId}" title="Kick User" class="kick-btn p-1 text-red-400 hover:text-red-200">🚫</button>` : '';
            const promoteButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-promote-id="${member.clientId}" title="Make Admin" class="promote-btn p-1 text-yellow-400 hover:text-yellow-200">👑</button>` : '';
            const notificationIcon = notificationsMuted ? '🔕' : '🔔';
            const notificationButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-notif-id="${member.clientId}" title="Toggle User Notifications" class="notif-btn p-1 ${notificationsMuted ? 'text-red-400' : 'text-gray-400'} hover:text-purple-400 transition-colors">${notificationIcon}</button>` : '';
            const adminTagHTML = isAdmin ? `<span class="text-xs font-bold text-purple-400">[Admin]</span>` : '';
            const userEl = document.createElement('div');
            userEl.className = 'flex justify-between items-center bg-gray-800 p-2 rounded';
            userEl.innerHTML = `<div class="flex items-center gap-2"><span class="text-gray-300">${displayName}</span>${adminTagHTML}</div><div class="flex items-center gap-2">${promoteButtonHTML}${notificationButtonHTML}${kickButtonHTML}</div>`;
            userListContainer.appendChild(userEl);
        });
    } catch (error) {
        console.error("Error updating participant list:", error);
    } finally {
        isUpdatingList = false;
    }
}
function handleJoinRequest(data) { channel.publish('approve-join', { approvedClientId: data.clientId, approvedNickname: data.nickname }); }
function kickUser(clientId) { if (!IS_ADMIN_FLAG) return; channel.publish('kick-user', { kickedClientId: clientId }); }
function handlePromotion(data) {
    alert("Admin role is being transferred. The room will now reload.");
    if (data.newAdminClientId === CLIENT_ID) { window.location.href = `/admin/${ROOM_ID}`; } 
    else { window.location.href = `/join/${ROOM_ID}`; }
}

// --- Sync & User Logic ---
function handleSyncRequest(data) {
    if (!player || player.getPlayerState() === -1) return;
    const syncData = { videoId: currentVideoId, currentTime: player.getCurrentTime(), state: player.getPlayerState(), targetClientId: data.requesterClientId, nowPlaying: nowPlayingItem, queue: videoQueue };
    channel.publish('sync-response', syncData);
}
function handleSync(data) {
    if (data.nowPlaying) handleNowPlayingUpdated({ item: data.nowPlaying });
    if (data.queue) handleQueueUpdated({ queue: data.queue });
    const applyVideoSync = () => {
        isEventFromAbly = true;
        if (data.videoId) {
            isResyncing = true;
            lastKnownTime = data.currentTime || 0;
            if (player.getVideoData().video_id === data.videoId) { player.seekTo(data.currentTime, true); } 
            else { player.loadVideoById(data.videoId, data.currentTime); }
            if (data.state === YT.PlayerState.PLAYING) player.playVideo(); else player.pauseVideo();
        }
    };
    if (!isYouTubeApiReady) { window.onYouTubeIframeAPIReady = () => { isYouTubeApiReady = true; createPlayer(data.videoId, applyVideoSync); }; } 
    else if (!player) { createPlayer(data.videoId, applyVideoSync); } 
    else { applyVideoSync(); }
}
function requestToJoinWithRetry() {
    console.log("Requesting to join...");
    channel.publish('request-join', { nickname: NICKNAME, clientId: CLIENT_ID });
    setTimeout(() => {
        if (waitingOverlay && waitingOverlay.style.display !== 'none') {
            console.log("Join approval not received, retrying...");
            requestToJoinWithRetry();
        }
    }, 5000);
}
function handleApproval() {
    if (waitingOverlay) waitingOverlay.style.display = 'none';
    channel.publish('sync-request', { requesterClientId: CLIENT_ID });
    displayChatMessage({ nickname: 'System', text: 'You have been admitted to the room.', isSystem: true });
}
function handleKick() { alert("You have been removed from the room by the admin."); ably.close(); window.location.href = '/'; }
function handleRoomEnded(data) { alert(data.message); ably.close(); window.location.href = '/'; }

// --- Real-time Video Control Handlers ---
function handleSetVideo(data) {
    currentVideoId = data.videoId; lastPlayerState = -1;
    lastKnownTime = 0;
    if (IS_ADMIN_FLAG) {
        try { localStorage.setItem(`lastVideoState_${ROOM_ID}`, JSON.stringify({ videoId: data.videoId, time: 0 })); } 
        catch (e) { console.warn("Could not save set-video state:", e); }
    }
    if (player && typeof player.loadVideoById === 'function') { isEventFromAbly = true; player.loadVideoById(currentVideoId); } 
    else if (isYouTubeApiReady) { createPlayer(currentVideoId); }
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
    if (player) {
        try {
            if (player.getVideoData().video_id !== videoId) { player.loadVideoById(videoId, lastKnownTime || 0); } 
            else { player.seekTo(lastKnownTime || 0, true); }
        } catch (e) { console.warn("Error reusing player:", e); }
        if (onReadyCallback) onReadyCallback();
        return;
    }
    player = new YT.Player('player', {
        height: '100%', width: '100%', videoId: videoId,
        playerVars: { playsinline: 1, autoplay: 0, controls: IS_ADMIN_FLAG ? 1 : 0, origin: window.location.origin },
        events: { 'onReady': (event) => {
            try {
                if (lastKnownTime && lastKnownTime > 0) {
                    if (event.target.getVideoData().video_id === videoId) { event.target.seekTo(lastKnownTime, true); } 
                    else { event.target.loadVideoById(videoId, lastKnownTime); }
                }
            } catch (e) { console.warn("Error seeking on ready:", e); }
            if (IS_ADMIN_FLAG && nowPlayingItem) { event.target.playVideo(); }
            if (onReadyCallback) onReadyCallback(event);
        }, 'onStateChange': onPlayerStateChange }
    });
}
function onPlayerStateChange(event) {
    if (isEventFromAbly) { isEventFromAbly = false; return; }
    if (isResyncing && event.data === YT.PlayerState.PLAYING) { isResyncing = false; return; }
    if (!IS_ADMIN_FLAG) { return; }
    if (event.data === lastPlayerState) return;
    lastPlayerState = event.data;
    switch (event.data) {
        case YT.PlayerState.PLAYING: channel.publish('play', { currentTime: player.getCurrentTime() }); break;
        case YT.PlayerState.PAUSED: channel.publish('pause', {}); break;
        case YT.PlayerState.ENDED: playNextInQueue(); break;
    }
}

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// --- Event Listeners ---
if (copyRoomIdBtn) {
    copyRoomIdBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(roomIdText.textContent).then(() => {
            copyFeedback.style.opacity = '1';
            setTimeout(() => { copyFeedback.style.opacity = '0'; }, 2000);
        }).catch(err => { console.error('Failed to copy room ID: ', err); });
    });
}
addToQueueBtn.addEventListener('click', async () => {
    addToQueueBtn.disabled = true;
    const newItem = await getVideoItemFromUrl();
    if (newItem) { channel.publish('add-to-queue', newItem); }
    addToQueueBtn.disabled = false;
});

if (IS_ADMIN_FLAG) {
    userListContainer.addEventListener('click', (e) => {
        const kickBtn = e.target.closest('.kick-btn');
        const promoteBtn = e.target.closest('.promote-btn');
        const notifBtn = e.target.closest('.notif-btn');

        if (kickBtn && confirm("Are you sure you want to kick this user?")) {
            kickUser(kickBtn.dataset.kickId);
        }

        if (promoteBtn && confirm("Are you sure you want to make this user the new admin?")) {
            channel.publish('promote-to-admin', { newAdminClientId: promoteBtn.dataset.promoteId });
        }

        if (notifBtn) {
            // Send the command to the user in the background
            channel.publish('toggle-user-notifications', { targetClientId: notifBtn.dataset.notifId });

            // OPTIMISTIC UI UPDATE: Update the icon instantly for the admin.
            showToast('User notification preference updated.', 'info', 2000);
            if (notifBtn.textContent === '🔔') {
                // Change icon to muted
                notifBtn.textContent = '🔕';
                notifBtn.classList.remove('text-gray-400');
                notifBtn.classList.add('text-red-400');
            } else {
                // Change icon to unmuted
                notifBtn.textContent = '🔔';
                notifBtn.classList.remove('text-red-400');
                notifBtn.classList.add('text-gray-400');
            }
        }
    });

    queueListContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-queue-btn');
        if (removeBtn) {
            videoQueue = videoQueue.filter(item => item.videoId !== removeBtn.dataset.videoId);
            channel.publish('queue-updated', { queue: videoQueue });
        }
    });
    playImmediatelyBtn.addEventListener('click', async () => {
        playImmediatelyBtn.disabled = true;
        const newItem = await getVideoItemFromUrl();
        if (newItem) { playItemNow(newItem); }
        playImmediatelyBtn.disabled = false;
    });
    endRoomBtn.addEventListener('click', () => {
        if (confirm("End the session for everyone?")) {
            channel.publish('room-ended', { message: 'The admin has ended the session.' });
            setTimeout(() => { ably.close(); window.location.href = '/'; }, 500);
        }
    });
} else {
    leaveRoomBtn.addEventListener('click', () => { ably.close(); window.location.href = '/'; });
    changeNameBtn.addEventListener('click', async () => {
        const newName = prompt("Enter your new name:", NICKNAME);
        if (isNameValid(newName)) {
            const oldName = NICKNAME;
            NICKNAME = newName.trim();
            await channel.presence.update({ nickname: NICKNAME, notificationsMuted: areNotificationsMuted });
            displayChatMessage({ nickname: 'System', text: `"${oldName}" is now known as "${NICKNAME}"`, isSystem: true });
        }
    });
    if(syncRoomBtn) {
        syncRoomBtn.addEventListener('click', () => {
            displayChatMessage({ nickname: 'System', text: 'Re-syncing with the room...', isSystem: true });
            channel.publish('sync-request', { requesterClientId: CLIENT_ID });
        });
    }
    if (fullscreenBtn && playerWrapper) { fullscreenBtn.addEventListener('click', () => { if (playerWrapper.requestFullscreen) { playerWrapper.requestFullscreen(); } else if (playerWrapper.webkitRequestFullscreen) { playerWrapper.webkitRequestFullscreen(); } }); }
    if (muteBtn && volumeSlider) {
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

// --- Admin periodic time broadcast ---
let adminBroadcastIntervalId = null;
function startAdminTimeBroadcast() {
    if (!IS_ADMIN_FLAG) return;
    adminBroadcastIntervalId = setInterval(() => {
        if (player && typeof player.getPlayerState === 'function' && player.getPlayerState() === YT.PlayerState.PLAYING) {
            try {
                const t = player.getCurrentTime();
                const videoId = player.getVideoData().video_id;
                if (videoId) {
                    currentVideoId = videoId;
                    channel.publish('time-update', { videoId: currentVideoId, currentTime: t });
                    localStorage.setItem(`lastVideoState_${ROOM_ID}`, JSON.stringify({ videoId: currentVideoId, time: t }));
                }
            } catch (e) { /* ignore errors */ }
        }
    }, 5000);
}

// --- Notification Control Logic ---
function initNotificationControls() {
    const savedPref = localStorage.getItem('notificationsMuted');
    if (savedPref === 'true') {
        areNotificationsMuted = true;
        notificationsOnIcon.classList.add('hidden');
        notificationsOffIcon.classList.remove('hidden');
        toggleNotificationsBtn.setAttribute('title', 'Unmute Notifications');
    }

    toggleNotificationsBtn.addEventListener('click', () => {
        areNotificationsMuted = !areNotificationsMuted;
        localStorage.setItem('notificationsMuted', areNotificationsMuted.toString());
        channel.presence.update({ nickname: NICKNAME, notificationsMuted: areNotificationsMuted });
        
        if (areNotificationsMuted) {
            notificationsOnIcon.classList.add('hidden');
            notificationsOffIcon.classList.remove('hidden');
            toggleNotificationsBtn.setAttribute('title', 'Unmute Notifications');
        } else {
            notificationsOnIcon.classList.remove('hidden');
            notificationsOffIcon.classList.add('hidden');
            toggleNotificationsBtn.setAttribute('title', 'Mute Notifications');
        }
    });

    // This listener fixes the "audio not playing" bug
    document.body.addEventListener('click', () => {
        hasInteracted = true;
    }, { once: true });

    // Visibility change for toast on tab focus
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && unreadCount > 0) {
            showToast(`You have ${unreadCount} new messages`, 'info', 4000);
            unreadCount = 0;
        }
    });
}

// --- Emoji Picker Logic ---
function initEmojiPicker() {
    const emojis = ['😀', '😂', '😍', '🤔', '😎', '😢', '🔥', '❤️', '👍', '👎', '🎉', '🚀', '💯', '👏', '👀', '🍿'];
    emojis.forEach(emoji => {
        const button = document.createElement('button');
        button.className = 'p-1 text-2xl rounded-md hover:bg-gray-700 transition-colors';
        button.textContent = emoji;
        button.addEventListener('click', () => {
            chatInput.value += emoji;
            emojiPicker.classList.add('hidden');
            chatInput.focus();
        });
        emojiPicker.appendChild(button);
    });
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
            emojiPicker.classList.add('hidden');
        }
    });
}

// --- Startup ---
main();
initEmojiPicker();