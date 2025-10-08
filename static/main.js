// static/main.js
// --- Configuration ---
const ROOM_ID = document.location.pathname.replace("/", "");
const WEBSOCKET_URL = `ws://${document.location.host}/ws/${ROOM_ID}`;

// --- State Management ---
let player;
let webSocket;
// A flag to prevent echoing events. If we receive an event from the server,
// we set this to true so we don't send the same event back.
let isEventFromSocket = false;

// --- YouTube Iframe Player API Setup ---
// This code loads the IFrame Player API code asynchronously.
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// This function creates an <iframe> (and YouTube player) after the API code downloads.
function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready.");
    // We don't create the player here yet. We wait for a video ID.
}

function createPlayer(videoId) {
    if (player) {
        player.loadVideoById(videoId);
    } else {
        player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                'playsinline': 1,
                'autoplay': 1,
                'controls': 1 // Show native controls
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange
            }
        });
    }
}

function onPlayerReady(event) {
    console.log("Player is ready.");
    event.target.playVideo();
}

function onPlayerStateChange(event) {
    // If the event was triggered by our code (from a socket message), do nothing.
    if (isEventFromSocket) {
        isEventFromSocket = false;
        return;
    }

    // Otherwise, the user initiated the action, so broadcast it.
    switch (event.data) {
        case YT.PlayerState.PLAYING:
            console.log("User played video. Broadcasting.");
            sendMessage({
                type: "PLAY",
                currentTime: player.getCurrentTime()
            });
            break;
        case YT.PlayerState.PAUSED:
            console.log("User paused video. Broadcasting.");
            sendMessage({ type: "PAUSE" });
            break;
    }
}

// --- WebSocket Communication ---
function connectWebSocket() {
    webSocket = new WebSocket(WEBSOCKET_URL);

    webSocket.onopen = (event) => {
        console.log("Successfully connected to WebSocket server.");
    };

    webSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Received message:", data);
        
        isEventFromSocket = true; // Set flag to prevent echo
        
        switch (data.type) {
            case "SET_VIDEO":
                if (!player) {
                    createPlayer(data.videoId);
                } else {
                    player.loadVideoById(data.videoId);
                }
                break;
            case "PLAY":
                if (player) {
                    player.seekTo(data.currentTime, true);
                    player.playVideo();
                }
                break;
            case "PAUSE":
                if (player) {
                    player.pauseVideo();
                }
                break;
        }
    };

    webSocket.onclose = (event) => {
        console.log("WebSocket disconnected. Attempting to reconnect...");
        setTimeout(connectWebSocket, 3000); // Reconnect after 3 seconds
    };
    
    webSocket.onerror = (error) => {
        console.error("WebSocket Error:", error);
        webSocket.close();
    };
}

function sendMessage(message) {
    if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(message));
    }
}

// --- Event Listeners & Utilities ---
document.getElementById('set-video-btn').addEventListener('click', () => {
    const url = document.getElementById('youtube-url').value;
    const videoId = extractVideoID(url);
    if (videoId) {
        // Send the new video ID to the server to be broadcasted
        sendMessage({ type: 'SET_VIDEO', videoId: videoId });
        // Also create the player locally right away
        if (!player) {
            createPlayer(videoId);
        } else {
            player.loadVideoById(videoId);
        }
    } else {
        alert("Invalid YouTube URL. Please use a full video URL.");
    }
});

function extractVideoID(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// --- Initialize ---
connectWebSocket();