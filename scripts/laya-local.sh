#!/bin/sh
# Run the router in the foreground. Install the Laya checkout's serve dependencies first.
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${LAYA_CHECKOUT:?Set LAYA_CHECKOUT to the checkout containing laya/serve.py}"
checkout=$(CDPATH= cd -- "$LAYA_CHECKOUT" && pwd)
python_bin=${LAYA_PYTHON:-$project/.agent/laya-env/bin/python}
export LAYA_MULTILINGUAL_MODEL_PATH=${LAYA_MULTILINGUAL_MODEL_PATH:-$checkout/models/multilingual}
test -f "$checkout/laya/serve.py" || { echo 'Missing laya/serve.py in checkout' >&2; exit 1; }
test -f "$LAYA_MULTILINGUAL_MODEL_PATH/model.safetensors" || { echo 'Missing multilingual checkpoint' >&2; exit 1; }
export LAYA_HOST=127.0.0.1 LAYA_PORT=${LAYA_PORT:-18000} LAYA_CORS_ORIGINS=''
export LAYA_PRELOAD=1 LAYA_SINGLE_MODEL=multilingual LAYA_DEVICE=cpu
export LAYA_THREADS=${LAYA_CPU_THREADS:-2}
export OMP_NUM_THREADS=${LAYA_CPU_THREADS:-2} MKL_NUM_THREADS=${LAYA_CPU_THREADS:-2}
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false PYTHONPATH="$checkout"
exec "$python_bin" "$project/scripts/laya-server.py"
