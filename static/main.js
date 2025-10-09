// static/main.js
document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration ---
    const ABLY_API_KEY = 'zrEY8A.ML45lQ:fRjmfTTGjqrlx5YXZD7zbkVgSBvvznl9XuOEIUL0LJA';
    const ROOM_ID = document.location.pathname.split('/')[1];

    // --- State ---
    let player;
    let isEventFromAbly = false;
    let isYouTubeApiReady = false;
    let myRole = 'user'; // Default role

    // --- DOM Elements ---
    const adminControls = document.querySelectorAll('.admin-controls');
    const adminPanel = document.querySelectorAll('.admin-panel');
    const approvalOverlay = document.getElementById('approval-overlay');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');

    // --- Connect via WebSocket ---
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${ROOM_ID}`);

    ws.onopen = () => console.log("✅ WebSocket Connected");
    ws.onclose = () => console.log("❌ WebSocket Disconnected");
    ws.onerror = (error) => console.error("WebSocket Error:", error);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    function sendMessage(data) {
        ws.send(JSON.stringify(data));
    }

    // --- WebSocket Message Handler ---
    function handleWebSocketMessage(data) {
        switch (data.type) {
            case 'role_assignment':
                myRole = data.role;
                if (myRole === 'admin') {
                    document.querySelectorAll('.admin-controls, .admin-panel').forEach(el => el.style.display = 'block');
                }
                break;
            case 'approval_required':
                approvalOverlay.style.display = 'flex';
                break;
            case 'join_approved':
                approvalOverlay.style.display = 'none';
                sendMessage({ type: 'sync_request' }); // Request video state from others
                break;
            case 'kicked':
                alert("You have been removed from the room by the admin.");
                window.location.href = '/';
                break;
            case 'user_list_update':
                updateUserLists(data.connected, data.waiting);
                break;
            case 'set_video':
            case 'play':
            case 'pause':
            case 'seek':
                handleVideoEvents(data);
                break;
            case 'chat':
                displayChatMessage(data.sender, data.message);
                break;
        }
    }
    
    // --- UI Update Functions ---
    function updateUserLists(connected, waiting) {
        const waitingList = document.getElementById('waiting-list');
        waitingList.innerHTML = '';
        if (waiting.length > 0) {
            waiting.forEach(id => {
                waitingList.innerHTML += `
                    <div class="flex justify-between items-center bg-gray-700 p-1 rounded">
                        <span>User ${id.slice(-4)}</span>
                        <button data-client-id="${id}" class="approve-btn bg-green-500 text-xs px-2 py-1 rounded">Approve</button>
                    </div>`;
            });
        } else {
            waitingList.innerHTML = '<p>No users waiting.</p>';
        }

        const connectedUsers = document.getElementById('connected-users');
        connectedUsers.innerHTML = '';
        if (connected.length > 0) {
            connected.forEach(id => {
                connectedUsers.innerHTML += `
                    <div class="flex justify-between items-center bg-gray-700 p-1 rounded">
                        <span>User ${id.slice(-4)}</span>
                        <button data-client-id="${id}" class="kick-btn bg-red-500 text-xs px-2 py-1 rounded">Kick</button>
                    </div>`;
            });
        } else {
            connectedUsers.innerHTML = '<p>No other users connected.</p>';
        }
    }
    
    function displayChatMessage(senderId, message) {
        const msgDiv = document.createElement('div');
        msgDiv.innerHTML = `<p><span class="font-bold text-purple-400">User ${senderId.slice(-4)}:</span> ${escapeHTML(message)}</p>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
    }

    // --- Video Player Logic ---
    function handleVideoEvents(data) {
        if (!player || !isYouTubeApiReady) return;
        isEventFromAbly = true;
        
        switch(data.type) {
            case 'set_video':
                player.loadVideoById(data.videoId);
                break;
            case 'play':
                player.seekTo(data.currentTime, true);
                player.playVideo();
                break;
            case 'pause':
                player.pauseVideo();
                break;
            case 'seek':
                 player.seekTo(data.currentTime, true);
                 break;
        }
        // Allow events to be sent again after a short delay
        setTimeout(() => { isEventFromAbly = false; }, 200);
    }
    
    // --- YouTube IFrame API ---
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = function() {
        isYouTubeApiReady = true;
        player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: { playsinline: 1, controls: myRole === 'admin' ? 1 : 0, disablekb: 1 }, // Only admin gets controls
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange
            }
        });
    }

    function onPlayerReady(event) {
        console.log("Player is ready.");
    }
    
    function onPlayerStateChange(event) {
        if (myRole !== 'admin' || isEventFromAbly) return;
        
        switch (event.data) {
            case YT.PlayerState.PLAYING:
                sendMessage({ type: 'play', currentTime: player.getCurrentTime() });
                break;
            case YT.PlayerState.PAUSED:
                sendMessage({ type: 'pause' });
                break;
            case YT.PlayerState.BUFFERING: // Often fires when seeking
                 sendMessage({ type: 'seek', currentTime: player.getCurrentTime() });
                 break;
        }
    }
    
    // --- Event Listeners ---
    document.getElementById('set-video-btn').addEventListener('click', () => {
        if (myRole !== 'admin') return;
        const url = document.getElementById('youtube-url').value;
        const videoId = extractVideoID(url);
        if (videoId) {
            sendMessage({ type: 'set_video', videoId: videoId });
        }
    });
    
    chatForm.addEventListener('submit', e => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message) {
            sendMessage({ type: 'chat', message: message });
            chatInput.value = '';
        }
    });
    
    // Listen for clicks on approve/kick buttons
    document.body.addEventListener('click', e => {
        if (myRole !== 'admin') return;
        if (e.target.classList.contains('approve-btn')) {
            const clientId = e.target.dataset.clientId;
            sendMessage({ type: 'admin_action', action: 'approve', clientId: clientId });
        }
        if (e.target.classList.contains('kick-btn')) {
            const clientId = e.target.dataset.clientId;
            sendMessage({ type: 'admin_action', action: 'kick', clientId: clientId });
        }
    });

    // --- Utility Functions ---
    function extractVideoID(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }
    
    function escapeHTML(str) {
        return str.replace(/[&<>"']/g, function(match) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[match];
        });
    }
});