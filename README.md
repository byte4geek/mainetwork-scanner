# Network Scanner with Web UI

![logo](https://github.com/byte4geek/mainetwork-scanner/raw/main/mainetwork-scanner_logoB.png)

This project provides a Python-based network scanner that identifies hosts on a local network using ARP scans, performs optional port scans, looks up MAC vendors (with custom overrides), and stores the results in a MariaDB database. It includes a Flask web application served via Gunicorn and Nginx, offering a dynamic dashboard to view and manage scanned hosts.

![dashboard](https://github.com/byte4geek/mainetwork-scanner/raw/main/dashboard.png)

## Features

*   **Network Scanning:**
    *   ARP scan to discover active hosts on the specified network range.
    *   Optional TCP port scanning for discovered online hosts.
    *   Configurable scan interval for the main scanner.
    *   Configurable interval for the more intensive port scanning.
*   **Vendor Lookup:**
    *   Retrieves MAC address vendor information from the standard IEEE OUI list (downloaded automatically).
    *   Supports a custom OUI file (`custom_oui.txt`) to override or add specific vendor names based on OUI prefixes.
*   **Database Storage:**
    *   Uses MariaDB (MySQL compatible) to store host information (IP, MAC, Vendor, Hostname, Ports, Status, Known Host, Notes, Timestamps).
    *   Tracks first seen, last seen online, and last update times.
*   **Web Interface:**
    *   Dynamic dashboard built with Flask, served by Gunicorn and Nginx.
    *   Displays hosts from the database in a sortable, filterable table.
    *   Client-side filtering for all columns.
    *   Resizable columns with width preferences saved in a cookie.
    *   Toggle hosts as "Known" (Yes/No) directly from the UI (updates DB).
    *   Delete host entries directly from the UI (updates DB).
    *   Edit "Hostname" and "Note" fields directly in the table (updates DB).
    *   Light/Dark theme toggle with preference saved in a cookie.
    *   Auto-refresh toggle with a configurable interval saved in a cookie.
    *   HTTP Basic Authentication via Nginx for access control.
*   **System Integration:**
    *   Runs the scanner and web application as background `systemd` services.
    *   Includes a comprehensive setup script (`setup_environment.sh`) for easier installation.

## Prerequisites

*   A Debian-based Linux system (tested on Debian 11/12). Suitable for LXC containers.
*   `sudo` privileges for installation and service management.
*   Internet connection (for downloading packages and the OUI list).
*   Basic familiarity with the Linux command line.

## Installation

1.  **Clone the Repository:**
    ```bash
    apt install git # if not already installed
    cd /opt
    git clone https://github.com/byte4geek/mainetwork-scanner.git
    cd mainetwork-scanner
    ```

2.  **Review Setup Script Variables (Optional but Recommended):**
    Before running the setup script, you might want to review and adjust variables at the top of `setup_environment.sh` and set DB password in `.env`.
    ```bash
    nano setup_environment.sh
	nano .env # (insert the password for mainet user in MariaDB at the line DB_PASSWORD=)
    ```

3.  **Update & Run the Setup Script:**
    This script automates most of the installation process: installing system packages (MariaDB, Nginx, Python tools, etc.), setting up the database and user, creating the Python virtual environment, installing Python packages, creating systemd service files, and configuring Nginx.
    ```bash
    apt update
    apt upgrade -y
    apt install sudo
    chmod +x setup_environment.sh
    sudo ./setup_environment.sh
    ```
    *   The script will ask you to **enter and confirm a password** for the MariaDB user (`mainet` by default). **Remember this password!**
    *   It will prompt you to press Enter before configuring the database.
    *   It will remind you to run `mysql_secure_installation` afterwards.

4.  **Secure MariaDB Installation:**
    This step is crucial for database security. Run the command and follow the on-screen prompts. It's generally recommended to set a root password, remove anonymous users, disallow remote root login, and remove the test database.
    ```bash
    sudo mysql_secure_installation
    ```

5.  **Create Web Access User:**
    The web interface is protected by HTTP Basic Authentication managed by Nginx. You need to create at least one user for access using the `htpasswd` command (installed by `apache2-utils` via the setup script).
    *   **For the first user:** (Replace `<choose_a_username>`)
        ```bash
        sudo htpasswd -c /etc/nginx/.htpasswd <choose_a_username>
        # You will be prompted to enter and confirm a password
        ```
    *   **To add subsequent users:** (Omit the `-c` flag)
        ```bash
        sudo htpasswd /etc/nginx/.htpasswd <another_username>
        ```
    *   **Set secure permissions:**
        ```bash
        sudo chown root:www-data /etc/nginx/.htpasswd
        sudo chmod 640 /etc/nginx/.htpasswd
        ```

6.  **Place Project Files:** Ensure the Python scripts (`network_scanner_db.py`, `webapp.py`), the wrapper (`run_scanner.sh`), and the web directories (`templates/index.html`, `static/script.js`) are correctly placed in the `INSTALLATION_DIR` (ex: `/opt/mainetwork-scanner`). Cloning the repository should handle this.

7.  **Configure Environment Variables:**
    The setup script provides an example `.env` structure. **Crucially, you must create/edit the `.env` file** in your `INSTALLATION_DIR` and set the correct values, especially the database password.
    ```bash
    nano /opt/mainetwork-scanner/.env # Or your chosen INSTALLATION_DIR/.env
    ```
    Make sure it contains at least the following, adjusting as needed:
    ```
	#.env
    # Network Settings
    NETWORK_RANGE=192.168.1.0/24 # ADJUST TO YOUR NETWORK
    OUI_FILE=oui.txt
    SCAN_WAIT=60                 # Main scan interval (seconds)

    # Port Scan Settings
    PORT_SCAN_ENABLED=true       # Enable/disable port scanning
    PORT_SCAN_RANGE="1-1024"     # Ports/ranges to scan (e.g., "22,80,443,1000-2000")
    PORT_SCAN_TIMEOUT=0.5        # Timeout per port (seconds)
    PORT_SCAN_THREADS=20         # Concurrent threads for port scan
    SCAN_PORT_INTERVAL_SECONDS=300 # How often to run port scan (seconds)

    # Custom OUI
    CUSTOM_OUI_FILE=custom_oui.txt # Optional custom OUI definitions

    # Database Credentials
    DB_HOST=localhost
    DB_PORT=3306
    DB_USER=mainet
    DB_PASSWORD=YOUR_MARIADB_PASSWORD # !!! REPLACE WITH THE PASSWORD YOU SET !!!
    DB_NAME=network_scan_db
    ```

8.  **Configure Custom OUI (Optional):**
    If you want to override vendor names for specific MAC prefixes, edit the `custom_oui.txt` file (or the name specified in `.env`) in your `PROJECT_DIR`. Use the format `AABBCC Vendor Name` (one per line, `#` for comments).

9.  **Restart Services (if needed):**
    The setup script attempts to restart the services. If you made changes to `.env` or Python files *after* running the setup script, restart the relevant service(s):
    ```bash
    sudo systemctl restart network_scanner      # Restart the scanner service
    sudo systemctl restart network_scanner_web  # Restart the web app service
    # sudo systemctl reload nginx              # Only needed if you manually edit Nginx config
    ```

## Usage

*   **Access Web UI:** Open a web browser and navigate to `http://<your-server-ip>/`. You will be prompted for the username and password you created with `htpasswd`.
*   **Scanner Service (`network_scanner`):** Runs in the background, performing ARP and (optionally) port scans at configured intervals, updating the database.
*   **Web App Service (`network_scanner_web`):** Runs the Flask/Gunicorn application that serves the web UI and API.
*   **Manage Services:** Use standard `systemctl` commands:
    *   `sudo systemctl status network_scanner network_scanner_web`
    *   `sudo systemctl stop <service_name>`
    *   `sudo systemctl start <service_name>`
    *   `sudo systemctl restart <service_name>`
    *   `sudo systemctl enable <service_name>` (Already done by setup)
    *   `sudo systemctl disable <service_name>` (To prevent starting on boot)
*   **View Logs:** Use `journalctl`:
    *   Scanner logs: `sudo journalctl -u network_scanner -f`
    *   Web app logs: `sudo journalctl -u network_scanner_web -f`

## Security Considerations

*   **HTTPS:** The HTTP Basic Authentication used sends credentials encoded but **not encrypted**. It is **highly recommended** to configure Nginx with an SSL/TLS certificate (e.g., using Let's Encrypt / Certbot) to enable HTTPS, protecting your login credentials.
*   **`mysql_secure_installation`:** Running this script after MariaDB installation is crucial to set a root password and remove insecure defaults.
*   **Firewall:** Ensure your firewall only allows necessary ports (e.g., port 80 for HTTP or 443 for HTTPS if configured). The Flask/Gunicorn port (5000) should typically *not* be exposed directly.
*   **User Permissions:** While the scanner service requires root (for Scapy), consider if the web application service (`network_scanner_web`) could run as a less privileged user (like `www-data`) if file permissions in the project directory are adjusted accordingly. This requires careful permission management.

## Troubleshooting

*   **Web UI "Loading data..." forever:** Check the browser's Developer Console (F12) for JavaScript errors. Check the Network tab to see if the `/api/hosts` request is failing. Check the web app logs (`journalctl -u network_scanner_web -f`) for backend errors.
*   **Scanner service fails:** Check the scanner logs (`journalctl -u network_scanner -f`) for Python errors (e.g., DB connection, file access, Scapy issues). Verify `.env` settings.
*   **Nginx errors / Welcome Page:** Ensure the default Nginx site is disabled (`sudo rm /etc/nginx/sites-enabled/default`) and your site config is linked correctly. Check Nginx syntax (`sudo nginx -t`) and reload (`sudo systemctl reload nginx`).
*   **Permission Denied (DB):** Ensure the MariaDB user (`mainet`) has the correct `GRANT` privileges (SELECT, INSERT, UPDATE, DELETE) on the database, as set by the setup script.
*   **Permission Denied (Files):** Ensure the user running the services has read access to necessary files (`.env`, Python scripts, OUI files) and write access to the `last_port_scan.ts` file within the `PROJECT_DIR`. The setup script attempts to set ownership, but manual adjustments might be needed depending on user context.

## License

MIT License

# Donation
Buy me a coffee

[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=VK4CSX9NVQAZU)
