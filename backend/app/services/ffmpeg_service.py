import os
import asyncio
import logging
import subprocess

# Configure logging for the service
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ffmpeg_service")

class FFmpegService:
    @staticmethod
    def get_ffmpeg_executable() -> str:
        """
        Dynamically locate the FFmpeg executable, resolving system path
        or falling back to the local Winget packages path.
        """
        import shutil
        system_ffmpeg = shutil.which("ffmpeg")
        if system_ffmpeg:
            return system_ffmpeg

        winget_path = r"C:\Users\Tanisha Gupta\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe"
        if os.path.exists(winget_path):
            return winget_path

        return "ffmpeg"

    @staticmethod
    def run_ffmpeg_sync(cmd: list[str]) -> tuple[int, str, str]:
        """
        Runs a command synchronously and returns (returncode, stdout, stderr).
        """
        try:
            # Using Popen to execute system subprocesses safely
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace"
            )
            stdout, stderr = process.communicate()
            return process.returncode, stdout, stderr
        except Exception as e:
            return -1, "", str(e)

    @classmethod
    async def is_ffmpeg_installed(cls) -> bool:
        """
        Check if FFmpeg is installed and accessible in the system path or local fallback.
        """
        try:
            exe_path = cls.get_ffmpeg_executable()
            loop = asyncio.get_running_loop()
            returncode, stdout, stderr = await loop.run_in_executor(
                None,
                cls.run_ffmpeg_sync,
                [exe_path, "-version"]
            )
            return returncode == 0
        except Exception as e:
            logger.error(f"Error checking FFmpeg status: {e}")
            return False

    @classmethod
    async def execute_command(cls, cmd: list[str]) -> bool:
        """
        Executes an FFmpeg command asynchronously via thread pool and logs output.
        """
        logger.info(f"Executing command: {' '.join(cmd)}")
        try:
            loop = asyncio.get_running_loop()
            returncode, stdout, stderr = await loop.run_in_executor(
                None,
                cls.run_ffmpeg_sync,
                cmd
            )
            
            if returncode != 0:
                logger.error(f"FFmpeg command failed with return code {returncode}")
                logger.error(f"FFmpeg Stderr: {stderr}")
                raise RuntimeError(f"FFmpeg error: {stderr}")
            
            logger.info("FFmpeg command completed successfully.")
            return True
        except Exception as e:
            logger.error(f"Exception during FFmpeg execution: {e}")
            raise

    async def compress_image(
        self, input_path: str, output_path: str, quality: int, scale: int
    ) -> str:
        """
        Compresses an image using FFmpeg.
        - quality: 1-100 (where 100 is best quality, 1 is highest compression)
        - scale: 1-100 (percentage scale of image dimensions)
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError("Input file does not exist")

        exe_path = self.get_ffmpeg_executable()
        cmd = [exe_path, "-y", "-i", input_path]

        # Determine extension and build appropriate filters
        ext = os.path.splitext(output_path.lower())[1]
        filters = []
        filter_complex = None

        if ext == ".png" and quality < 100:
            # Lossy PNG compression using custom palette reduction
            max_colors = max(16, min(256, int(quality * 2.56)))
            if scale < 100:
                sf = scale / 100.0
                filter_complex = f"[0:v]scale=iw*{sf}:ih*{sf}[scaled];[scaled]split[x][y];[x]palettegen=max_colors={max_colors}[p];[y][p]paletteuse"
            else:
                filter_complex = f"[0:v]split[x][y];[x]palettegen=max_colors={max_colors}[p];[y][p]paletteuse"
        else:
            # Standard scaling for other formats/lossless PNG
            if scale < 100:
                sf = scale / 100.0
                filters.append(f"scale=iw*{sf}:ih*{sf}")

        # Apply filters to command
        if filter_complex:
            cmd.extend(["-filter_complex", filter_complex])
        elif filters:
            cmd.extend(["-vf", ",".join(filters)])

        # Set format-specific compression flags based on output file extension
        if ext in [".jpg", ".jpeg"]:
            # FFmpeg JPEG quality is set via -q:v from 1 (best) to 31 (worst)
            # Map 100 -> 1 and 1 -> 31
            q_val = max(1, min(31, 31 - int(quality * 30 / 100)))
            cmd.extend(["-q:v", str(q_val)])
        elif ext == ".webp":
            # For webp, -quality goes from 0 to 100
            cmd.extend(["-quality", str(quality)])
        elif ext == ".png":
            if quality == 100:
                # Max lossless compression level for PNG
                cmd.extend(["-compression_level", "9"])

        cmd.append(output_path)
        await self.execute_command(cmd)

        # Fallback check to avoid size bloat if format and scale did not change
        try:
            in_ext = os.path.splitext(input_path.lower())[1]
            out_ext = os.path.splitext(output_path.lower())[1]
            in_ext_norm = ".jpg" if in_ext == ".jpeg" else in_ext
            out_ext_norm = ".jpg" if out_ext == ".jpeg" else out_ext
            
            if in_ext_norm == out_ext_norm and scale == 100:
                original_size = os.path.getsize(input_path)
                processed_size = os.path.getsize(output_path)
                if processed_size > original_size:
                    logger.info(f"Compressed file ({processed_size} bytes) is larger than original ({original_size} bytes). Falling back to original file.")
                    import shutil
                    shutil.copy2(input_path, output_path)
        except Exception as e:
            logger.error(f"Error in post-compression size check fallback: {e}")

        return output_path

    async def compress_video(
        self, input_path: str, output_path: str, quality: str, resolution: str
    ) -> str:
        """
        Compresses a video using libx264.
        - quality: 'high', 'medium', 'low'
        - resolution: 'original', '1080p', '720p', '480p'
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError("Input file does not exist")

        exe_path = self.get_ffmpeg_executable()
        cmd = [exe_path, "-y", "-i", input_path]

        # Set quality via Constant Rate Factor (CRF)
        # Low CRF = High quality, High CRF = Low quality
        crf_map = {
            "high": "20",
            "medium": "26",
            "low": "32"
        }
        crf = crf_map.get(quality.lower(), "26")

        # Set resolution via scale filter
        filters = []
        if resolution != "original":
            res_map = {
                "1080p": "1080",
                "720p": "720",
                "480p": "480"
            }
            h = res_map.get(resolution)
            if h:
                # scale=-2:h ensures the width is divisible by 2 for standard h264 encoder compatibility
                filters.append(f"scale=-2:{h}")

        if filters:
            cmd.extend(["-vf", ",".join(filters)])

        # Apply codecs
        cmd.extend([
            "-vcodec", "libx264",
            "-crf", crf,
            "-preset", "medium",
            "-acodec", "aac",
            "-b:a", "128k"
        ])

        cmd.append(output_path)
        await self.execute_command(cmd)

        # Fallback check to avoid size bloat if resolution did not change
        try:
            if resolution == "original":
                original_size = os.path.getsize(input_path)
                processed_size = os.path.getsize(output_path)
                if processed_size > original_size:
                    logger.info(f"Compressed video ({processed_size} bytes) is larger than original ({original_size} bytes). Falling back to original file.")
                    import shutil
                    shutil.copy2(input_path, output_path)
        except Exception as e:
            logger.error(f"Error in post-compression video size check fallback: {e}")

        return output_path

    async def convert_audio(
        self, input_path: str, output_path: str, format_name: str, bitrate: str
    ) -> str:
        """
        Converts audio file formats and applies bitrates.
        - format_name: 'mp3', 'wav', 'aac', 'ogg'
        - bitrate: '320k', '192k', '128k', '64k'
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError("Input file does not exist")

        exe_path = self.get_ffmpeg_executable()
        cmd = [exe_path, "-y", "-i", input_path]
        fmt = format_name.lower()

        # Define configurations per format
        if fmt == "mp3":
            cmd.extend(["-acodec", "libmp3lame", "-b:a", bitrate])
        elif fmt == "aac":
            cmd.extend(["-acodec", "aac", "-b:a", bitrate])
        elif fmt == "ogg":
            cmd.extend(["-acodec", "libvorbis", "-b:a", bitrate])
        elif fmt == "wav":
            # Lossless WAV (PCM 16-bit little endian) - does not require bitrate option
            cmd.extend(["-acodec", "pcm_s16le"])
        else:
            # Fallback - let FFmpeg guess by output filename extension
            pass

        cmd.append(output_path)
        await self.execute_command(cmd)
        return output_path
