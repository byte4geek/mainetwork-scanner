#!/bin/bash

# ==============================================================================
# Script:
# Install MariaDB, Dipendenze Sistema/Python, Configura DB/Tabella,
# Install Nginx/Gunicorn/Flask, Configura Sito Web (remove default link Nginx)
# and Systemd services.
# ==============================================================================

# === Color for Output ===
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# === Configurable Variables ===
DB_NAME="network_scan_db"
DB_USER="mainet"
PROJECT_DIR="/opt/mainetwork"  # MODIFICA SE NECESSARIO (es. /opt/network-scanner)
VENV_NAME="scan_env"
PYTHON_SCANNER_SCRIPT="network_scanner_db.py"
WRAPPER_SCANNER_SCRIPT="run_scanner.sh"
PYTHON_WEBAPP_SCRIPT="webapp.py"
SERVICE_SCANNER="network_scanner"
SERVICE_WEBAPP="network_scanner_web"
FLASK_PORT=5000
# The MariaDB password will be asked

# === Funzioni Log ===
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${CYAN}--- $1 ---${NC}"; }

# === Controllo Root e Utente ===
if [ "$EUID" -ne 0 ]; then
    log_error "This script require root. Run it with sudo."
    exit 1
fi

# Determine the user who called Sudo (for venv/wrapper permits)
CALLING_USER=${SUDO_USER:-$(whoami)}
if [ "$CALLING_USER" == "root" ] && [ -z "$SUDO_USER" ]; then
    log_warn "Running as root. The right of Venv/Wrapper maybe not optimal."
    log_warn "It is recommended to perform with 'Sudo ./setup_environment.sh' by a normal user."
fi
log_info "User target for perrmits Venv/Wrapper/Web: $CALLING_USER"

# === Create Directory Project and Web ===
log_step "Check/Creation Directory Project and Web"
if [ ! -d "$PROJECT_DIR" ]; then
    log_info "Creating directory project: $PROJECT_DIR"
    mkdir -p "$PROJECT_DIR"
    chown "$CALLING_USER":"$CALLING_USER" "$PROJECT_DIR"
    log_info "Set owner of $PROJECT_DIR to $CALLING_USER"
else
    log_info "Project dir $PROJECT_DIR already present."
fi

WEB_DIRS=( "${PROJECT_DIR}/templates" "${PROJECT_DIR}/static" )
for dir in "${WEB_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        log_info "Creating directory web: $dir"
        mkdir -p "$dir"
        chown "$CALLING_USER":"$CALLING_USER" "$dir"
    else
        log_info "Directory web $dir already exist."
    fi
done

# Define complete paths
VENV_PATH="${PROJECT_DIR}/${VENV_NAME}"
WRAPPER_SCANNER_PATH="${PROJECT_DIR}/${WRAPPER_SCANNER_SCRIPT}"
PYTHON_SCANNER_PATH="${PROJECT_DIR}/${PYTHON_SCANNER_SCRIPT}"
PYTHON_WEBAPP_PATH="${PROJECT_DIR}/${PYTHON_WEBAPP_SCRIPT}"

# === Installazione Pacchetti di Sistema (apt) ===
log_step "Installing System packages"
SYSTEM_PACKAGES=(
    mariadb-server mariadb-client
    python3-pip python3-venv python3-full
    wget tcpdump libpcap-dev libmariadb-dev
    nginx apache2-utils
)
PACKAGES_TO_INSTALL=()
log_info "Verify required System packages..."
for pkg in "${SYSTEM_PACKAGES[@]}"; do
    if ! dpkg -s "$pkg" &> /dev/null; then
        log_info "  -> Package '$pkg' missing."
        PACKAGES_TO_INSTALL+=("$pkg")
    else
		log_info "  -> Packet '$pkg' already installed."
    fi
done

