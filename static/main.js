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
// New Copy Button Elements
const copyRoomIdBtn = document.getElementById('copy-room-id-btn');
const roomIdText = document.getElementById('room-id-text');
const copyFeedback = document.getElementById('copy-feedback');
// === NEW: Notification elements ===
const toasterContainer = document.getElementById('toaster-container');
const toggleNotifsBtn = document.getElementById('toggle-notifs-btn');
// === END NEW ===

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
// === NEW: Notification state ===
let areNotificationsMuted = localStorage.getItem('notificationsMuted') === 'true';
let mutedForNotificationsByAdmin = []; // Array of client IDs muted by admin
let audioCtx; // For Web Audio API
// === END NEW ===

// --- Helper Functions ---
function isNameValid(name) {
    nameError.textContent = ''; // Clear previous errors
    if (!name || name.trim().length === 0) {
        nameError.textContent = "Name cannot be empty.";
        return false;
    }
    if (name.length < 2 || name.length > 20) {
        nameError.textContent = "Name must be between 2 and 20 characters.";
        return false;
    }
    if (name.trim().toLowerCase() === 'admin' && !IS_ADMIN_FLAG) {
        nameError.textContent = "That name is reserved.";
        return false;
    }
    return true;
}

function getIdentity() {
    return new Promise((resolve) => {
        nameModalOverlay.classList.remove('hidden');
        nameModalOverlay.classList.add('visible');
        nameForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = nameInput.value.trim();
            if (isNameValid(name)) {
                NICKNAME = name;
                if (IS_ADMIN_FLAG) {
                    CLIENT_ID = 'admin-client';
                } else {
                    CLIENT_ID = `viewer-${Math.random().toString(36).substring(2, 10)}`;
                }
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

// === NEW: Notification Functions ===
function playNotificationSound() {
    if (areNotificationsMuted) return;
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        console.warn("Could not play notification sound:", e);
    }
}

function showToaster(title, body) {
    if (!toasterContainer) return;
    const toaster = document.createElement('div');
    toaster.className = 'bg-gray-800 border border-purple-500 rounded-lg p-4 shadow-lg transition-all duration-300 transform translate-x-full';
    toaster.innerHTML = `<strong class="text-purple-400 block">${title}</strong><p class="text-gray-200 text-sm">${body}</p>`;
    toasterContainer.appendChild(toaster);
    
    setTimeout(() => { // Animate in
        toaster.classList.remove('translate-x-full');
    }, 10);
    
    setTimeout(() => { // Animate out
        toaster.style.opacity = '0';
        setTimeout(() => toaster.remove(), 500);
    }, 4000);
}
// === END NEW ===

// --- Ably Connection & Main Logic ---
let ably, channel;
async function main() {
    await getIdentity();

    // === NEW: Request notification permissions early ===
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
    // === END NEW ===
    
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
        const lastNowPlayingMsg = history.items.find(msg => msg.name === 'now-playing-updated');
        const lastQueueMsg = history.items.find(msg => msg.name === 'queue-updated');
        // === NEW: Get latest notification settings from history ===
        const lastNotifSettingsMsg = history.items.find(msg => msg.name === 'notification-settings-updated');
        if (lastNotifSettingsMsg) {
            mutedForNotificationsByAdmin = lastNotifSettingsMsg.data.mutedIds || [];
        }
        // === END NEW ===
        const timeUpdateMsgs = history.items.filter(msg => msg.name === 'time-update');
        let lastTimeForVideo = null;
        if (timeUpdateMsgs.length > 0) {
            const relevantTimes = timeUpdateMsgs.filter(m => m.data && m.data.videoId === currentVideoId);
            lastTimeForVideo = relevantTimes.length > 0 ? relevantTimes[0] : timeUpdateMsgs[0];
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

    await channel.presence.enter({ nickname: NICKNAME });
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
        case 'chat-message': displayChatMessage(message.data); break; // MODIFIED
        case 'add-to-queue': if (IS_ADMIN_FLAG) handleAddToQueue(message.data); break;
        case 'queue-updated': handleQueueUpdated(message.data); break;
        case 'now-playing-updated': handleNowPlayingUpdated(message.data); break;
        case 'room-ended': handleRoomEnded(message.data); break;
        case 'promote-to-admin': handlePromotion(message.data); break;
        // === NEW: Handle notification setting updates ===
        case 'notification-settings-updated':
            mutedForNotificationsByAdmin = message.data.mutedIds || [];
            if(IS_ADMIN_FLAG) updateParticipantList(); // Re-render to show mute status
            break;
        // === END NEW ===
        case 'time-update':
            if (message.data && message.data.videoId) {
                if (!currentVideoId) currentVideoId = message.data.videoId;
                if (message.data.videoId === currentVideoId) {
                    lastKnownTime = message.data.currentTime || 0;
                }
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
    try { localStorage.setItem(`lastVideoState_${ROOM_ID}`, JSON.stringify({ videoId: currentVideoId, time: 0 })); } 
    catch (e) { console.warn("Could not save now playing:", e); }
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
    try { localStorage.setItem(`lastVideoState_${ROOM_ID}`, JSON.stringify({ videoId: item.videoId, time: 0 })); } 
    catch (e) { console.warn("Could not save play-now state:", e); }
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
    channel.publish('chat-message', { nickname: NICKNAME, text: text });
    chatInput.value = '';
    emojiPicker.classList.add('hidden');
    sendChatBtn.disabled = true;
    setTimeout(() => { sendChatBtn.disabled = false; }, 2000);
}
// === MODIFIED: Complete rewrite of displayChatMessage for new UI and notifications ===
function displayChatMessage(data) {
    const { nickname, text, isSystem = false } = data;

    // --- 1. Notification Logic ---
    const shouldNotify = document.hidden && !areNotificationsMuted && !isSystem && !mutedForNotificationsByAdmin.includes(CLIENT_ID);
    if (shouldNotify) {
        playNotificationSound();
        showToaster(nickname, text);
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`New message from ${nickname}`, {
                body: text,
                icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M10 10 H90 V90 H10 Z' rx='15' fill='%23111827'/%3E%3Cpath d='M35 25 L75 50 L35 75 Z' fill='rgb(168, 85, 247)'/%3E%3C/svg%3E"
            });
        }
    }

    // --- 2. UI Logic ---
    const messageWrapper = document.createElement('div');
    const isSentByMe = (nickname === NICKNAME);

    if (isSystem) {
        messageWrapper.className = 'message-wrapper system';
        messageWrapper.innerHTML = `<p class="text-sm text-purple-300 italic">${text}</p>`;
    } else {
        messageWrapper.className = isSentByMe ? 'message-wrapper sent' : 'message-wrapper received';
        const messageCard = document.createElement('div');
        messageCard.className = `message-card ${isSentByMe ? 'sent' : 'received'}`;
        
        let content = '';
        if (!isSentByMe) {
            const isAdminMessage = nickname.toLowerCase() === 'admin';
            content += `<div class="message-sender ${isAdminMessage ? 'text-purple-400' : 'text-blue-300'}">${nickname}</div>`;
        }
        content += `<span class="text-gray-200">${text}</span>`;
        messageCard.innerHTML = content;
        messageWrapper.appendChild(messageCard);
    }
    
    chatMessagesContainer.appendChild(messageWrapper);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}
// === END MODIFIED ===

// --- Participant & Admin Logic ---
// === MODIFIED: updateParticipantList to include admin controls for notifications ===
async function updateParticipantList() {
    if (!userListContainer || !participantCount) return;
    const members = await channel.presence.get();
    participantCount.textContent = members.length;
    userListContainer.innerHTML = '';
    members.forEach(member => {
        const displayName = member.data ? member.data.nickname : member.clientId; 
        const isAdmin = member.clientId === 'admin-client';
        const isMutedForNotifs = mutedForNotificationsByAdmin.includes(member.clientId);

        const kickButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-kick-id="${member.clientId}" title="Kick User" class="kick-btn p-1 text-red-400 hover:text-red-200">🚫</button>` : '';
        const promoteButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-promote-id="${member.clientId}" title="Make Admin" class="promote-btn p-1 text-yellow-400 hover:text-yellow-200">👑</button>` : '';
        
        const notifMuteIcon = isMutedForNotifs
            ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.143 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0M3.17 5.12a9.043 9.043 0 0 1 1.413-1.412m-1.412 1.412L1.758 6.54M16.83 5.12a9.043 9.043 0 0 1 1.412 1.412m-1.412-1.412L18.242 6.54M12 21a9.043 9.043 0 0 1-9.4-9.567 9.043 9.043 0 0 1 1.412-1.412m15.176 0a9.043 9.043 0 0 1 1.412 1.412M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>`;
        const notifMuteButtonHTML = IS_ADMIN_FLAG && !isAdmin ? `<button data-notif-mute-id="${member.clientId}" title="${isMutedForNotifs ? 'Unmute Notifications' : 'Mute Notifications'}" class="notif-mute-btn p-1 text-cyan-400 hover:text-cyan-200">${notifMuteIcon}</button>` : '';

        const adminTagHTML = isAdmin ? `<span class="text-xs font-bold text-purple-400">[Admin]</span>` : '';
        const userEl = document.createElement('div');
        userEl.className = 'flex justify-between items-center bg-gray-800 p-2 rounded';
        userEl.innerHTML = `<div class="flex items-center gap-2"><span class="text-gray-300">${displayName}</span>${adminTagHTML}</div><div class="flex items-center gap-2">${notifMuteButtonHTML}${promoteButtonHTML}${kickButtonHTML}</div>`;
        userListContainer.appendChild(userEl);
    });
}
// === END MODIFIED ===
function handleJoinRequest(data) { channel.publish('approve-join', { approvedClientId: data.clientId, approvedNickname: data.nickname }); }
function kickUser(clientId) { if (!IS_ADMIN_FLAG) return; channel.publish('kick-user', { kickedClientId: clientId }); }
function handlePromotion(data) {
    alert("Admin role is being transferred. The room will now reload.");
    if (data.newAdminClientId === CLIENT_ID) { window.location.href = `/admin/${ROOM_ID}`;
    } else { window.location.href = `/join/${ROOM_ID}`; }
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
    displayChatMessage({ text: 'You have been admitted to the room.', isSystem: true }); // MODIFIED
}
function handleKick() { alert("You have been removed from the room by the admin."); ably.close(); window.location.href = '/'; }
function handleRoomEnded(data) { alert(data.message); ably.close(); window.location.href = '/'; }

// --- Real-time Video Control Handlers ---
function handleSetVideo(data) {
    currentVideoId = data.videoId;
    lastPlayerState = -1;
    lastKnownTime = 0;
    try { localStorage.setItem(`lastVideoState_${ROOM_ID}`, JSON.stringify({ videoId: currentVideoId, time: 0 })); } 
    catch (e) { console.warn("Could not save set-video state:", e); }
    if (player && typeof player.loadVideoById === 'function') {
        isEventFromAbly = true;
        player.loadVideoById(currentVideoId);
    } else if (isYouTubeApiReady) {
        createPlayer(currentVideoId);
    }
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
            if (player.getVideoData().video_id !== videoId) {
                player.loadVideoById(videoId, lastKnownTime || 0);
            } else {
                player.seekTo(lastKnownTime || 0, true);
            }
        } catch (e) { console.warn("Error reusing player, creating a new one:", e); }
        if (onReadyCallback) onReadyCallback();
        return;
    }
    player = new YT.Player('player', {
        height: '100%', width: '100%', videoId: videoId,
        playerVars: { playsinline: 1, autoplay: 0, controls: IS_ADMIN_FLAG ? 1 : 0, origin: window.location.origin, enablejsapi: 1 },
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
if (copyRoomIdBtn && roomIdText && copyFeedback) {
    copyRoomIdBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(roomIdText.textContent).then(() => {
            copyFeedback.style.opacity = '1';
            setTimeout(() => { copyFeedback.style.opacity = '0'; }, 2000);
        }).catch(err => { console.error('Failed to copy room ID: ', err); alert('Could not copy Room ID.'); });
    });
}
addToQueueBtn.addEventListener('click', async () => {
    addToQueueBtn.disabled = true;
    const newItem = await getVideoItemFromUrl();
    if (newItem) { channel.publish('add-to-queue', newItem); }
    addToQueueBtn.disabled = false;
});

if (IS_ADMIN_FLAG) {
    // === MODIFIED: Add event listener for notification mute button ===
    userListContainer.addEventListener('click', (e) => {
        const kickBtn = e.target.closest('.kick-btn');
        const promoteBtn = e.target.closest('.promote-btn');
        const notifMuteBtn = e.target.closest('.notif-mute-btn');

        if (kickBtn) { 
            const clientIdToKick = kickBtn.dataset.kickId; 
            if (clientIdToKick && confirm("Are you sure you want to kick this user?")) kickUser(clientIdToKick); 
        }
        if (promoteBtn) {
            const clientIdToPromote = promoteBtn.dataset.promoteId;
            if (clientIdToPromote && confirm("Are you sure you want to make this user the new admin? You will become a viewer.")) {
                channel.publish('promote-to-admin', { newAdminClientId: clientIdToPromote });
            }
        }
        if (notifMuteBtn) {
            const clientIdToMute = notifMuteBtn.dataset.notifMuteId;
            const index = mutedForNotificationsByAdmin.indexOf(clientIdToMute);
            if (index > -1) { mutedForNotificationsByAdmin.splice(index, 1); } 
            else { mutedForNotificationsByAdmin.push(clientIdToMute); }
            channel.publish('notification-settings-updated', { mutedIds: mutedForNotificationsByAdmin });
            updateParticipantList();
        }
    });
    // === END MODIFIED ===
    
    queueListContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-queue-btn');
        if (removeBtn) {
            const videoIdToRemove = removeBtn.dataset.videoId;
            videoQueue = videoQueue.filter(item => item.videoId !== videoIdToRemove);
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
        if (confirm("Are you sure you want to end the session for everyone?")) {
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
            await channel.presence.update({ nickname: NICKNAME });
            displayChatMessage({ text: `"${oldName}" is now known as "${NICKNAME}"`, isSystem: true }); // MODIFIED
        }
    });
    
    if(syncRoomBtn) {
        syncRoomBtn.addEventListener('click', () => {
            displayChatMessage({ text: 'Re-syncing with the room...', isSystem: true }); // MODIFIED
            channel.publish('sync-request', { requesterClientId: CLIENT_ID });
        });
    }

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
            } else if (newVolume == 0 && !player.isMuted()) { player.mute(); volumeOnIcon.classList.add('hidden'); volumeOffIcon.remove('hidden'); }
        });
    }

    // === NEW: Event listener for personal notification mute button ===
    if (toggleNotifsBtn) {
        const bellIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>`;
        const bellSlashIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.143 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0M3.17 5.12a9.043 9.043 0 0 1 1.413-1.412m-1.412 1.412L1.758 6.54M16.83 5.12a9.043 9.043 0 0 1 1.412 1.412m-1.412-1.412L18.242 6.54M12 21a9.043 9.043 0 0 1-9.4-9.567 9.043 9.043 0 0 1 1.412-1.412m15.176 0a9.043 9.043 0 0 1 1.412 1.412M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>`;

        function updateNotifsButton() {
            if (areNotificationsMuted) {
                toggleNotifsBtn.title = "Unmute Notifications";
                toggleNotifsBtn.innerHTML = bellSlashIcon;
            } else {
                toggleNotifsBtn.title = "Mute Notifications";
                toggleNotifsBtn.innerHTML = bellIcon;
            }
        }
        toggleNotifsBtn.addEventListener('click', () => {
            areNotificationsMuted = !areNotificationsMuted;
            localStorage.setItem('notificationsMuted', areNotificationsMuted);
            updateNotifsButton();
            displayChatMessage({ text: `Notifications ${areNotificationsMuted ? 'muted' : 'unmuted'}.`, isSystem: true });
        });
        updateNotifsButton(); // Set initial state on load
    }
    // === END NEW ===
}
sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });

// --- Admin periodic time broadcast and local persistence ---
let adminBroadcastIntervalId = null;
function startAdminTimeBroadcast() {
    if (!IS_ADMIN_FLAG) return;
    if (adminBroadcastIntervalId) return;
    adminBroadcastIntervalId = setInterval(() => {
        if (!player) return;
        try {
            if (player.getPlayerState() === YT.PlayerState.PLAYING) {
                const t = player.getCurrentTime();
                currentVideoId = player.getVideoData().video_id || currentVideoId;
                channel.publish('time-update', { videoId: currentVideoId, currentTime: t });
                try { localStorage.setItem(`lastVideoState_${ROOM_ID}`, JSON.stringify({ videoId: currentVideoId, time: t })); } 
                catch (e) { /* ignore localStorage failures */ }
            }
        } catch (e) { }
    }, 5000);
}
function stopAdminTimeBroadcast() {
    if (adminBroadcastIntervalId) {
        clearInterval(adminBroadcastIntervalId);
        adminBroadcastIntervalId = null;
    }
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