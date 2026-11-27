"""Load a local multilingual checkpoint with the public Laya 0.3.7 server API."""
import hashlib
import os
from pathlib import Path

import torch
import uvicorn
from laya.router import Router
from laya.serve import create_app

if __name__ == "__main__":
    torch.set_num_threads(int(os.environ["LAYA_THREADS"]))
    router = Router(
        models={"multilingual": os.environ["LAYA_MULTILINGUAL_MODEL_PATH"]},
        device="cpu",
        default="multilingual",
        max_loaded=1,
    )
    router.preload(["multilingual"])
    app = create_app(router)
    with (Path(os.environ["LAYA_MULTILINGUAL_MODEL_PATH"]) / "model.safetensors").open("rb") as f:
        checksum = hashlib.file_digest(f, "sha256").hexdigest()

    @app.get("/harness/checkpoint")
    def checkpoint():
        return {"model": "multilingual", "sha256": checksum}

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ["LAYA_PORT"]))
