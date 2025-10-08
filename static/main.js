// static/main.js

// --- Configuration ---
const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA';
const ROOM_ID = document.location.pathname.replace("/", "");

// --- State ---
let player;
let isEventFromAbly = false;
let lastPlayerState = -1;
let isYouTubeApiReady = false;
let initialVideoId = null;
let currentVideoId = null;
let currentTime = 0;
let pendingSync = null; // store sync for late joiners

// --- Connect to Ably ---
const ably = new Ably.Realtime({ key: ABLY_API_KEY });
const channel = ably.channels.get(`stream-together:${ROOM_ID}`);

channel.on('attached', () => {
    console.log('✅ Channel attached, requesting sync...');
    requestSync();
});

ably.connection.on('connected', () => console.log("✅ Connected to Ably"));
ably.connection.on('failed', () => console.error("❌ Ably connection failed"));

// --- Ably Subscriptions ---
channel.subscribe('set-video', (msg) => handleSetVideo(msg.data));
channel.subscribe('play', (msg) => handlePlay(msg.data));
channel.subscribe('pause', (msg) => handlePause(msg.data));
channel.subscribe('sync-request', (msg) => handleSyncRequest(msg.data));
channel.subscribe('sync-response', (msg) => handleSyncResponse(msg.data));

// --- Handle set-video ---
function handleSetVideo(data) {
    console.log("Received 'set-video':", data);
    currentVideoId = data.videoId;
    currentTime = data.currentTime || 0;

    if (player) {
        isEventFromAbly = true;
        player.loadVideoById(currentVideoId);
        setTimeout(() => {
            player.seekTo(currentTime, true);
        }, 500);
    } else {
        initialVideoId = currentVideoId;
        if (isYouTubeApiReady) createPlayer(initialVideoId);
    }
}

// --- Play/Pause Handlers ---
function handlePlay(data) {
    if (!player) return;
    currentTime = data.currentTime;
    isEventFromAbly = true;
    player.seekTo(currentTime, true);
    player.playVideo();
}

function handlePause() {
    if (!player) return;
    currentTime = player.getCurrentTime();
    isEventFromAbly = true;
    player.pauseVideo();
}

// --- Sync for late joiners ---
function requestSync() {
    channel.publish('sync-request', {});
}

function handleSyncRequest() {
    if (!currentVideoId) return;
    channel.publish('sync-response', {
        videoId: currentVideoId,
        currentTime: player ? player.getCurrentTime() : 0,
        state: player ? player.getPlayerState() : YT.PlayerState.PAUSED
    });
}

function handleSyncResponse(data) {
    pendingSync = data;
    if (player) applyPendingSync();
    else if (isYouTubeApiReady) createPlayer(data.videoId);
}

function applyPendingSync() {
    if (!pendingSync || !player) return;

    isEventFromAbly = true;
    player.loadVideoById(pendingSync.videoId);

    setTimeout(() => {
        player.seekTo(pendingSync.currentTime || 0, true);
        if (pendingSync.state === YT.PlayerState.PLAYING) player.playVideo();
        else player.pauseVideo();
        pendingSync = null;
    }, 500);
}

// --- YouTube IFrame API ---
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, null);

function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready");
    isYouTubeApiReady = true;
    if (initialVideoId) createPlayer(initialVideoId);
}

function createPlayer(videoId) {
    if (player) return;

    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { playsinline: 1, autoplay: 1, controls: 1, origin: window.location.origin },
        events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange }
    });
}

function onPlayerReady(event) {
    console.log("Player ready");
    if (pendingSync) applyPendingSync();
    else if (currentTime > 0) event.target.seekTo(currentTime, true);
    event.target.playVideo();
}

function onPlayerStateChange(event) {
    if (isEventFromAbly) { isEventFromAbly = false; return; }
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

// --- Set Video Button ---
document.getElementById('set-video-btn').addEventListener('click', () => {
    const url = document.getElementById('youtube-url').value;
    const videoId = extractVideoID(url);
    if (!videoId) return alert("Invalid YouTube URL.");

    currentVideoId = videoId;
    currentTime = 0;
    channel.publish('set-video', { videoId, currentTime });

    if (!player) createPlayer(videoId);
    else player.loadVideoById(videoId);
});

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}
