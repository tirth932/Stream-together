const ROOM_ID = document.location.pathname.split('/').pop();
const IS_ADMIN = document.getElementById('admin-controls') !== null;

// --- DOM Elements ---
const urlInput = document.getElementById('youtube-url');
const setVideoBtn = document.getElementById('set-video-btn');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const userListContainer = document.getElementById('user-list');
const waitingOverlay = document.getElementById('waiting-overlay');

// --- State ---
let player;
let isEventFromAbly = false;
let isYouTubeApiReady = false;
let currentVideoId = null;
let lastPlayerState = -1;
let NICKNAME; // Will be set after the prompt

// --- Helper Functions ---
function getUserNickname() {
    if (IS_ADMIN) return 'Admin';
    let name = '';
    while (!name || name.trim().length === 0) {
        name = prompt("Please enter your name to join the room:", "");
        if (name === null) { // User clicked cancel
            name = `Guest-${Math.random().toString(36).substring(2, 6)}`;
            break;
        }
    }
    return name.trim();
}

// --- Ably Connection & Main Logic ---
let ably, channel;

async function main() {
    NICKNAME = getUserNickname();
    
    ably = new Ably.Realtime.Promise({ key: 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA', clientId: NICKNAME });
    channel = ably.channels.get(`stream-together:${ROOM_ID}`);
    
    console.log(`Welcome! You are ${IS_ADMIN ? 'an Admin' : 'a User'}. Nickname: ${NICKNAME}`);
    
    await channel.presence.enter();
    console.log("✅ Presence entered.");

    channel.subscribe(handleAblyMessages);

    if (IS_ADMIN) {
        channel.presence.subscribe(['enter', 'leave'], updateAdminUserList);
        updateAdminUserList();
    } else {
        channel.publish('request-join', { nickname: NICKNAME });
    }
}

// --- Ably Message Handler ---
function handleAblyMessages(message) {
    console.log("Received Ably message:", message.name, message.data);

    switch (message.name) {
        // Video Controls
        case 'set-video':
            handleSetVideo(message.data);
            break;
        case 'play':
            handlePlay(message.data);
            break;
        case 'pause':
            handlePause();
            break;

        // User & Sync Management
        case 'request-join':
            if (IS_ADMIN) handleJoinRequest(message.data);
            break;
        case 'approve-join':
            if (message.data.approvedNickname === NICKNAME) handleApproval();
            break;
        case 'sync-request':
            if (IS_ADMIN) handleSyncRequest(message.data);
            break;
        case 'sync-response':
            if (message.data.targetNickname === NICKNAME) handleSync(message.data);
            break;
        case 'kick-user':
             if (message.data.kickedNickname === NICKNAME) handleKick();
            break;

        // Chat
        case 'chat-message':
            displayChatMessage(message.data.nickname, message.data.text);
            break;
    }
}

// --- Chat Logic ---
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text) {
        channel.publish('chat-message', { nickname: NICKNAME, text: text });
        chatInput.value = '';
    }
}

function displayChatMessage(nickname, text) {
    const isAdminMessage = nickname.toLowerCase() === 'admin';
    const messageEl = document.createElement('div');
    messageEl.innerHTML = `
        <p class="text-sm">
            <strong class="${isAdminMessage ? 'text-purple-400' : 'text-blue-300'}">${nickname}:</strong>
            <span class="text-gray-200">${text}</span>
        </p>`;
    chatMessagesContainer.appendChild(messageEl);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}


// --- Admin-Specific Logic ---
async function updateAdminUserList() {
    if (!IS_ADMIN || !userListContainer) return;
    
    userListContainer.innerHTML = '';
    const members = await channel.presence.get();
    
    members.forEach(member => {
        if (member.clientId.toLowerCase() === 'admin') return;

        const userEl = document.createElement('div');
        userEl.className = 'flex justify-between items-center bg-gray-800 p-2 rounded';
        userEl.innerHTML = `
            <span class="text-gray-300">${member.clientId}</span>
            <button data-kick-id="${member.clientId}" class="kick-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-2 rounded">Kick</button>
        `;
        userListContainer.appendChild(userEl);
    });
}

