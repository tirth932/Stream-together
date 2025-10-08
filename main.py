# main.py
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import json

app = FastAPI()

# Mount static files (for our JavaScript)
app.mount("/static", StaticFiles(directory="static"), name="static")
# Setup templates (for our HTML)
templates = Jinja2Templates(directory="templates")

class ConnectionManager:
    """Manages active WebSocket connections for different rooms."""
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_connections:
            self.active_connections[room_id].remove(websocket)

    async def broadcast(self, message: str, room_id: str, sender: WebSocket):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                # Send to everyone except the sender to avoid echo
                if connection is not sender:
                    await connection.send_text(message)

manager = ConnectionManager()

@app.get("/{room_id}", response_class=HTMLResponse)
async def read_item(request: Request, room_id: str):
    """Serve the main HTML page for a given room."""
    return templates.TemplateResponse(
        "index.html", {"request": request, "room_id": room_id}
    )

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """Handle WebSocket connections and messages."""
    await manager.connect(websocket, room_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast the received message to others in the same room
            await manager.broadcast(data, room_id, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)