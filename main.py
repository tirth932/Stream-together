# main.py
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import json
from typing import Dict, List

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class Room:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.waiting_connections: Dict[str, WebSocket] = {}
        self.admin: WebSocket | None = None

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}

    def get_client_id(self, websocket: WebSocket) -> str:
        return id(websocket)

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = Room()
        
        room = self.rooms[room_id]

        if not room.admin:
            room.admin = websocket
            room.active_connections.append(websocket)
            await websocket.send_json({"type": "role_assignment", "role": "admin"})
            await self.broadcast_user_list(room_id)
        else:
            client_id = self.get_client_id(websocket)
            room.waiting_connections[client_id] = websocket
            await room.admin.send_json({"type": "join_request", "clientId": client_id})
            await websocket.send_json({"type": "approval_required"})
    
    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.rooms:
            room = self.rooms[room_id]
            if websocket in room.active_connections:
                room.active_connections.remove(websocket)
            client_id = self.get_client_id(websocket)
            if client_id in room.waiting_connections:
                del room.waiting_connections[client_id]
            
            if websocket == room.admin:
                # Simple admin handover: next person becomes admin
                if room.active_connections:
                    room.admin = room.active_connections[0]
                    # This is a simplified logic. In a real app, you might want a more robust handover.
                    # We can notify the new admin, but we'll skip that for simplicity here.
                else:
                    room.admin = None
            
            asyncio.create_task(self.broadcast_user_list(room_id))

    async def broadcast(self, message: dict, room_id: str):
        if room_id in self.rooms:
            for connection in self.rooms[room_id].active_connections:
                await connection.send_json(message)

    async def broadcast_user_list(self, room_id: str):
        if room_id in self.rooms:
            room = self.rooms[room_id]
            if room.admin:
                user_list = [self.get_client_id(ws) for ws in room.active_connections if ws != room.admin]
                waiting_list = list(room.waiting_connections.keys())
                await room.admin.send_json({
                    "type": "user_list_update",
                    "connected": user_list,
                    "waiting": waiting_list
                })

    async def handle_admin_action(self, room_id: str, data: dict):
        if room_id in self.rooms:
            room = self.rooms[room_id]
            client_id = data.get("clientId")

            if data["action"] == "approve" and client_id in room.waiting_connections:
                websocket = room.waiting_connections.pop(client_id)
                room.active_connections.append(websocket)
                await websocket.send_json({"type": "join_approved"})
            
            elif data["action"] == "kick":
                connection_to_kick = next((ws for ws in room.active_connections if self.get_client_id(ws) == client_id), None)
                if connection_to_kick:
                    await connection_to_kick.send_json({"type": "kicked"})
                    room.active_connections.remove(connection_to_kick)
                    await connection_to_kick.close()
            
            await self.broadcast_user_list(room_id)

manager = ConnectionManager()

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("landing.html", {"request": request})

@app.get("/{room_id}", response_class=HTMLResponse)
async def read_item(request: Request, room_id: str):
    return templates.TemplateResponse("index.html", {"request": request, "room_id": room_id})

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)
    client_id = manager.get_client_id(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            # Video controls are broadcast to everyone
            if data["type"] in ["play", "pause", "seek", "set_video"]:
                await manager.broadcast(data, room_id)
            # Chat messages are also broadcast
            elif data["type"] == "chat":
                await manager.broadcast({"type": "chat", "message": data["message"], "sender": client_id}, room_id)
            # Admin actions are handled separately
            elif data["type"] == "admin_action":
                await manager.handle_admin_action(room_id, data)
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)