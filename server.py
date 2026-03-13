import asyncio
import json
import uuid
import copy
from pathlib import Path

import httpx
import uvicorn
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import Response, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import COMFYUI_URL, COMFYUI_WS, COMFYUI_HOST, COMFYUI_OUTPUT_DIR, COMFYUI_LOCAL, SERVER_PORT

app = FastAPI()

WORKFLOWS_DIR = Path(__file__).parent / "workflows"
T2I_TEMPLATE = json.loads((WORKFLOWS_DIR / "t2i.json").read_text())
I2V_TEMPLATE = json.loads((WORKFLOWS_DIR / "wan_i2v.json").read_text())


# ── API endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/models")
async def get_models():
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{COMFYUI_URL}/object_info/CheckpointLoaderSimple")
        data = resp.json()
    checkpoints = data["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    return {"models": checkpoints}


@app.get("/api/loras")
async def get_loras():
    async with httpx.AsyncClient() as client:
        # Use the standard LoraLoader node which has a reliable schema
        resp = await client.get(f"{COMFYUI_URL}/object_info/LoraLoader")
        data = resp.json()
    lora_list = data["LoraLoader"]["input"]["required"]["lora_name"][0]
    return {"loras": lora_list}


@app.get("/api/unet_models")
async def get_unet_models():
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{COMFYUI_URL}/object_info/UNETLoader")
        data = resp.json()
    models = data["UNETLoader"]["input"]["required"]["unet_name"][0]
    return {"models": models}


@app.get("/api/i2v_loras")
async def get_i2v_loras():
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{COMFYUI_URL}/object_info/LoraLoaderModelOnly")
        data = resp.json()
    loras = data["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    return {"loras": loras}


@app.get("/api/samplers")
async def get_samplers():
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{COMFYUI_URL}/object_info/KSampler")
        data = resp.json()
    inputs = data["KSampler"]["input"]["required"]
    return {
        "samplers": inputs["sampler_name"][0],
        "schedulers": inputs["scheduler"][0],
    }


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    """Proxy image upload to ComfyUI."""
    contents = await file.read()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{COMFYUI_URL}/upload/image",
            files={"image": (file.filename, contents, file.content_type)},
            data={"overwrite": "true"},
        )
    return resp.json()


@app.post("/api/generate")
async def generate(body: dict):
    """Build workflow from params and submit to ComfyUI."""
    workflow_type = body.get("type", "t2i")
    client_id = body.get("client_id") or str(uuid.uuid4())

    if workflow_type == "t2i":
        workflow = build_t2i_workflow(body)
    else:
        workflow = build_i2v_workflow(body)

    payload = {"prompt": workflow, "client_id": client_id}

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{COMFYUI_URL}/prompt", json=payload)
    result = resp.json()
    result["client_id"] = client_id
    return result


@app.get("/api/history/{prompt_id}")
async def get_history(prompt_id: str):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{COMFYUI_URL}/history/{prompt_id}")
    return resp.json()


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXTS = {".mp4", ".webm", ".gif"}

MEDIA_EXTS = " -o ".join(f"-iname '*.{e}'" for e in ["png", "jpg", "jpeg", "webp", "mp4", "webm", "gif"])

MEDIA_SUFFIXES = IMAGE_EXTS | VIDEO_EXTS


def _list_outputs_local(offset: int, limit: int):
    """List output files from a local ComfyUI output directory."""
    out = Path(COMFYUI_OUTPUT_DIR)
    if not out.is_dir():
        return {"items": [], "has_more": False}

    files = []
    for p in out.iterdir():
        if p.is_file() and p.suffix.lower() in MEDIA_SUFFIXES:
            files.append(p)
        elif p.is_dir():
            for child in p.iterdir():
                if child.is_file() and child.suffix.lower() in MEDIA_SUFFIXES:
                    files.append(child)

    # Sort newest first
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    fetch = limit + 1
    page = files[offset : offset + fetch]

    items = []
    for p in page:
        rel = p.relative_to(out)
        subfolder = str(rel.parent) if str(rel.parent) != "." else ""
        media = "video" if p.suffix.lower() in VIDEO_EXTS else "image"
        items.append({"filename": p.name, "subfolder": subfolder, "type": "output", "media": media})

    has_more = len(items) > limit
    return {"items": items[:limit], "has_more": has_more}


async def _list_outputs_remote(offset: int, limit: int):
    """List output files from a remote ComfyUI host via SSH."""
    skip = offset + 1  # tail -n + is 1-indexed
    fetch = limit + 1
    remote_cmd = (
        f"find {COMFYUI_OUTPUT_DIR} -maxdepth 2 -type f"
        f" \\( {MEDIA_EXTS} \\)"
        f" -printf '%T@\\t%P\\n'"
        f" | sort -rn"
        f" | tail -n +{skip} | head -n {fetch}"
    )
    proc = await asyncio.create_subprocess_exec(
        "ssh", COMFYUI_HOST, remote_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        return JSONResponse({"items": [], "error": stderr.decode().strip()}, status_code=502)

    lines = stdout.decode().strip().split("\n")
    if not lines or lines == [""]:
        return {"items": [], "has_more": False}

    items = []
    for line in lines:
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        _, relpath = parts
        p = Path(relpath)
        media = "video" if p.suffix.lower() in VIDEO_EXTS else "image"
        subfolder = str(p.parent) if str(p.parent) != "." else ""
        items.append({"filename": p.name, "subfolder": subfolder, "type": "output", "media": media})

    has_more = len(items) > limit
    return {"items": items[:limit], "has_more": has_more}


@app.get("/api/outputs")
async def list_outputs(offset: int = 0, limit: int = 20):
    """List images and videos in ComfyUI's output directory, newest first, paginated."""
    if COMFYUI_LOCAL:
        return _list_outputs_local(offset, limit)
    return await _list_outputs_remote(offset, limit)


@app.get("/api/view")
async def view_file(filename: str, subfolder: str = "", type: str = "output"):
    """Proxy file view from ComfyUI."""
    params = {"filename": filename, "subfolder": subfolder, "type": type}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(f"{COMFYUI_URL}/view", params=params)
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "application/octet-stream"),
    )