if [ ${#PACKAGES_TO_INSTALL[@]} -gt 0 ]; then
    log_info "Installing missing apt packages: ${PACKAGES_TO_INSTALL[*]}..."
    apt update
    apt install -y "${PACKAGES_TO_INSTALL[@]}"
    if [ $? -ne 0 ]; then
        log_error "Installation packages apt failed."
        exit 1
    fi
    log_info "Installation packages apt completed."
else
    log_info "All the necessary system packages are already installed."
fi

# === Start and securing MariaDB ===
log_step "Starting and Sicuring MariaDB"
log_info "Start/Enable MariaDB Service..."
systemctl start mariadb
systemctl enable mariadb
log_warn "Remeber: Perform 'sudo mysql_secure_installation' Manually after this script!"
read -p "Press [Enter] to continue..."

# === Configuring Database MariaDB ===
log_step "Configuring Database MariaDB (Check if exist)"
log_info "Configuring DB: ${DB_NAME}, User: ${DB_USER}"

# Controlla se DB esiste
log_info "Check database existence '${DB_NAME}'..."
DB_EXISTS=$(mysql -N -s -e "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${DB_NAME}';" 2>/dev/null)

if [ -n "$DB_EXISTS" ]; then
    log_warn "The database '${DB_NAME}' already exist!"
    while true; do
        read -p "Do you want to delete it? (WARNING: ALL DATA WIIL BE LOST!) (y/n): " yn
        case $yn in
            [Yy]* )
                log_info "Deleting DB '${DB_NAME}'..."
                mysql -e "DROP DATABASE ${DB_NAME};"
                if [ $? -eq 0 ]; then
                    log_info "DB deleted with succes."
                else
                    log_error "Deleting DB failed (maybe in use?)."
                fi
                break;;
            [Nn]* )
                log_info "Existent DB not deleted."
                break;;
            * ) echo "Select 'y' o 'n'.";;
        esac
    done
else
    log_info "The Database '${DB_NAME}' not exist. It will be created."
fi

# ask password DB
if [ -z "$DB_PASSWORD" ]; then
    while true; do
        read -sp "Insert password for user MariaDB '${DB_USER}': " DB_PASSWORD && echo
        read -sp "Confirm password: " DB_PASSWORD_CONFIRM && echo
        if [ "$DB_PASSWORD" = "$DB_PASSWORD_CONFIRM" ] && [ -n "$DB_PASSWORD" ]; then
            break
        fi
        log_warn "Password not valid or not equals. Retry."
    done
fi

# Crate DB (if not exist) and user
log_info "Creating database (if not exist) and user '${DB_USER}'..."
mysql <<MYSQL_SCRIPT
CREATE DATABASE IF NOT EXISTS ${DB_NAME};
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
MYSQL_SCRIPT
if [ $? -ne 0 ]; then
    log_error "Setup DB/Utente failed."
    exit 1
fi
log_info "DB and user '${DB_USER}' configured."

# === hosts Table creation ===
log_step "Creating Table 'hosts'"
log_info "Creating/Update table 'hosts'..."

