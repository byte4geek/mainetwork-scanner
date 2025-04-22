#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# === Imports ===
import os
import sys
import logging
from datetime import datetime, timezone # Added timezone
from dotenv import load_dotenv
from flask import Flask, render_template, jsonify, request, flash, redirect, url_for # Added flash, redirect, url_for
import mariadb

# === Basic Logging Setup ===
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# === Configuration ===
load_dotenv()
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__)) # Script directory

# Flask App Initialization
app = Flask(__name__)
# Required for flash messages
app.secret_key = os.getenv("FLASK_SECRET_KEY", os.urandom(24)) # Use env var or random bytes

# Database Credentials
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")

# Custom OUI File Path
CUSTOM_OUI_FILE = os.getenv("CUSTOM_OUI_FILE", "custom_oui.txt")
CUSTOM_OUI_FULL_PATH = os.path.join(PROJECT_DIR, CUSTOM_OUI_FILE)

# Allowed fields for inline update via API
ALLOWED_UPDATE_FIELDS = ['hostname', 'note']

# === Database Connection Helper ===
def get_db_connection():
    """Establishes and returns a MariaDB connection object or None on failure."""
    conn = None
    if not all([DB_USER, DB_PASSWORD, DB_NAME]):
        logging.error("Database credentials missing in .env file.")
        return None
    try:
        conn = mariadb.connect(
            host=DB_HOST, port=DB_PORT, user=DB_USER,
            password=DB_PASSWORD, database=DB_NAME, connect_timeout=10
        )
        conn.autocommit = False
        return conn
    except mariadb.Error as e:
        logging.error(f"Database connection failed: {e}")
        return None

# === Flask Routes ===

@app.route('/')
def index():
    """Serves the main dashboard HTML page."""
    return render_template('index.html')

@app.route('/api/hosts')
def get_hosts_data():
    """API endpoint to get all host data, assumes DB stores UTC, returns ISO UTC strings."""
    # ... (This function remains unchanged from the previous complete version) ...
    conn = get_db_connection()
    hosts_data = []
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = None
    try:
        cursor = conn.cursor(dictionary=True)
        query = """ SELECT ip_address, mac_address, vendor, hostname, ports, note, status, known_host, first_seen, last_seen_online, last_updated FROM hosts ORDER BY INET_ATON(ip_address) """
        cursor.execute(query)
        results = cursor.fetchall()
        for row in results:
            processed_row = {}
            for key, value in row.items():
                if isinstance(value, datetime):
                    if value: aware_utc_dt = value.replace(tzinfo=timezone.utc); processed_row[key] = aware_utc_dt.isoformat(timespec='seconds').replace('+00:00', 'Z')
                    else: processed_row[key] = ""
                elif key == 'known_host' and value is not None: processed_row[key] = int(value)
                elif value is None: processed_row[key] = ""
                else: processed_row[key] = value
            hosts_data.append(processed_row)
        return jsonify(hosts_data)
    except mariadb.Error as e: logging.error(f"DB query error /api/hosts: {e}"); return jsonify({"error": f"Query error: {e}"}), 500
    except Exception as e: logging.error(f"Unexpected error /api/hosts: {e}", exc_info=True); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route('/api/hosts/<ip_address>/known', methods=['POST'])
def update_known_host(ip_address):
    """API endpoint to update the 'known_host' status for a specific IP."""
    # ... (This function remains unchanged from the previous complete version) ...
    conn = get_db_connection();
    if not conn: return jsonify({"error": "DB connection failed"}), 500
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); new_known_state = data.get('known')
    if new_known_state not in [0, 1]: return jsonify({"error": "'known' must be 0 or 1"}), 400
    cursor = None
    try:
        cursor = conn.cursor(); cursor.execute("UPDATE hosts SET known_host = ? WHERE ip_address = ?", (new_known_state, ip_address));
        if cursor.rowcount == 0: conn.rollback(); logging.warning(f"UPDATE known IP {ip_address} not found."); return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit(); logging.info(f"DB UPDATE: IP={ip_address}, known_host={new_known_state}"); return jsonify({"success": True, "ip": ip_address, "new_state": new_known_state})
    except mariadb.Error as e: logging.error(f"DB Error update known {ip_address}: {e}"); conn.rollback(); return jsonify({"error": f"DB error: {e}"}), 500
    except Exception as e: logging.error(f"Error update known {ip_address}: {e}", exc_info=True); conn.rollback(); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route('/api/hosts/<ip_address>/update', methods=['POST'])
