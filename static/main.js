// static/main.js

// --- Configuration ---
const ABLY_API_KEY = 'YOUR_API_KEY_GOES_HERE'; // Make sure your key is still here
const ROOM_ID = document.location.pathname.replace("/", "");

// --- Ably & Player State ---
let player;
let isEventFromAbly = false;
// ✨ NEW: Add a variable to track the last known state of the player.
let lastPlayerState = -1; // -1 is the "unstarted" state

const ably = new Ably.Realtime(ABLY_API_KEY);
const channel = ably.channels.get(`stream-together:${ROOM_ID}`);

console.log("Connecting to Ably...");

// --- Ably Communication ---
channel.subscribe('set-video', (message) => handleSetVideo(message.data));
channel.subscribe('play', (message) => handlePlay(message.data));
channel.subscribe('pause', (message) => handlePause(message.data));

// Handlers for incoming messages
function handleSetVideo(data) {
    console.log("Received 'set-video' event:", data);
    isEventFromAbly = true;
    if (!player) {
        createPlayer(data.videoId);
    } else {
        player.loadVideoById(data.videoId);
    }
}

function handlePlay(data) {
    console.log("Received 'play' event:", data);
    isEventFromAbly = true;
    if (player) {
        player.seekTo(data.currentTime, true);
        player.playVideo();
    }
}

function handlePause(data) {
    console.log("Received 'pause' event");
    isEventFromAbly = true;
    if (player) {
        player.pauseVideo();
    }
}

// --- YouTube Iframe Player API Setup ---
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready.");
}

function createPlayer(videoId) {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { 'playsinline': 1, 'autoplay': 1, 'controls': 1 },
        events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
    });
}

function onPlayerReady(event) {
    console.log("Player is ready.");
}

function onPlayerStateChange(event) {
    if (isEventFromAbly) {
        isEventFromAbly = false;
        return;
    }

    // ✨ NEW: Check if the state has actually changed before broadcasting.
    // This prevents the infinite loop of "PLAYING" events.
    if (event.data === lastPlayerState) {
        return;
    }

    // ✨ NEW: Update the last known state.
    lastPlayerState = event.data;

    switch (event.data) {
        case YT.PlayerState.PLAYING:
            console.log("User played video. Publishing to Ably.");
            channel.publish('play', { currentTime: player.getCurrentTime() });
            break;
        case YT.PlayerState.PAUSED:
            console.log("User paused video. Publishing to Ably.");
            channel.publish('pause', {});
            break;
    }
}

// --- Event Listeners & Utilities ---
document.getElementById('set-video-btn').addEventListener('click', () => {
    const url = document.getElementById('youtube-url').value;
    const videoId = extractVideoID(url);
    if (videoId) {
        const messageData = { videoId: videoId };
        channel.publish('set-video', messageData);
        handleSetVideo(messageData);
    } else {
        alert("Invalid YouTube URL.");
    }
});

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}