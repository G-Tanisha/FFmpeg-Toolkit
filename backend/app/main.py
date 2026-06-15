import os
import uuid
import shutil
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.services.ffmpeg_service import FFmpegService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ffmpeg_api")

app = FastAPI(
    title="FFmpeg Media Processing Toolkit API",
    description="FastAPI service for image/video compression and audio conversion using FFmpeg",
    version="1.0.0"
)

# Set up CORS based on environment configuration
allowed_origins = [origin.strip() for origin in settings.ALLOWED_ORIGINS.split(",") if origin.strip()]
logger.info(f"ALLOWED_ORIGINS loaded = {settings.ALLOWED_ORIGINS}")
logger.info(f"Parsed origins = {allowed_origins}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instaniate FFmpeg service
ffmpeg_service = FFmpegService()

# In-memory storage for file metadata (mapping download_id / file_id to file paths)
# Format: { id: {"input": path, "output": path, "filename": name} }
jobs_store: Dict[str, dict] = {}

# Ensure temp directory exists at startup
@app.on_event("startup")
async def startup_event():
    os.makedirs(settings.TEMP_DIR, exist_ok=True)
    logger.info(f"Temporary files directory initialized at: {settings.TEMP_DIR}")
    
    # Start the periodic cleanup task
    asyncio.create_task(periodic_cleanup())
    logger.info("Periodic temp files cleanup background task started.")

# Request models
class ImageCompressRequest(BaseModel):
    file_id: str
    quality: int = Field(default=80, ge=1, le=100, description="Quality percentage (1-100)")
    scale: int = Field(default=100, ge=1, le=100, description="Scale percentage (1-100)")
    output_format: str = Field(default="original", description="Target format: original, jpeg, png, webp")

class VideoCompressRequest(BaseModel):
    file_id: str
    quality: str = Field(default="medium", description="Quality: high, medium, low")
    resolution: str = Field(default="original", description="Resolution: original, 1080p, 720p, 480p")

class AudioConvertRequest(BaseModel):
    file_id: str
    format: str = Field(default="mp3", description="Target format: mp3, wav, aac, ogg")
    bitrate: str = Field(default="128k", description="Audio bitrate: 320k, 192k, 128k, 64k")

# Background cleanup logic
async def periodic_cleanup():
    """
    Deletes files in temp_files that are older than 30 minutes.
    Runs every 10 minutes.
    """
    while True:
        try:
            await asyncio.sleep(600)  # Wait 10 minutes
            logger.info("Running periodic cleanup of old files...")
            now = datetime.now()
            cutoff = now - timedelta(minutes=30)
            
            # List all files in the temp directory
            if os.path.exists(settings.TEMP_DIR):
                for filename in os.listdir(settings.TEMP_DIR):
                    file_path = os.path.join(settings.TEMP_DIR, filename)
                    if os.path.isfile(file_path):
                        file_mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                        if file_mtime < cutoff:
                            try:
                                os.remove(file_path)
                                logger.info(f"Cleaned up stale file: {filename}")
                            except Exception as e:
                                logger.error(f"Error removing stale file {file_path}: {e}")
        except Exception as e:
            logger.error(f"Error in periodic cleanup task: {e}")

def remove_job_files(job_id: str):
    """
    Helper function to delete files associated with a job.
    Called as a background task after a file download is completed.
    """
    job = jobs_store.get(job_id)
    if job:
        # Give a short delay to ensure file handle is released by the server
        for file_key in ["input", "output"]:
            file_path = job.get(file_key)
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    logger.info(f"Cleaned up job file: {file_path}")
                except Exception as e:
                    logger.error(f"Failed to delete job file {file_path}: {e}")
        # Clean up jobs store entry
        jobs_store.pop(job_id, None)

# Endpoints
@app.get("/api/health")
async def health_check():
    """
    Check API and FFmpeg status.
    """
    ffmpeg_installed = await ffmpeg_service.is_ffmpeg_installed()
    return {
        "status": "healthy",
        "ffmpeg_installed": ffmpeg_installed,
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Upload a media file to temporary storage.
    Returns a unique file ID.
    """
    try:
        # Generate clean ID and safe local file path
        file_id = str(uuid.uuid4())
        safe_filename = "".join(c for c in file.filename if c.isalnum() or c in "._- ")
        input_filename = f"{file_id}_input_{safe_filename}"
        input_path = os.path.join(settings.TEMP_DIR, input_filename)
        
        # Save file to temp folder
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        file_size = os.path.getsize(input_path)
        logger.info(f"Uploaded file {file.filename} -> {input_path} ({file_size} bytes)")
        
        # Store metadata
        jobs_store[file_id] = {
            "input": input_path,
            "output": None,
            "filename": safe_filename
        }
        
        return {
            "file_id": file_id,
            "filename": safe_filename,
            "size": file_size
        }
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}"
        )

@app.post("/api/compress/image")
async def compress_image(payload: ImageCompressRequest):
    """
    Compress the uploaded image.
    """
    job = jobs_store.get(payload.file_id)
    if not job or not job.get("input") or not os.path.exists(job["input"]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or expired. Please upload it again."
        )
        
    input_path = job["input"]
    original_filename = job["filename"]
    
    # Determine extension and format
    name, ext = os.path.splitext(original_filename)
    target_ext = ext
    if payload.output_format != "original":
        target_ext = f".{payload.output_format.replace('jpeg', 'jpg')}"
        
    output_filename = f"{payload.file_id}_output_{name}{target_ext}"
    output_path = os.path.join(settings.TEMP_DIR, output_filename)
    
    try:
        # Call FFmpeg compression
        await ffmpeg_service.compress_image(
            input_path=input_path,
            output_path=output_path,
            quality=payload.quality,
            scale=payload.scale
        )
        
        # Calculate file sizes for comparison
        original_size = os.path.getsize(input_path)
        processed_size = os.path.getsize(output_path)
        savings_percent = max(0.0, round(((original_size - processed_size) / original_size) * 100, 2))
        
        # Save output path for download
        download_id = str(uuid.uuid4())
        jobs_store[download_id] = {
            "input": input_path,
            "output": output_path,
            "filename": f"compressed_{name}{target_ext}"
        }
        
        return {
            "download_id": download_id,
            "filename": f"compressed_{name}{target_ext}",
            "original_size": original_size,
            "processed_size": processed_size,
            "savings_percent": savings_percent
        }
    except Exception as e:
        logger.error(f"Image compression error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Image compression failed: {str(e)}"
        )

@app.post("/api/compress/video")
async def compress_video(payload: VideoCompressRequest):
    """
    Compress the uploaded video.
    """
    job = jobs_store.get(payload.file_id)
    if not job or not job.get("input") or not os.path.exists(job["input"]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or expired. Please upload it again."
        )
        
    input_path = job["input"]
    original_filename = job["filename"]
    
    name, ext = os.path.splitext(original_filename)
    output_filename = f"{payload.file_id}_output_{name}{ext}"
    output_path = os.path.join(settings.TEMP_DIR, output_filename)
    
    try:
        # Call FFmpeg compression
        await ffmpeg_service.compress_video(
            input_path=input_path,
            output_path=output_path,
            quality=payload.quality,
            resolution=payload.resolution
        )
        
        original_size = os.path.getsize(input_path)
        processed_size = os.path.getsize(output_path)
        savings_percent = max(0.0, round(((original_size - processed_size) / original_size) * 100, 2))
        
        download_id = str(uuid.uuid4())
        jobs_store[download_id] = {
            "input": input_path,
            "output": output_path,
            "filename": f"compressed_{name}{ext}"
        }
        
        return {
            "download_id": download_id,
            "filename": f"compressed_{name}{ext}",
            "original_size": original_size,
            "processed_size": processed_size,
            "savings_percent": savings_percent
        }
    except Exception as e:
        logger.error(f"Video compression error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Video compression failed: {str(e)}"
        )

@app.post("/api/convert/audio")
async def convert_audio(payload: AudioConvertRequest):
    """
    Convert the uploaded audio format.
    """
    job = jobs_store.get(payload.file_id)
    if not job or not job.get("input") or not os.path.exists(job["input"]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found or expired. Please upload it again."
        )
        
    input_path = job["input"]
    original_filename = job["filename"]
    
    name, _ = os.path.splitext(original_filename)
    target_ext = f".{payload.format.lower()}"
    output_filename = f"{payload.file_id}_output_{name}{target_ext}"
    output_path = os.path.join(settings.TEMP_DIR, output_filename)
    
    try:
        # Call FFmpeg compression/conversion
        await ffmpeg_service.convert_audio(
            input_path=input_path,
            output_path=output_path,
            format_name=payload.format,
            bitrate=payload.bitrate
        )
        
        original_size = os.path.getsize(input_path)
        processed_size = os.path.getsize(output_path)
        
        download_id = str(uuid.uuid4())
        jobs_store[download_id] = {
            "input": input_path,
            "output": output_path,
            "filename": f"converted_{name}{target_ext}"
        }
        
        return {
            "download_id": download_id,
            "filename": f"converted_{name}{target_ext}",
            "original_size": original_size,
            "processed_size": processed_size,
            "savings_percent": max(0.0, round(((original_size - processed_size) / original_size) * 100, 2))
        }
    except Exception as e:
        logger.error(f"Audio conversion error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Audio conversion failed: {str(e)}"
        )

@app.get("/api/download/{download_id}")
async def download_file(download_id: str, background_tasks: BackgroundTasks):
    """
    Download the processed file. Schedules deletion of temp files afterwards.
    """
    job = jobs_store.get(download_id)
    if not job or not job.get("output") or not os.path.exists(job["output"]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Processed file not found or has expired."
        )
        
    output_path = job["output"]
    download_filename = job["filename"]
    
    # Schedule cleanup task in the background after the response finishes
    background_tasks.add_task(remove_job_files, download_id)
    
    logger.info(f"Serving download file: {output_path} as {download_filename}")
    return FileResponse(
        path=output_path,
        media_type="application/octet-stream",
        filename=download_filename
    )
