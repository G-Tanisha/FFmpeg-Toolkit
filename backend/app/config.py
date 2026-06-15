import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Comma-separated list of allowed CORS origins
    ALLOWED_ORIGINS: str = "http://localhost:5173,https://f-ffmpeg-toolkit.vercel.app"
    
    # Path where temporary uploaded and processed files will be stored
    # Located inside the backend project directory to conform to workspace rules
    TEMP_DIR: str = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 
        "backend", 
        "temp_files"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
