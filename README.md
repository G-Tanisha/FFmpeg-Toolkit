# FFmpeg Universal Media Processing Toolkit

A production-ready full-stack application designed to process media files (images, video, audio) in the cloud using **FastAPI (Python)** on the backend, **React (Vite) + Vanilla CSS** on the frontend, and **FFmpeg** as the core processing engine. 

Designed for easy deployment on **Vercel** (Frontend) and **Google Cloud Run** (Backend).

---

## Project Folder Structure

```text
FFmpeg project/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py             # Configuration loader via pydantic-settings
│   │   ├── main.py               # FastAPI entrypoint, routing & temp file scheduler
│   │   └── services/
│   │       ├── __init__.py
│   │       └── ffmpeg_service.py # Service executing FFmpeg CLI subprocesses asynchronously
│   ├── temp_files/               # Created at startup to temporarily host upload/download files
│   ├── .env.example              # Env config template for backend CORS
│   ├── Dockerfile                # Production Dockerfile configured for Google Cloud Run (installs FFmpeg)
│   └── requirements.txt          # Python application dependencies
│
├── frontend/
│   ├── public/                   # Static assets
│   ├── src/
│   │   ├── assets/               # Local images & icon files
│   │   ├── App.jsx               # Main dashboard component, upload handlers & state managers
│   │   ├── index.css             # Glassmorphic design stylesheet and animations
│   │   └── main.jsx              # React mounting root file
│   ├── .env.example              # Env config template for frontend API URL
│   ├── index.html                # Main index markup with meta descriptions
│   ├── package.json              # Client packages and build commands
│   ├── vercel.json               # SPA routing configuration rules for Vercel
│   └── vite.config.js            # Vite settings for React
│
└── README.md                     # Documentation
```

---

## File & Directory Explanations

### Backend
1. **`backend/requirements.txt`**: Declares necessary Python libraries: `fastapi` and `uvicorn` (server), `python-multipart` (upload parser), and `pydantic-settings` (config).
2. **`backend/Dockerfile`**: Configured to run on Google Cloud Run. It uses a Debian-slim base, runs `apt-get` to install the actual system-level `ffmpeg` binary, installs Python dependencies, maps the environment port dynamically, and boots the FastAPI server using Uvicorn.
3. **`backend/app/config.py`**: Reads `.env` properties, supplying fallback local values for development. Resolves the folder location of the temporary directories inside the workspace.
4. **`backend/app/main.py`**: Initializes the FastAPI app, wires up CORS, triggers a background thread that periodically purges old files, receives media uploads, calls media compression endpoints, and handles processed file downloads (deleting them immediately from the server space right after download completes).
5. **`backend/app/services/ffmpeg_service.py`**: Serves as a wrapper around the system's `ffmpeg` CLI binary. Utilizes Python's `asyncio.create_subprocess_exec` to run operations in background sub-processes without blocking FastAPI's main request loop.

### Frontend
1. **`frontend/package.json`**: Standard npm dependency schema defining React and Vite scripts.
2. **`frontend/vercel.json`**: Implements rewrites so that single page application routes map to `index.html` on Vercel deployment.
3. **`frontend/src/index.css`**: Defines a dark theme styled with custom variables, layout grids, animated progress indicators, slider inputs, dynamic status bars, and hover scaling micro-animations.
4. **`frontend/src/App.jsx`**: Incorporates React logic to track page state, check backend API connectivity, upload media files via native progress-tracked XMLHttpRequests, configure quality levels, render spinners, and request downloads.

---

## Setup & Local Run Instructions

### Prerequisites
- Install [Node.js](https://nodejs.org/) (v16+ recommended).
- Install [Python](https://www.python.org/) (v3.9+ recommended).
- Install [FFmpeg](https://ffmpeg.org/download.html) on your local operating system and make sure it is added to your environment `PATH` variables.

---

### Running the Backend

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment and activate it:
   ```bash
   # On Windows (PowerShell/CMD):
   python -m venv venv
   .\venv\Scripts\activate

   # On macOS/Linux:
   python3 -m venv venv
   source venv/bin/activate
   ```

3. Install required libraries:
   ```bash
   pip install -r requirements.txt
   ```

4. Create local environment variable file `.env` (optional, as defaults are in place):
   Copy `.env.example` to `.env`:
   ```bash
   # On Windows (PowerShell):
   Copy-Item .env.example .env
   # On macOS/Linux:
   cp .env.example .env
   ```

5. Launch the development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   The API will start running on [http://localhost:8000](http://localhost:8000). You can explore auto-generated docs at [http://localhost:8000/docs](http://localhost:8000/docs).

---

### Running the Frontend

1. Open a new terminal window and navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```

2. Install client dependencies:
   ```bash
   npm install
   ```

3. Create local environment variable file `.env`:
   Copy `.env.example` to `.env`:
   ```bash
   # On Windows (PowerShell):
   Copy-Item .env.example .env
   # On macOS/Linux:
   cp .env.example .env
   ```

4. Launch Vite developer dev server:
   ```bash
   npm run dev
   ```
   The client dashboard will start running on [http://localhost:5173](http://localhost:5173).

---

## Deployment Guidelines

### Backend Deployment to Google Cloud Run

Google Cloud Run automatically deploys applications packed as Docker containers.

1. Build the container image using Google Cloud Build:
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/ffmpeg-backend backend/
   ```

2. Deploy the container image to Cloud Run:
   ```bash
   gcloud run deploy ffmpeg-backend \
     --image gcr.io/YOUR_PROJECT_ID/ffmpeg-backend \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars ALLOWED_ORIGINS="https://your-vercel-frontend.vercel.app"
   ```
   Save the URL returned by Cloud Run. This will be the API URL for your frontend deployment.

### Frontend Deployment to Vercel

Vercel provides native Vite deployment:

1. Install Vercel CLI or log into the Vercel dashboard.
2. Link your repository or import the `frontend/` directory.
3. Configure the **Build Command** to: `npm run build`
4. Configure the **Output Directory** to: `dist`
5. Add the environment variable:
   - Key: `VITE_API_URL`
   - Value: `https://your-deployed-cloud-run-backend.run.app` (the Cloud Run URL saved from backend deployment).