# Run SQL command to create/alter table
mysql ${DB_NAME} <<MYSQL_SCRIPT
CREATE TABLE IF NOT EXISTS hosts (
    ip_address VARCHAR(45) PRIMARY KEY,
    mac_address VARCHAR(17),
    vendor VARCHAR(255),
    hostname VARCHAR(255),
    ports TEXT,
    note TEXT,
    status ENUM('ONLINE','OFFLINE') DEFAULT 'OFFLINE',
    known_host TINYINT(1) DEFAULT 0,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_online DATETIME,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS hostname VARCHAR(255) NULL DEFAULT NULL AFTER vendor;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS ports TEXT NULL DEFAULT NULL AFTER hostname;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS note TEXT NULL DEFAULT NULL AFTER ports;
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS known_host TINYINT(1) NOT NULL DEFAULT 0 AFTER note;
ALTER IGNORE TABLE hosts ADD INDEX idx_mac_address (mac_address);
ALTER IGNORE TABLE hosts ADD INDEX idx_status (status);
ALTER IGNORE TABLE hosts ADD INDEX idx_known_host (known_host);
MYSQL_SCRIPT

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    log_warn "Failed initial SQL commands ($EXIT_CODE). Attempting/correction columns..."
    COLUMN_ERRORS=0
    # Verifica/Aggiungi hostname
    ERROR_MSG_HN=$(mysql ${DB_NAME} --skip-column-names -e "ALTER TABLE hosts ADD COLUMN hostname VARCHAR(255) NULL DEFAULT NULL AFTER vendor;" 2>&1)
    if [ $? -ne 0 ] && [[ "$ERROR_MSG_HN" != *"Duplicate column name"* ]]; then log_error "Errore colonna 'hostname': $ERROR_MSG_HN"; COLUMN_ERRORS=1; elif [[ "$ERROR_MSG_HN" == *"Duplicate column name"* ]]; then log_info "Colonna 'hostname' OK."; fi
    # Verifica/Aggiungi ports
    ERROR_MSG_PO=$(mysql ${DB_NAME} --skip-column-names -e "ALTER TABLE hosts ADD COLUMN ports TEXT NULL DEFAULT NULL AFTER hostname;" 2>&1)
    if [ $? -ne 0 ] && [[ "$ERROR_MSG_PO" != *"Duplicate column name"* ]]; then log_error "Errore colonna 'ports': $ERROR_MSG_PO"; COLUMN_ERRORS=1; elif [[ "$ERROR_MSG_PO" == *"Duplicate column name"* ]]; then log_info "Colonna 'ports' OK."; fi
    # Verifica/Aggiungi note
    ERROR_MSG_NO=$(mysql ${DB_NAME} --skip-column-names -e "ALTER TABLE hosts ADD COLUMN note TEXT NULL DEFAULT NULL AFTER ports;" 2>&1)
    if [ $? -ne 0 ] && [[ "$ERROR_MSG_NO" != *"Duplicate column name"* ]]; then log_error "Errore colonna 'note': $ERROR_MSG_NO"; COLUMN_ERRORS=1; elif [[ "$ERROR_MSG_NO" == *"Duplicate column name"* ]]; then log_info "Colonna 'note' OK."; fi
    # Verifica/Aggiungi known_host
    ERROR_MSG_KH=$(mysql ${DB_NAME} --skip-column-names -e "ALTER TABLE hosts ADD COLUMN known_host TINYINT(1) NOT NULL DEFAULT 0 AFTER note;" 2>&1)
    if [ $? -ne 0 ] && [[ "$ERROR_MSG_KH" != *"Duplicate column name"* ]]; then log_error "Errore colonna 'known_host': $ERROR_MSG_KH"; COLUMN_ERRORS=1; elif [[ "$ERROR_MSG_KH" == *"Duplicate column name"* ]]; then log_info "Colonna 'known_host' OK."; fi

    if [ $COLUMN_ERRORS -ne 0 ]; then
        log_error "Impossible to create/update the 'hosts' table correctly."
        exit 1
    else
         log_info "Column verification/correction completed."
         log_info "Table 'hosts' OK."
    fi
else
    log_info "Tabele 'hosts' created/verifyed/updated OK."
fi

# === Configuring Virtual Python env (Venv) ===
log_step "Configuring Venv Python"
if [ ! -d "$VENV_PATH" ]; then
    log_info "Virtual environment creation in: $VENV_PATH"
    # Run as normal user if possible
    if [ "$CALLING_USER" != "root" ]; then
        sudo -u "$CALLING_USER" python3 -m venv "$VENV_PATH"
    else
        python3 -m venv "$VENV_PATH"
        chown -R "$CALLING_USER":"$CALLING_USER" "$VENV_PATH" # Set owner/rights
    fi
    if [ $? -ne 0 ]; then
        log_error "Creation of venv failed."
        exit 1
    fi
    log_info "Venv created."
else
    log_info "Venv $VENV_PATH already exist."
fi

# === Installing Python packages (pip) in Venv ===
log_step "Installing Python packages"
PIP_EXEC="${VENV_PATH}/bin/pip"
PYTHON_PACKAGES=( "scapy" "python-dotenv" "requests" "mariadb" "Flask" "gunicorn" )
log_info "Update of pip in venv..."
"$PIP_EXEC" install --upgrade pip
if [ $? -ne 0 ]; then
    log_warn "Updating pip in venv failed (it may not be critical)."
fi
log_info "Installing Python packages: ${PYTHON_PACKAGES[*]}..."
"$PIP_EXEC" install "${PYTHON_PACKAGES[@]}"
if [ $? -ne 0 ]; then
    log_error "Installation Python packages failed in the venv. Check errors above."
    # Not exit, user may be fix it manually
else
    log_info "Python packages successfully installed in the venv."
fi

# === Creation of Script Wrapper Scanner ===
log_step "Creation/Update Script Wrapper Scanner (${WRAPPER_SCANNER_SCRIPT})"
cat > "$WRAPPER_SCANNER_PATH" << EOF
#!/bin/bash
SCRIPT_DIR="\$( cd "\$( dirname "\${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
VENV_PATH="\$SCRIPT_DIR/${VENV_NAME}"
PYTHON_SCRIPT="\$SCRIPT_DIR/${PYTHON_SCANNER_SCRIPT}"
ENV_FILE="\$SCRIPT_DIR/.env"

# Check file/dir
if [ ! -f "\$ENV_FILE" ]; then echo "[$(date)] ERROR: .env missing."; exit 1; fi
if [ ! -d "\$VENV_PATH" ]; then echo "[$(date)] ERROR: Venv missing."; exit 1; fi
if [ ! -f "\$PYTHON_SCRIPT" ]; then echo "[$(date)] ERROR: Script Scanner Python missing."; exit 1; fi

# Read SCAN_WAIT
SCAN_WAIT=\$(grep '^SCAN_WAIT=' "\$ENV_FILE" | sed 's/#.*//' | cut -d'=' -f2 | xargs)
if ! [[ "\$SCAN_WAIT" =~ ^[0-9]+$ ]] || [ "\$SCAN_WAIT" -le 0 ]; then
    echo "[$(date)] WARN: SCAN_WAIT non valid in .env. Use default: 60s."
    SCAN_WAIT=60
fi
echo "[$(date)] Interval Scanner: \$SCAN_WAIT s."

# Activate Venv
source "\$VENV_PATH/bin/activate"
if [ \$? -ne 0 ]; then echo "[$(date)] ERROR: Activating Venv failed."; exit 1; fi
echo "[$(date)] Venv activated for Scanner."

# Loop execution
while true; do
    echo "[$(date)] Runnig Scanner: \$PYTHON_SCRIPT..."
    python "\$PYTHON_SCRIPT" "\$@"
    EXIT_CODE=\$?
    echo "[$(date)] Scanner terminated (Code: \$EXIT_CODE)."
    if [ \$EXIT_CODE -ne 0 ]; then
        echo "[$(date)] ERROR Scanner (Code: \$EXIT_CODE). Wait extra 30s."
        sleep 30
    fi
    echo "[$(date)] Waiting \$SCAN_WAIT s..."
    sleep "\$SCAN_WAIT"
done
EOF

chmod +x "$WRAPPER_SCANNER_PATH"
chown "$CALLING_USER":"$CALLING_USER" "$WRAPPER_SCANNER_PATH"
log_info "Created/Updated wrapper scanner: $WRAPPER_SCANNER_PATH"

# === Configuring Nginx ===
log_step "Configuring Nginx"
NGINX_CONF_FILE="/etc/nginx/sites-available/${SERVICE_WEBAPP}"
NGINX_LINK_FILE="/etc/nginx/sites-enabled/${SERVICE_WEBAPP}"
NGINX_DEFAULT_LINK="/etc/nginx/sites-enabled/default"

log_info "Creating file conf Nginx: $NGINX_CONF_FILE"
# Create the Nginx configuration file with separate lines directives
cat > "$NGINX_CONF_FILE" << EOF
server {
    listen 80;
    # server_name your_domain_or_ip; # Uncomment and modify if needed

    location / {
        # HTTP Base Authentication
        auth_basic "Network Scanner login";
        auth_basic_user_file /etc/nginx/.htpasswd;

        # Proxy vs Gunicorn/Flask
        proxy_pass http://127.0.0.1:${FLASK_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable site by creating symbolic link
LINK_CREATED_OR_EXISTS=false
if [ ! -L "$NGINX_LINK_FILE" ]; then
    log_info "Abilitazione sito Nginx creando link..."
    ln -s "$NGINX_CONF_FILE" "$NGINX_LINK_FILE"
    if [ $? -eq 0 ]; then
        log_info "Link per $SERVICE_WEBAPP creato."
        LINK_CREATED_OR_EXISTS=true
    else
        log_error "Creating simoblic link failed $NGINX_LINK_FILE"
    fi
else
    log_info "Nginx site $SERVICE_WEBAPP already enabled."
    LINK_CREATED_OR_EXISTS=true
fi

# Remove default link Nginx if our link is active.
if [ "$LINK_CREATED_OR_EXISTS" = true ] && [ -L "$NGINX_DEFAULT_LINK" ]; then
    log_warn "Removing default link Nginx ($NGINX_DEFAULT_LINK)..."
    rm "$NGINX_DEFAULT_LINK"
    if [ $? -eq 0 ]; then
         log_info "Link default removed."
    else
         log_error "Removing link default failed."
    fi
elif [ "$LINK_CREATED_OR_EXISTS" = true ]; then
     log_info "default Link Nginx not found, OK."
fi

# Verify config and reload Nginx
log_info "Verifyng Nginx syntax..."
nginx -t
if [ $? -ne 0 ]; then
    log_error "Syntax error Nginx. Check output above."
    # In case of configuration error do not reload Nginx
else
    log_info "Syntax Nginx OK. Reload Nginx..."
    systemctl reload-or-restart nginx
fi

# === Systemd Service creation for the Scanner ===
log_step "Creating Systemd Scanner service (${SERVICE_SCANNER}.service)"
SYSTEMD_SCANNER_FILE="/etc/systemd/system/${SERVICE_SCANNER}.service"
cat > "$SYSTEMD_SCANNER_FILE" << EOF
[Unit]
Description=Network Scanner Service (${PYTHON_SCANNER_SCRIPT})
After=network.target mariadb.service syslog.target
Requires=mariadb.service

[Service]
User=root
Group=root
WorkingDirectory=${PROJECT_DIR}
ExecStart=${WRAPPER_SCANNER_PATH}
Restart=on-failure
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
log_info "File service scanner: $SYSTEMD_SCANNER_FILE"

# === Systemd Service creation for the Web App ===
log_step "Creating Systemd WebApp service (${SERVICE_WEBAPP}.service)"
SYSTEMD_WEBAPP_FILE="/etc/systemd/system/${SERVICE_WEBAPP}.service"
GUNICORN_EXEC="${VENV_PATH}/bin/gunicorn"
SERVICE_USER=$CALLING_USER

cat > "$SYSTEMD_WEBAPP_FILE" << EOF
[Unit]
Description=Network Scanner Web Application (Gunicorn serving ${PYTHON_WEBAPP_SCRIPT})
After=network.target

[Service]
User=${SERVICE_USER}
# Group= (Removed - use primary group User)
WorkingDirectory=${PROJECT_DIR}
ExecStart=${GUNICORN_EXEC} --workers 3 --bind 127.0.0.1:${FLASK_PORT} webapp:app
Environment="PATH=${VENV_PATH}/bin"
Restart=always
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
log_info "File service webapp: $SYSTEMD_WEBAPP_FILE"

# === Gestione Servizi Systemd ===
log_step "Managing Services Systemd"
log_info "Demon systemd reload..."
systemctl daemon-reload

log_info "Enabling service ${SERVICE_SCANNER}..."
systemctl enable "${SERVICE_SCANNER}.service"
log_info "Enabling service ${SERVICE_WEBAPP}..."
systemctl enable "${SERVICE_WEBAPP}.service"

log_info "Restart service ${SERVICE_SCANNER}..."
systemctl restart "${SERVICE_SCANNER}.service"
log_info "Restart service ${SERVICE_WEBAPP}..."
systemctl restart "${SERVICE_WEBAPP}.service"
sleep 2 # Pausa per dare tempo ai servizi di avviarsi

log_info "State ${SERVICE_SCANNER}:"
systemctl status "${SERVICE_SCANNER}.service" --no-pager | head -n 10
log_info "State ${SERVICE_WEBAPP}:"
systemctl status "${SERVICE_WEBAPP}.service" --no-pager | head -n 10

# === Istruzioni Finali ===
log_step "Final steps and Managing Services"
log_info "1. Create/Update the files Python/HTML/JS/Env if required in $PROJECT_DIR:"
echo -e "${CYAN}   - ${PYTHON_SCANNER_SCRIPT}"
echo -e "   - ${PYTHON_WEBAPP_SCRIPT}"
echo -e "   - templates/index.html"
echo -e "   - static/script.js"
echo -e "   - .env ${NC}"

log_info "2. Make sure the .env file in $PROJECT_DIR contains at least:"
echo -e "${CYAN}"
cat << EOF
# ${PROJECT_DIR}/.env (Esempio)
# .env
NETWORK_RANGE=192.168.1.0/24
LOG_FILE=network_scan_log.txt
OUI_FILE=oui.txt
SCAN_WAIT=15

# --- Custom OUI Settings ---
CUSTOM_OUI_FILE=custom_oui.txt

# --- Port Scan Settings ---
PORT_SCAN_ENABLED=true              # Enabling ports scan (true/false, yes/no, 1/0)
PORT_SCAN_RANGE="1-1024"            # Range ports to scan (es. "1-1024", "80,443,22,21", "22,80,443,8080-8090")
PORT_SCAN_TIMEOUT=0.5               # Timeout in seconds for connection to a single port (es. 0.5, 1.0)
PORT_SCAN_THREADS=20                # Number of thread for port scan
SCAN_PORT_INTERVAL_SECONDS=300 		# Interval ports scan in seconds (es. 300 = 5 minutes)

# Database info/credentials
DB_HOST=localhost
DB_PORT=3306
DB_USER=mainet
DB_PASSWORD=${DB_PASSWORD} # <-- The password you have chosen!
DB_NAME=network_scan_db
EOF

echo -e "${NC}"

log_info "3. Create the password file for Nginx (if not already done):"
echo -e "${CYAN}   sudo htpasswd -c /etc/nginx/.htpasswd <your_username>"
echo -e "   sudo chown root:www-data /etc/nginx/.htpasswd"
echo -e "   sudo chmod 640 /etc/nginx/.htpasswd ${NC}"

log_info "4. Web interface (will required login): ${CYAN}http://<IP_SERVER>/${NC}"

log_info "5. Managing service:"
echo -e "${CYAN}   sudo systemctl [status|stop|start|restart] ${SERVICE_SCANNER} | ${SERVICE_WEBAPP}${NC}"

log_info "6. Show log:"
echo -e "${CYAN}   sudo journalctl -u ${SERVICE_SCANNER} -f"
echo -e "   sudo journalctl -u ${SERVICE_WEBAPP} -f ${NC}"

log_info "7. (IMPORTANT) Run 'sudo mysql_secure_installation' for sicuring DB."

log_info "\n--- Setup completed! ---"

exit 0