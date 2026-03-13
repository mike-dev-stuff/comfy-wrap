import tomllib
from pathlib import Path

_config_path = Path(__file__).parent / "config.toml"
with open(_config_path, "rb") as f:
    _cfg = tomllib.load(f)

COMFYUI_HOST = _cfg["comfyui"]["host"]
COMFYUI_PORT = _cfg["comfyui"]["port"]
COMFYUI_URL = f"http://{COMFYUI_HOST}:{COMFYUI_PORT}"
COMFYUI_WS = f"ws://{COMFYUI_HOST}:{COMFYUI_PORT}/ws"
COMFYUI_OUTPUT_DIR = _cfg["comfyui"].get("output_dir", "/home/mike/repos/ComfyUI/output")
COMFYUI_LOCAL = COMFYUI_HOST in ("0.0.0.0", "127.0.0.1", "localhost", "::1")

SERVER_PORT = _cfg["server"]["port"]
