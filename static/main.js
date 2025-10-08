// static/main.js

// --- Configuration ---
const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA'; // Make sure your key is still here
const ROOM_ID = document.location.pathname.replace("/", "");

// --- State Management ---
let player;
let isEventFromAbly = false;
let lastPlayerState = -1;
// A flag to track if the main YouTube API script is ready.
let isYouTubeApiReady = false;
let initialVideoId = null;

const ably = new Ably.Realtime(ABLY_API_KEY);
const channel = ably.channels.get(`stream-together:${ROOM_ID}`);
console.log("Connecting to Ably...");

// --- Ably Communication ---
channel.subscribe('set-video', (message) => handleSetVideo(message.data));
channel.subscribe('play', (message) => handlePlay(message.data));
channel.subscribe('pause', (message) => handlePause(message.data));

function handleSetVideo(data) {
    console.log("Received 'set-video' event:", data);
    if (player && typeof player.loadVideoById === 'function') {
        isEventFromAbly = true;
        player.loadVideoById(data.videoId);
    } else {
        initialVideoId = data.videoId;
        // If the API is ready, create the player now.
        // Otherwise, onYouTubeIframeAPIReady will handle it.
        if (isYouTubeApiReady) {
            createPlayer(initialVideoId);
        }
    }
}

function handlePlay(data) {
    if (!player) return;
    console.log("Received 'play' event:", data);
    isEventFromAbly = true;
    player.seekTo(data.currentTime, true);
    player.playVideo();
}

function handlePause(data) {
    if (!player) return;
    console.log("Received 'pause' event");
    isEventFromAbly = true;
    player.pauseVideo();
}

// --- YouTube Iframe Player API Setup ---
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready.");
    isYouTubeApiReady = true;
    // If a video ID arrived before the API was ready, create the player now.
    if (initialVideoId) {
        createPlayer(initialVideoId);
    }
}

function createPlayer(videoId) {
    if (player) return;
    
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1,
            'autoplay': 1,
            'controls': 1,
            'origin': window.location.origin
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    console.log("Player is ready.");
    event.target.playVideo();
}

function onPlayerStateChange(event) {
    if (isEventFromAbly) {
        isEventFromAbly = false;
        return;
    }
    if (event.data === lastPlayerState) {
        return;
    }
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
        
        if (!player) {
            createPlayer(videoId);
        } else {
            player.loadVideoById(videoId);
        }
    } else {
        alert("Invalid YouTube URL.");
    }
});

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}