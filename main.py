# main.py
import os
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles

# --- Configuration ---
# You will need your Ably API key for the frontend.
# It's good practice to keep the key on the server and pass it to the template,
# but for this example, we'll manage it in the JS file.

app = FastAPI()

# Mount static files (for our JavaScript and CSS)
app.mount("/static", StaticFiles(directory="static"), name="static")
# Setup templates (for our HTML)
templates = Jinja2Templates(directory="templates")


# --- HTML Page Routes ---

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serve the main landing page."""
    return templates.TemplateResponse("landing.html", {"request": request})


@app.get("/admin/{room_id}", response_class=HTMLResponse)
async def get_admin_room(request: Request, room_id: str):
    """Serve the admin version of the streaming room."""
    return templates.TemplateResponse(
        "room.html", 
        {"request": request, "room_id": room_id, "is_admin": True}
    )


@app.get("/join/{room_id}", response_class=HTMLResponse)
async def get_user_room(request: Request, room_id: str):
    """Serve the user version of the streaming room."""
    return templates.TemplateResponse(
        "room.html", 
        {"request": request, "room_id": room_id, "is_admin": False}
    )