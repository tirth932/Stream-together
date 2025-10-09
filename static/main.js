// static/main.js

// --- Configuration ---
// IMPORTANT: Replace with your Ably API key.
const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA'; // <--- REPLACE THIS
const ROOM_ID = document.location.pathname.split('/').pop();
const IS_ADMIN = document.getElementById('admin-controls') !== null;
const NICKNAME = IS_ADMIN ? 'Admin' : `User-${Math.random().toString(36).substring(2, 6)}`;

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

// --- Connect to Ably ---
const ably = new Ably.Realtime.Promise({ key: ABLY_API_KEY, clientId: NICKNAME });
const channel = ably.channels.get(`stream-together:${ROOM_ID}`);

// --- Main Application Logic ---
async function main() {
    console.log(`Welcome! You are ${IS_ADMIN ? 'an Admin' : 'a User'}. Nickname: ${NICKNAME}`);
    
    await channel.presence.enter();
    console.log("✅ Presence entered.");

    // Subscribe to all relevant channel messages
    channel.subscribe(handleAblyMessages);

    // If admin, subscribe to presence events to manage users
    if (IS_ADMIN) {
        channel.presence.subscribe(['enter', 'leave'], updateAdminUserList);
        // Initial population of user list
        updateAdminUserList();
    }
    
    // If a normal user, request to join the room
    if (!IS_ADMIN) {
        channel.publish('request-join', { clientId: ably.auth.clientId, nickname: NICKNAME });
    }
}

// --- Ably Message Handler ---
function handleAblyMessages(message) {
    console.log("Received Ably message:", message.name, message.data);

    switch (message.name) {
        case 'set-video':
            handleSetVideo(message.data);
            break;
        case 'play':
            handlePlay(message.data);
            break;
        case 'pause':
            handlePause();
            break;
        case 'sync':
            handleSync(message.data);
            break;
        case 'chat-message':
            displayChatMessage(message.data.nickname, message.data.text);
            break;
        case 'request-join':
            if (IS_ADMIN) handleJoinRequest(message.data);
            break;
        case 'approve-join':
            if (message.data.clientId === ably.auth.clientId) handleApproval();
            break;
        case 'kick-user':
             if (message.data.clientId === ably.auth.clientId) handleKick();
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
    
    userListContainer.innerHTML = ''; // Clear list
    const members = await channel.presence.get();
    
    members.forEach(member => {
        if (member.clientId.toLowerCase() === 'admin') return; // Don't list the admin themselves

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
    // Optional: Add a UI notification for the admin
    console.log(`${data.nickname} wants to join.`);
    // For now, we auto-approve everyone. 
    // You could build a UI with approve/deny buttons that call this function.
    channel.publish('approve-join', { clientId: data.clientId });
}

function kickUser(clientId) {
    if (!IS_ADMIN) return;
    channel.publish('kick-user', { clientId: clientId });
}


// --- User-Specific Logic ---
function handleApproval() {
    if (waitingOverlay) {
        waitingOverlay.style.display = 'none';
    }
    // Once approved, request a full sync from the admin
    channel.publish('request-sync', { clientId: ably.auth.clientId });
    displayChatMessage('System', 'You have been admitted to the room.');
}

function handleKick() {
    alert("You have been removed from the room by the admin.");
    ably.close();
    document.body.innerHTML = '<div class="fixed inset-0 bg-black flex items-center justify-center"><h1 class="text-2xl text-red-500">You have been kicked.</h1></div>';
}


// --- Video Sync Logic ---
function handleSetVideo(data) {
    currentVideoId = data.videoId;
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

// Full sync for new joiners
function handleSync(data) {
    handleSetVideo({ videoId: data.videoId });
    setTimeout(() => {
        if (!player) return;
        isEventFromAbly = true;
        player.seekTo(data.currentTime, true);
        if (data.state === YT.PlayerState.PLAYING) {
            player.playVideo();
        } else {
            player.pauseVideo();
        }
    }, 1000); // Wait a moment for video to load
}


// --- YouTube IFrame API ---
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready");
    isYouTubeApiReady = true;
    // Player will be created when the first 'set-video' or 'sync' message arrives.
}

function createPlayer(videoId) {
    if (player) return;
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { 
            playsinline: 1, 
            autoplay: 1, 
            controls: IS_ADMIN ? 1 : 0, // Only admin gets controls
            origin: window.location.origin 
        },
        events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
    });
}

function onPlayerReady(event) {
    console.log("Player ready");
}

function onPlayerStateChange(event) {
    if (!IS_ADMIN || isEventFromAbly) {
        isEventFromAbly = false;
        return;
    }
    
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
            const clientIdToKick = e.target.dataset.kickId;
            if (clientIdToKick) kickUser(clientIdToKick);
        }
    });
}

sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// --- Start the app ---
main();