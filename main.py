# main.py
import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# --- Configuration ---
# IMPORTANT: Place your YouTube Data API v3 key here.
# For better security, use an environment variable in production.
YOUTUBE_API_KEY = "AIzaSyCIxIFMSp7OnB5sdOxFeORxeHp9IZ2I7EQ" # <--- REPLACE THIS

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- NEW: API Endpoint for fetching video details ---
@app.get("/api/video-details")
async def get_video_details(id: str):
    """
    Fetches video title and thumbnail from YouTube API on the server.
    This keeps the API key secure.
    """
    if not id:
        raise HTTPException(status_code=400, detail="Video ID is required.")
    
    try:
        youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)
        video_response = youtube.videos().list(
            part='snippet',
            id=id
        ).execute()

        if not video_response.get('items'):
            raise HTTPException(status_code=404, detail="Video not found.")

        snippet = video_response['items'][0]['snippet']
        return JSONResponse(content={
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['default']['url']
        })

    except HttpError as e:
        print(f"An HTTP error {e.resp.status} occurred: {e.content}")
        raise HTTPException(status_code=500, detail="Failed to fetch video details from YouTube.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise HTTPException(status_code=500, detail="An internal server error occurred.")


# --- HTML Page Routes (Unchanged) ---
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("landing.html", {"request": request})

@app.get("/admin/{room_id}", response_class=HTMLResponse)
async def get_admin_room(request: Request, room_id: str):
    return templates.TemplateResponse(
        "room.html", 
        {"request": request, "room_id": room_id, "is_admin": True}
    )

@app.get("/join/{room_id}", response_class=HTMLResponse)
async def get_user_room(request: Request, room_id: str):
    return templates.TemplateResponse(
        "room.html", 
        {"request": request, "room_id": room_id, "is_admin": False}
    )