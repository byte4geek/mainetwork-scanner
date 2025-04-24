#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
VENV_PATH="$SCRIPT_DIR/scan_env"
PYTHON_SCRIPT="$SCRIPT_DIR/network_scanner_db.py"
ENV_FILE="$SCRIPT_DIR/.env"

# Check file/dir
if [ ! -f "$ENV_FILE" ]; then echo "[$(date)] ERROR: .env missing."; exit 1; fi
if [ ! -d "$VENV_PATH" ]; then echo "[$(date)] ERROR: Venv missing."; exit 1; fi
if [ ! -f "$PYTHON_SCRIPT" ]; then echo "[$(date)] ERROR: Script Scanner Python missing."; exit 1; fi

# Read SCAN_WAIT
SCAN_WAIT=$(grep '^SCAN_WAIT=' "$ENV_FILE" | sed 's/#.*//' | cut -d'=' -f2 | xargs)
if ! [[ "$SCAN_WAIT" =~ ^[0-9]+$ ]] || [ "$SCAN_WAIT" -le 0 ]; then
    echo "[$(date)] WARN: SCAN_WAIT non valid in .env. Use default: 60s."
    SCAN_WAIT=60
fi
echo "[$(date)] Interval Scanner: $SCAN_WAIT s."

# Activate Venv
source "$VENV_PATH/bin/activate"
if [ $? -ne 0 ]; then echo "[$(date)] ERROR: Activating Venv failed."; exit 1; fi
echo "[$(date)] Venv activated for Scanner."

# Loop execution
while true; do
    echo "[$(date)] Runnig Scanner: $PYTHON_SCRIPT..."
    python "$PYTHON_SCRIPT" "$@"
    EXIT_CODE=$?
    echo "[$(date)] Scanner terminated (Code: $EXIT_CODE)."
    if [ $EXIT_CODE -ne 0 ]; then
        echo "[$(date)] ERROR Scanner (Code: $EXIT_CODE). Wait extra 30s."
        sleep 30
    fi
    echo "[$(date)] Waiting $SCAN_WAIT s..."
    sleep "$SCAN_WAIT"
done