function handleJoinRequest(data) {
    // Auto-approve users upon request.
    channel.publish('approve-join', { approvedNickname: data.nickname });
}

function kickUser(nickname) {
    if (!IS_ADMIN) return;
    channel.publish('kick-user', { kickedNickname: nickname });
}

// --- Sync Logic for Late Joiners ---

// Step 2 (Admin): Receive request and provide sync data.
function handleSyncRequest(data) {
    if (!player || !currentVideoId) return; // Don't sync if nothing is playing

    const syncData = {
        videoId: currentVideoId,
        currentTime: player.getCurrentTime(),
        state: player.getPlayerState(),
        targetNickname: data.requesterNickname
    };
    channel.publish('sync-response', syncData);
    console.log(`Sent sync data to ${data.requesterNickname}`);
}

// Step 3 (User): Receive sync data and apply it.
function handleSync(data) {
    console.log("Applying sync data:", data);
    // Ensure the player is ready before applying sync
    if (!isYouTubeApiReady) {
        // If API isn't ready, wait for it, then create player with sync data
        window.onYouTubeIframeAPIReady = () => {
             isYouTubeApiReady = true;
             createPlayer(data.videoId, () => applySyncData(data));
        };
    } else if (!player) {
        // If API is ready but player doesn't exist, create it
        createPlayer(data.videoId, () => applySyncData(data));
    } else {
        // If player already exists, just apply the data
        applySyncData(data);
    }
}

function applySyncData(data) {
    isEventFromAbly = true;
    player.loadVideoById(data.videoId);
    player.seekTo(data.currentTime, true);
    if (data.state === YT.PlayerState.PLAYING) {
        player.playVideo();
    } else {
        player.pauseVideo();
    }
}


// --- User-Specific Logic ---
// Step 1 (User): Get approved and request a sync.
function handleApproval() {
    if (waitingOverlay) {
        waitingOverlay.style.display = 'none';
    }
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
    lastPlayerState = -1; // Reset state for new video
    if (player && typeof player.loadVideoById === 'function') {
        isEventFromAbly = true;
        player.loadVideoById(currentVideoId);
    } else if (isYouTubeApiReady) {
        createPlayer(currentVideoId);
    }
}

function handlePlay(data) {
    if (!player) return;
    isEventFromAbly = true;
    player.seekTo(data.currentTime, true);
    player.playVideo();
}

function handlePause() {
    if (!player) return;
    isEventFromAbly = true;
    player.pauseVideo();
}


// --- YouTube IFrame API Setup ---
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// This function is called by the YouTube API script when it's ready.
function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready");
    isYouTubeApiReady = true;
}

function createPlayer(videoId, onReadyCallback) {
    if (player) return;
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { 
            playsinline: 1, 
            autoplay: 1, 
            controls: IS_ADMIN ? 1 : 0, // Only admin gets player controls
            origin: window.location.origin 
        },
        events: { 
            'onReady': (event) => {
                console.log("Player is ready.");
                if (onReadyCallback) onReadyCallback(event);
            }, 
            'onStateChange': onPlayerStateChange 
        }
    });
}

function onPlayerStateChange(event) {
    if (isEventFromAbly) {
        isEventFromAbly = false;
        return;
    }
    if (!IS_ADMIN) return;

    if (event.data === lastPlayerState) return;
    lastPlayerState = event.data;
    
    switch (event.data) {
        case YT.PlayerState.PLAYING:
            channel.publish('play', { currentTime: player.getCurrentTime() });
            break;
        case YT.PlayerState.PAUSED:
            channel.publish('pause', {});
            break;
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

    userListContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('kick-btn')) {
            const nicknameToKick = e.target.dataset.kickId;
            if (nicknameToKick) kickUser(nicknameToKick);
        }
    });
}

sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// --- Start the app ---
main();