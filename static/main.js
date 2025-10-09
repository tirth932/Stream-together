const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA'; // <--- REPLACE THIS
const ROOM_ID = document.location.pathname.split('/').pop();
const IS_ADMIN = document.getElementById('admin-controls') !== null;

// --- DOM Elements ---
const urlInput = document.getElementById('youtube-url');
const setVideoBtn = document.getElementById('set-video-btn');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const userListContainer = document.getElementById('user-list');
const participantCount = document.getElementById('participant-count');
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

// --- Helper Functions ---
function getUserNickname() {
    if (IS_ADMIN) return 'Admin';
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

    // --- UPDATED: All users now subscribe to presence and update the list ---
    channel.presence.subscribe(['enter', 'leave'], updateParticipantList);
    updateParticipantList();

    if (!IS_ADMIN) {
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
        case 'request-join': if (IS_ADMIN) handleJoinRequest(message.data); break;
        case 'approve-join': if (message.data.approvedNickname === NICKNAME) handleApproval(); break;
        case 'sync-request': if (IS_ADMIN) handleSyncRequest(message.data); break;
        case 'sync-response': if (message.data.targetNickname === NICKNAME) handleSync(message.data); break;
        case 'kick-user': if (message.data.kickedNickname === NICKNAME) handleKick(); break;
        case 'chat-message': displayChatMessage(message.data.nickname, message.data.text); break;
    }
}

// --- Chat Logic ---
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text) { channel.publish('chat-message', { nickname: NICKNAME, text: text }); chatInput.value = ''; }
}
function displayChatMessage(nickname, text) {
    const isAdminMessage = nickname.toLowerCase() === 'admin';
    const messageEl = document.createElement('div');
    messageEl.innerHTML = `<p class="text-sm"><strong class="${isAdminMessage ? 'text-purple-400' : 'text-blue-300'}">${nickname}:</strong> <span class="text-gray-200">${text}</span></p>`;
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
        
        // --- UPDATED: Kick button is now added conditionally based on IS_ADMIN flag ---
        const kickButtonHTML = IS_ADMIN && !isAdmin
            ? `<button data-kick-id="${member.clientId}" class="kick-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-2 rounded">Kick</button>`
            : '';

        const adminTagHTML = isAdmin ? `<span class="text-xs font-bold text-purple-400">[Admin]</span>` : '';

        const userEl = document.createElement('div');
        userEl.className = 'flex justify-between items-center bg-gray-800 p-2 rounded';
        userEl.innerHTML = `
            <div class="flex items-center gap-2">
              <span class="text-gray-300">${member.clientId}</span>
              ${adminTagHTML}
            </div>
            ${kickButtonHTML}
        `;
        userListContainer.appendChild(userEl);
    });
}
function handleJoinRequest(data) { channel.publish('approve-join', { approvedNickname: data.nickname }); }
function kickUser(nickname) { if (!IS_ADMIN) return; channel.publish('kick-user', { kickedNickname: nickname }); }

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
    displayChatMessage('System', 'You have been admitted to the room.');
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
        playerVars: { playsinline: 1, autoplay: 1, controls: IS_ADMIN ? 1 : 0, origin: window.location.origin },
        events: { 'onReady': (event) => { if (onReadyCallback) onReadyCallback(event); }, 'onStateChange': onPlayerStateChange }
    });
}
function onPlayerStateChange(event) {
    if (isEventFromAbly) { isEventFromAbly = false; return; }
    if (!IS_ADMIN && event.data === YT.PlayerState.PAUSED) { player.playVideo(); return; }
    if (!IS_ADMIN) return;
    if (event.data === lastPlayerState) return;
    lastPlayerState = event.data;
    switch (event.data) {
        case YT.PlayerState.PLAYING: channel.publish('play', { currentTime: player.getCurrentTime() }); break;
        case YT.PlayerState.PAUSED: channel.publish('pause', {}); break;
    }
}

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// --- Event Listeners ---
if (IS_ADMIN) {
    setVideoBtn.addEventListener('click', () => {
        const videoId = extractVideoID(urlInput.value);
        if (!videoId) return alert("Invalid YouTube URL.");
        channel.publish('set-video', { videoId: videoId });
        urlInput.value = '';
    });
    // This event listener is on the container, which is now visible to all, but the 'kick-btn' class will only exist in the admin's view.
    userListContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('kick-btn')) {
            const nicknameToKick = e.target.dataset.kickId;
            if (nicknameToKick) kickUser(nicknameToKick);
        }
    });
} else {
    // --- Viewer-Specific Control Logic ---
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