def update_host_field(ip_address):
    """API endpoint to update specific text fields ('hostname', 'note') for a host."""
    # ... (This function remains unchanged from the previous complete version) ...
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    if not request.is_json: return jsonify({"error": "Invalid request: JSON required"}), 400
    data = request.get_json(); field_name = data.get('field'); new_value = data.get('value')
    if field_name not in ALLOWED_UPDATE_FIELDS: logging.warning(f"Invalid field update attempt '{field_name}' for IP {ip_address}"); return jsonify({"error": f"Field '{field_name}' cannot be updated"}), 400
    if new_value is None: new_value = ""
    cursor = None
    try:
        cursor = conn.cursor(); update_query = f"UPDATE hosts SET `{field_name}` = ? WHERE ip_address = ?"; cursor.execute(update_query, (new_value, ip_address));
        if cursor.rowcount == 0: conn.rollback(); logging.warning(f"UPDATE {field_name} failed: IP {ip_address} not found."); return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit(); logging.info(f"DB UPDATE: IP={ip_address}, {field_name} updated."); return jsonify({"success": True, "ip": ip_address, "field": field_name, "new_value": new_value})
    except mariadb.Error as e: logging.error(f"DB Error update {field_name} for {ip_address}: {e}"); conn.rollback(); return jsonify({"error": f"Database error: {e}"}), 500
    except Exception as e: logging.error(f"Error update {field_name} for {ip_address}: {e}", exc_info=True); conn.rollback(); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route('/api/hosts/<ip_address>', methods=['DELETE'])
def delete_host(ip_address):
    """API endpoint to delete a host entry from the database."""
    # ... (This function remains unchanged from the previous complete version) ...
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = None
    try:
        cursor = conn.cursor(); cursor.execute("DELETE FROM hosts WHERE ip_address = ?", (ip_address,));
        if cursor.rowcount == 0: conn.rollback(); logging.warning(f"DELETE failed: IP {ip_address} not found."); return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit(); logging.info(f"DB DELETE: IP={ip_address} deleted."); return jsonify({"success": True, "message": f"Host {ip_address} deleted."})
    except mariadb.Error as e: logging.error(f"DB Error delete {ip_address}: {e}"); conn.rollback(); return jsonify({"error": f"Database error: {e}"}), 500
    except Exception as e: logging.error(f"Error delete {ip_address}: {e}", exc_info=True); conn.rollback(); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# === NEW ROUTES FOR CUSTOM OUI EDITOR ===

@app.route('/custom_oui')
def custom_oui_editor():
    """Serves the HTML page for editing the custom OUI file."""
    file_content = ""
    error_message = None
    try:
        # Read the current content of the custom OUI file
        if os.path.exists(CUSTOM_OUI_FULL_PATH):
            with open(CUSTOM_OUI_FULL_PATH, 'r', encoding='utf-8') as f:
                file_content = f.read()
        else:
            # File doesn't exist, which is okay, but maybe inform the user
            flash(f"Info: Custom OUI file ({CUSTOM_OUI_FILE}) does not exist yet. Saving will create it.", "info")
    except IOError as e:
        logging.error(f"Error reading custom OUI file '{CUSTOM_OUI_FULL_PATH}': {e}")
        error_message = f"Error reading file: {e}"
        # Use flash message to show error on the rendered page
        flash(error_message, "error")
    except Exception as e:
        logging.error(f"Unexpected error reading custom OUI file: {e}", exc_info=True)
        error_message = "An unexpected error occurred while reading the file."
        flash(error_message, "error")

    return render_template('custom_oui_editor.html',
                           file_content=file_content,
                           filename=CUSTOM_OUI_FILE,
                           error_message=error_message) # Pass error message to template if needed

@app.route('/api/custom_oui/save', methods=['POST'])
def save_custom_oui():
    """API endpoint to save content to the custom OUI file."""
    if not request.is_json:
        return jsonify({"error": "Invalid request: JSON required"}), 400

    data = request.get_json()
    new_content = data.get('content')

    if new_content is None: # Allow empty content, but not missing key
        return jsonify({"error": "Invalid request: 'content' field missing"}), 400

    try:
        # Write the received content, overwriting the file
        with open(CUSTOM_OUI_FULL_PATH, 'w', encoding='utf-8') as f:
            f.write(new_content)
        logging.info(f"Custom OUI file '{CUSTOM_OUI_FILE}' saved successfully.")
        return jsonify({"success": True, "message": f"File '{CUSTOM_OUI_FILE}' saved successfully."})
    except IOError as e:
        logging.error(f"Error writing custom OUI file '{CUSTOM_OUI_FULL_PATH}': {e}")
        return jsonify({"error": f"Error saving file: {e}. Check permissions."}), 500
    except Exception as e:
        logging.error(f"Unexpected error writing custom OUI file: {e}", exc_info=True)
        return jsonify({"error": f"Unexpected server error during save: {e}"}), 500

# Gunicorn looks for 'app' by default