# ── WebSocket proxy ───────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_proxy(ws: WebSocket, clientId: str | None = None):
    await ws.accept()
    client_id = clientId or str(uuid.uuid4())
    try:
        async with websockets.connect(f"{COMFYUI_WS}?clientId={client_id}") as comfy_ws:
            # Send client_id to frontend
            await ws.send_json({"type": "client_id", "client_id": client_id})
            # Relay messages from ComfyUI to browser
            async for msg in comfy_ws:
                if isinstance(msg, str):
                    await ws.send_text(msg)
                else:
                    # Binary data (preview images) — skip or forward
                    pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ── Workflow builders ─────────────────────────────────────────────────────────

def build_t2i_workflow(params: dict) -> dict:
    wf = copy.deepcopy(T2I_TEMPLATE)

    # Checkpoint
    wf["3"]["inputs"]["ckpt_name"] = params.get("model", wf["3"]["inputs"]["ckpt_name"])

    # LoRA
    loras = params.get("loras", [])
    if loras:
        lora_inputs = wf["2"]["inputs"]
        # Clear existing lora entries
        keys_to_remove = [k for k in lora_inputs if k.startswith("lora_")]
        for k in keys_to_remove:
            del lora_inputs[k]
        # Add new entries
        for i, lora in enumerate(loras, 1):
            lora_inputs[f"lora_{i}"] = {
                "on": True,
                "lora": lora["name"],
                "strength": float(lora.get("strength", 1.0)),
            }
    else:
        # No LoRAs selected — remove all lora entries
        lora_inputs = wf["2"]["inputs"]
        keys_to_remove = [k for k in lora_inputs if k.startswith("lora_")]
        for k in keys_to_remove:
            del lora_inputs[k]

    # Prompts
    wf["1"]["inputs"]["text"] = params.get("positive", "")
    wf["4"]["inputs"]["text"] = params.get("negative", "")

    # Image size
    wf["7"]["inputs"]["width"] = int(params.get("width", 720))
    wf["7"]["inputs"]["height"] = int(params.get("height", 1280))

    # KSampler
    seed = params.get("seed", -1)
    if seed == -1:
        import random
        seed = random.randint(0, 2**53)
    wf["6"]["inputs"]["seed"] = int(seed)
    wf["6"]["inputs"]["steps"] = int(params.get("steps", 20))
    wf["6"]["inputs"]["cfg"] = float(params.get("cfg", 4))
    wf["6"]["inputs"]["sampler_name"] = params.get("sampler_name", "euler")
    wf["6"]["inputs"]["scheduler"] = params.get("scheduler", "normal")
    wf["6"]["inputs"]["denoise"] = float(params.get("denoise", 1.0))

    return wf


def build_i2v_workflow(params: dict) -> dict:
    wf = copy.deepcopy(I2V_TEMPLATE)

    # Prompts
    wf["93"]["inputs"]["text"] = params.get("positive", "")
    wf["89"]["inputs"]["text"] = params.get("negative", wf["89"]["inputs"]["text"])

    # Input image
    wf["97"]["inputs"]["image"] = params.get("image", wf["97"]["inputs"]["image"])

    # Video dimensions and length
    wf["98"]["inputs"]["width"] = int(params.get("width", 640))
    wf["98"]["inputs"]["height"] = int(params.get("height", 640))
    wf["98"]["inputs"]["length"] = int(params.get("length", 81))

    # FPS
    wf["94"]["inputs"]["fps"] = int(params.get("fps", 16))

    # Models
    wf["95"]["inputs"]["unet_name"] = params.get("high_model", wf["95"]["inputs"]["unet_name"])
    wf["96"]["inputs"]["unet_name"] = params.get("low_model", wf["96"]["inputs"]["unet_name"])
    wf["101"]["inputs"]["lora_name"] = params.get("high_lora", wf["101"]["inputs"]["lora_name"])
    wf["102"]["inputs"]["lora_name"] = params.get("low_lora", wf["102"]["inputs"]["lora_name"])

    # Seed (shared across both KSamplerAdvanced nodes)
    seed = params.get("seed", -1)
    if seed == -1:
        import random
        seed = random.randint(0, 2**53)
    wf["85"]["inputs"]["noise_seed"] = int(seed)
    wf["86"]["inputs"]["noise_seed"] = int(seed)

    return wf


# ── Static files & startup ────────────────────────────────────────────────────

STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT)
