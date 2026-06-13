import React, { useState, useEffect, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Helper to format file sizes
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

export default function App() {
  // Navigation tabs: 'image', 'video', 'audio'
  const [activeTab, setActiveTab] = useState("image");

  // Health and API Status
  const [apiStatus, setApiStatus] = useState("connecting"); // 'connected', 'offline', 'connecting'

  // Upload States
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null); // Local file reference
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadedFileId, setUploadedFileId] = useState(null); // ID received from server
  const [uploadedFileSize, setUploadedFileSize] = useState(0);

  // Processing Configuration States
  const [imageConfig, setImageConfig] = useState({ quality: 80, scale: 100, format: "original" });
  const [videoConfig, setVideoConfig] = useState({ quality: "medium", resolution: "original" });
  const [audioConfig, setAudioConfig] = useState({ format: "mp3", bitrate: "192k" });

  // Processing & Success States
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [processResult, setProcessResult] = useState(null); // { download_id, filename, original_size, processed_size, savings_percent }

  const uploadXhrRef = useRef(null);

  // Check API health on startup
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_URL}/api/health`);
        const data = await res.json();
        if (data.status === "healthy" && data.ffmpeg_installed) {
          setApiStatus("connected");
        } else if (data.status === "healthy" && !data.ffmpeg_installed) {
          setApiStatus("no_ffmpeg");
          console.warn("FFmpeg is not installed on the backend server!");
        } else {
          setApiStatus("offline");
        }
      } catch (err) {
        console.error("Health check failed:", err);
        setApiStatus("offline");
      }
    };
    checkHealth();
  }, []);

  // Drag Handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndUploadFile(droppedFile);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndUploadFile(e.target.files[0]);
    }
  };

  // Validate file depending on activeTab
  const validateAndUploadFile = (selectedFile) => {
    const fileType = selectedFile.type;
    
    // Check basic types based on active tab
    if (activeTab === "image" && !fileType.startsWith("image/")) {
      setProcessError("Please drop or select an image file.");
      return;
    }
    if (activeTab === "video" && !fileType.startsWith("video/")) {
      setProcessError("Please drop or select a video file.");
      return;
    }
    if (activeTab === "audio" && !fileType.startsWith("audio/") && !selectedFile.name.endsWith(".mp3") && !selectedFile.name.endsWith(".wav") && !selectedFile.name.endsWith(".m4a")) {
      setProcessError("Please drop or select an audio file.");
      return;
    }

    setFile(selectedFile);
    setProcessError(null);
    setProcessResult(null);
    uploadFileToServer(selectedFile);
  };

  // Upload file using XMLHttpRequest to track progress
  const uploadFileToServer = (selectedFile) => {
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", selectedFile);

    const xhr = new XMLHttpRequest();
    uploadXhrRef.current = xhr;

    xhr.open("POST", `${API_URL}/api/upload`, true);

    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(percent);
      }
    };

    // Callback on upload load
    xhr.onload = () => {
      setUploading(false);
      if (xhr.status === 200) {
        try {
          const response = JSON.parse(xhr.responseText);
          setUploadedFileId(response.file_id);
          setUploadedFileSize(response.size);
        } catch (e) {
          setProcessError("Invalid upload response from server.");
          resetUploadState();
        }
      } else {
        setProcessError(`Upload failed with status code: ${xhr.status}`);
        resetUploadState();
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setProcessError("Network error occurred during file upload.");
      resetUploadState();
    };

    xhr.send(formData);
  };

  // Cancel current upload
  const handleCancelUpload = () => {
    if (uploadXhrRef.current) {
      uploadXhrRef.current.abort();
    }
    resetUploadState();
  };

  const resetUploadState = () => {
    setFile(null);
    setUploadProgress(0);
    setUploading(false);
    setUploadedFileId(null);
    setUploadedFileSize(0);
  };

  const handleReset = () => {
    resetUploadState();
    setProcessResult(null);
    setProcessError(null);
  };

  // Trigger processing
  const handleProcessMedia = async () => {
    if (!uploadedFileId) return;

    setProcessing(true);
    setProcessError(null);
    setProcessResult(null);

    let endpoint = "";
    let payload = { file_id: uploadedFileId };

    if (activeTab === "image") {
      endpoint = "/api/compress/image";
      payload = {
        ...payload,
        quality: imageConfig.quality,
        scale: imageConfig.scale,
        output_format: imageConfig.format,
      };
    } else if (activeTab === "video") {
      endpoint = "/api/compress/video";
      payload = {
        ...payload,
        quality: videoConfig.quality,
        resolution: videoConfig.resolution,
      };
    } else if (activeTab === "audio") {
      endpoint = "/api/convert/audio";
      payload = {
        ...payload,
        format: audioConfig.format,
        bitrate: audioConfig.bitrate,
      };
    }

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Processing failed. Please check the file and parameters.");
      }

      setProcessResult(data);
    } catch (err) {
      console.error(err);
      setProcessError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  // Download logic
  const handleDownload = () => {
    if (!processResult || !processResult.download_id) return;
    
    // Open download link in browser
    window.location.href = `${API_URL}/api/download/${processResult.download_id}`;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <a href="#" className="logo">
            <div className="logo-icon">
              {/* Media processing overlapping brackets icon */}
              <svg viewBox="0 0 24 24">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M12 8v8m-4-6l4-4 4 4m-8 4l4 4 4-4" />
              </svg>
            </div>
            <span className="logo-text">FFmpeg Toolkit</span>
          </a>

          {/* API Status Badge */}
          <div className={`api-badge ${apiStatus === "offline" ? "offline" : ""} ${apiStatus === "no_ffmpeg" ? "warning" : ""}`}>
            <span className={`api-dot ${apiStatus === "offline" ? "offline" : ""} ${apiStatus === "no_ffmpeg" ? "warning" : ""}`}></span>
            {apiStatus === "connected" && "API Connected (FFmpeg Ready)"}
            {apiStatus === "no_ffmpeg" && "API Connected (FFmpeg Missing)"}
            {apiStatus === "connecting" && "Connecting to Backend..."}
            {apiStatus === "offline" && "Backend Offline"}
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="main-content">
        <section className="intro-section">
          <h1>Universal Media Processor</h1>
          <p>
            Compress images, optimize videos, and convert audio formats natively in the cloud with extreme efficiency.
          </p>
        </section>

        {/* Action / Feature Selector Tabs */}
        <nav className="operation-tabs">
          <button
            className={`tab-btn ${activeTab === "image" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("image");
              handleReset();
            }}
          >
            {/* Image icon */}
            <svg viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            Image Compressor
          </button>
          
          <button
            className={`tab-btn ${activeTab === "video" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("video");
              handleReset();
            }}
          >
            {/* Video icon */}
            <svg viewBox="0 0 24 24">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Video Optimizer
          </button>
          
          <button
            className={`tab-btn ${activeTab === "audio" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("audio");
              handleReset();
            }}
          >
            {/* Audio icon */}
            <svg viewBox="0 0 24 24">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="16.5" r="2.5" />
            </svg>
            Audio Converter
          </button>
        </nav>

        {/* Interaction Workspace */}
        <section className="tool-workspace">
          {apiStatus === "no_ffmpeg" && (
            <div className="error-card warning-card">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="error-text">
                <strong>Local FFmpeg Missing:</strong> The backend server is running, but the `ffmpeg` executable is not installed or not added to your system environment PATH. Please install FFmpeg on your local machine to process images, video, or audio.
              </div>
            </div>
          )}
          {/* Step 1: Upload (if no file is active yet) */}
          {!file && !processResult && (
            <div
              className={`upload-zone ${dragActive ? "drag-active" : ""}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
            >
              <div className="upload-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="upload-texts">
                <h3>Drag & Drop your {activeTab} here</h3>
                <p>or click to browse local files</p>
              </div>
              <input
                type="file"
                className="file-input"
                onChange={handleFileChange}
                accept={
                  activeTab === "image"
                    ? "image/*"
                    : activeTab === "video"
                    ? "video/*"
                    : "audio/*,.mp3,.wav,.m4a"
                }
              />
            </div>
          )}

          {/* Step 2: Upload Progress */}
          {uploading && (
            <div className="progress-container">
              <div className="progress-header">
                <span>Uploading file to server...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}></div>
              </div>
              <button className="action-btn" style={{ background: "transparent", border: "1px solid var(--border-color)", marginTop: "1rem" }} onClick={handleCancelUpload}>
                Cancel Upload
              </button>
            </div>
          )}

          {/* Step 3: Configure and Process */}
          {file && !uploading && !processResult && !processing && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* Selected File Card */}
              <div className="file-card">
                <div className="file-info">
                  <div className="file-type-icon">
                    {activeTab === "image" ? (
                      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                    ) : activeTab === "video" ? (
                      <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="16.5" r="2.5" /></svg>
                    )}
                  </div>
                  <div className="file-details">
                    <div className="file-name" title={file.name}>{file.name}</div>
                    <div className="file-meta">
                      <span>Type: {file.type || "unknown"}</span>
                      <span>Size: {formatBytes(file.size)}</span>
                    </div>
                  </div>
                </div>
                <button className="remove-file-btn" onClick={handleReset} title="Remove file">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              {/* Configurations Grid */}
              <div className="config-grid">
                {/* Active settings controls */}
                {activeTab === "image" && (
                  <>
                    <div className="config-card">
                      <div className="config-title">
                        <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                        Compression Settings
                      </div>
                      <div className="form-group">
                        <label>
                          <span>Quality Factor</span>
                          <span className="value">{imageConfig.quality}%</span>
                        </label>
                        <input
                          type="range"
                          className="range-slider"
                          min="10"
                          max="100"
                          value={imageConfig.quality}
                          onChange={(e) => setImageConfig({ ...imageConfig, quality: parseInt(e.target.value) })}
                        />
                      </div>
                      <div className="form-group">
                        <label>
                          <span>Dimension Scaling</span>
                          <span className="value">{imageConfig.scale}%</span>
                        </label>
                        <input
                          type="range"
                          className="range-slider"
                          min="10"
                          max="100"
                          value={imageConfig.scale}
                          onChange={(e) => setImageConfig({ ...imageConfig, scale: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="config-card">
                      <div className="config-title">
                        <svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" /></svg>
                        Format Conversion
                      </div>
                      <div className="form-group">
                        <label>Target Format</label>
                        <select
                          className="custom-select"
                          value={imageConfig.format}
                          onChange={(e) => setImageConfig({ ...imageConfig, format: e.target.value })}
                        >
                          <option value="original">Keep Original Format</option>
                          <option value="jpeg">JPEG (Joint Photographic Experts Group)</option>
                          <option value="png">PNG (Portable Network Graphics)</option>
                          <option value="webp">WEBP (Google Web Picture)</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === "video" && (
                  <>
                    <div className="config-card">
                      <div className="config-title">
                        <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
                        H.264 Encoder Compression
                      </div>
                      <div className="form-group">
                        <label>Quality Profile (CRF Target)</label>
                        <select
                          className="custom-select"
                          value={videoConfig.quality}
                          onChange={(e) => setVideoConfig({ ...videoConfig, quality: e.target.value })}
                        >
                          <option value="high">High Quality (Slower build, larger size)</option>
                          <option value="medium">Medium Balance (Recommended)</option>
                          <option value="low">Max Compression (Faster build, small size)</option>
                        </select>
                      </div>
                    </div>

                    <div className="config-card">
                      <div className="config-title">
                        <svg viewBox="0 0 24 24"><path d="M4 14h6v6H4zm10-10h6v6h-6zm0 10h6v6h-6zM4 4h6v6H4z" /></svg>
                        Resolution Scaling
                      </div>
                      <div className="form-group">
                        <label>Target Resolution</label>
                        <select
                          className="custom-select"
                          value={videoConfig.resolution}
                          onChange={(e) => setVideoConfig({ ...videoConfig, resolution: e.target.value })}
                        >
                          <option value="original">Match Original Dimensions</option>
                          <option value="1080p">Full HD 1080p (1920x1080)</option>
                          <option value="720p">HD 720p (1280x720)</option>
                          <option value="480p">SD 480p (854x480)</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === "audio" && (
                  <>
                    <div className="config-card">
                      <div className="config-title">
                        <svg viewBox="0 0 24 24"><path d="M12 2v20M17 5v14M22 9v6M7 8v8M2 10v4" /></svg>
                        Target Format
                      </div>
                      <div className="form-group">
                        <label>Audio Format</label>
                        <select
                          className="custom-select"
                          value={audioConfig.format}
                          onChange={(e) => setAudioConfig({ ...audioConfig, format: e.target.value })}
                        >
                          <option value="mp3">MP3 (MPEG Layer-3)</option>
                          <option value="wav">WAV (Uncompressed PCM Waveform)</option>
                          <option value="aac">AAC (Advanced Audio Coding)</option>
                          <option value="ogg">OGG Vorbis Audio</option>
                        </select>
                      </div>
                    </div>

                    <div className="config-card">
                      <div className="config-title">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                        Quality Profile (Bitrate)
                      </div>
                      <div className="form-group">
                        <label>Constant Bitrate (CBR)</label>
                        <select
                          className="custom-select"
                          value={audioConfig.bitrate}
                          disabled={audioConfig.format === "wav"}
                          onChange={(e) => setAudioConfig({ ...audioConfig, bitrate: e.target.value })}
                        >
                          {audioConfig.format === "wav" ? (
                            <option value="auto">Auto (Lossless 16-bit PCM)</option>
                          ) : (
                            <>
                              <option value="320k">320 kbps (Audiophile Quality)</option>
                              <option value="192k">192 kbps (High Quality Standard)</option>
                              <option value="128k">128 kbps (Standard Compression)</option>
                              <option value="64k">64 kbps (Low Quality - Voice/Podcast)</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Action Trigger Button */}
              <button
                className="action-btn"
                onClick={handleProcessMedia}
                disabled={!uploadedFileId || apiStatus === "offline"}
              >
                <svg viewBox="0 0 24 24">
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
                {activeTab === "image" && "Run Image Compressor"}
                {activeTab === "video" && "Run Video Optimizer"}
                {activeTab === "audio" && "Run Audio Converter"}
              </button>
            </div>
          )}

          {/* Step 4: Processing Animation Spinner */}
          {processing && (
            <div className="spinner-container">
              <div className="spinner"></div>
              <h3 style={{ fontFamily: "Outfit" }}>Processing Media via FFmpeg...</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                Running command line codecs. Larger files may take several minutes.
              </p>
            </div>
          )}

          {/* Step 5: Completed Success and Download Panel */}
          {processResult && (
            <div className="result-card">
              <div className="result-header">
                <div className="result-badge">
                  <svg viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <h3>Processing Complete!</h3>
                  <p>FFmpeg successfully finished compiling and exporting your file.</p>
                </div>
              </div>

              {/* Stats Box */}
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">Original Size</span>
                  <span className="stat-val">{formatBytes(processResult.original_size)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Processed Size</span>
                  <span className="stat-val">{formatBytes(processResult.processed_size)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Savings Ratio</span>
                  <span className="stat-val savings">
                    {processResult.savings_percent > 0 ? `-${processResult.savings_percent}%` : "0% (Lossless)"}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <button className="download-btn" onClick={handleDownload}>
                  <svg viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download {processResult.filename.length > 20 ? "Processed File" : processResult.filename}
                </button>
                <button
                  className="action-btn"
                  style={{ background: "transparent", border: "1px solid var(--border-color)", marginTop: "0", boxShadow: "none" }}
                  onClick={handleReset}
                >
                  Process Another File
                </button>
              </div>
            </div>
          )}

          {/* Error Message banner */}
          {processError && (
            <div className="error-card">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="error-text">
                <strong>Error: </strong>
                {processError}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
