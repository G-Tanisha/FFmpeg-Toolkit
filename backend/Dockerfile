# Use an official lightweight Python image
FROM python:3.11-slim

# Install system dependencies, including FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working directory inside the container
WORKDIR /app

# Copy requirements file first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose port (Cloud Run sets PORT env var automatically)
EXPOSE 8080

# Run the FastAPI app using Uvicorn, binding to 0.0.0.0 and the port environment variable
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
