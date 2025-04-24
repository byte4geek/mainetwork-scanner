#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# === Imports ===
import os
import sys
import logging
from datetime import datetime, timezone
from dotenv import load_dotenv
from flask import Flask, render_template, jsonify, request, flash, redirect, url_for
import mariadb
from collections import defaultdict

# === Basic Logging Setup ===
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# === Configuration ===
load_dotenv()
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

# Flask App Initialization
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "change_this_in_production") # Use a strong secret key

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

@app.route('/history')
def history_page():
    """Serves the HTML page for the host history view."""
    return render_template('history.html')

@app.route('/custom_oui')
def custom_oui_editor():
    """Serves the HTML page for editing the custom OUI file."""
    file_content = ""
    error_message = None
    try:
        if os.path.exists(CUSTOM_OUI_FULL_PATH):
            with open(CUSTOM_OUI_FULL_PATH, 'r', encoding='utf-8') as f:
                file_content = f.read()
        else:
            flash(f"Info: Custom OUI file ({CUSTOM_OUI_FILE}) not found.", "info")
    except IOError as e:
        logging.error(f"Error reading custom OUI file '{CUSTOM_OUI_FULL_PATH}': {e}")
        error_message = f"Error reading file: {e}. Check permissions."
        flash(error_message, "error")
    except Exception as e:
        logging.error(f"Unexpected error reading custom OUI file: {e}", exc_info=True)
        error_message = "An unexpected error occurred while reading the file."
        flash(error_message, "error")
    return render_template('custom_oui_editor.html',
                           file_content=file_content,
                           filename=CUSTOM_OUI_FILE,
                           error_message=error_message)


# === API Routes ===

@app.route('/api/hosts')
def get_hosts_data():
    """API: Get current data for all hosts."""
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
    """API: Update 'known_host' status (0 or 1)."""
    conn = get_db_connection()
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
    """API: Update 'hostname' or 'note' field."""
    conn = get_db_connection()
    if not conn: return jsonify({"error": "DB connection failed"}), 500
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); field_name = data.get('field'); new_value = data.get('value')
    if field_name not in ALLOWED_UPDATE_FIELDS: logging.warning(f"Invalid field update '{field_name}' IP {ip_address}"); return jsonify({"error": f"Field '{field_name}' not updatable"}), 400
    if new_value is None: new_value = ""
    cursor = None
    try:
        cursor = conn.cursor(); update_query = f"UPDATE hosts SET `{field_name}` = ? WHERE ip_address = ?"; cursor.execute(update_query, (new_value, ip_address));
        if cursor.rowcount == 0: conn.rollback(); logging.warning(f"UPDATE {field_name} failed: IP {ip_address} not found."); return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit(); logging.info(f"DB UPDATE: IP={ip_address}, {field_name} updated."); return jsonify({"success": True, "ip": ip_address, "field": field_name, "new_value": new_value})
    except mariadb.Error as e: logging.error(f"DB Error update {field_name} {ip_address}: {e}"); conn.rollback(); return jsonify({"error": f"DB error: {e}"}), 500
    except Exception as e: logging.error(f"Error update {field_name} {ip_address}: {e}", exc_info=True); conn.rollback(); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route('/api/hosts/<ip_address>', methods=['DELETE'])
def delete_host(ip_address):
    """API: Delete a host entry from 'hosts' table."""
    conn = get_db_connection()
    if not conn: return jsonify({"error": "DB connection failed"}), 500
    cursor = None
    try:
        cursor = conn.cursor(); cursor.execute("DELETE FROM hosts WHERE ip_address = ?", (ip_address,));
        if cursor.rowcount == 0: conn.rollback(); logging.warning(f"DELETE failed: IP {ip_address} not found."); return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit(); logging.info(f"DB DELETE: IP={ip_address} deleted from hosts table."); return jsonify({"success": True, "message": f"Host {ip_address} deleted."})
    except mariadb.Error as e: logging.error(f"DB Error delete {ip_address}: {e}"); conn.rollback(); return jsonify({"error": f"DB error: {e}"}), 500
    except Exception as e: logging.error(f"Error delete {ip_address}: {e}", exc_info=True); conn.rollback(); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route('/api/history')
def get_history_data():
    """
    API: Get ALL history events, grouped by host, including hostname.
    Date filtering will be done client-side in this version.
    """
    conn = get_db_connection()
    # Use defaultdict to easily append events
    grouped_history = defaultdict(lambda: {"hostname": "", "events": []})
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = conn.cursor(dictionary=True)

        # 1. Get all hosts and their current hostnames
        hosts_query = "SELECT ip_address, hostname FROM hosts ORDER BY INET_ATON(ip_address)"
        cursor.execute(hosts_query)
        hosts_info = cursor.fetchall()
        # Initialize result dict with all known hosts
        for host in hosts_info:
            grouped_history[host['ip_address']]["hostname"] = host['hostname'] or ''

        # 2. Get all history events, ordered correctly
        history_query = """
            SELECT ip_address, status, event_time
            FROM host_history
            ORDER BY ip_address, event_time ASC
        """
        cursor.execute(history_query)
        history_events = cursor.fetchall()

        # 3. Add events to the corresponding host entry
        for event in history_events:
            ip = event['ip_address']
            ts_str = None
            if event['event_time']:
                # Assume DB stores UTC, make TZ aware, format ISO UTC
                aware_utc_dt = event['event_time'].replace(tzinfo=timezone.utc)
                ts_str = aware_utc_dt.isoformat(timespec='seconds').replace('+00:00', 'Z')

            # Append event if the host exists in our initial list
            # (Handles cases where history might exist for a deleted host)
            if ip in grouped_history:
                 grouped_history[ip]["events"].append({
                    "status": int(event['status']),
                    "event_time": ts_str
                 })

        # Convert defaultdict to a regular dict for JSONify
        return jsonify(dict(grouped_history))

    except mariadb.Error as e:
        logging.error(f"DB query error /api/history: {e}")
        return jsonify({"error": f"Database query error: {e}"}), 500
    except Exception as e:
        logging.error(f"Unexpected error /api/history: {e}", exc_info=True)
        return jsonify({"error": f"Unexpected server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route('/api/history/<ip_address>', methods=['DELETE'])
def delete_host_history(ip_address):
    """API: Delete all history events for a specific host."""
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = None
    try:
        cursor = conn.cursor(); delete_query = "DELETE FROM host_history WHERE ip_address = ?"; cursor.execute(delete_query, (ip_address,)); deleted_count = cursor.rowcount; conn.commit(); logging.info(f"DB HISTORY DELETE: Cleared {deleted_count} records for IP={ip_address}."); return jsonify({"success": True, "message": f"History for {ip_address} cleared ({deleted_count} records)."}), 200
    except mariadb.Error as e: logging.error(f"DB Error deleting history for {ip_address}: {e}"); conn.rollback(); return jsonify({"error": f"DB error: {e}"}), 500
    except Exception as e: logging.error(f"Error deleting history for {ip_address}: {e}", exc_info=True); conn.rollback(); return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# --- NEW: API Route to Clear All History ---
@app.route('/api/history/all', methods=['DELETE'])
def delete_all_history():
    """API endpoint to delete ALL records from the host_history table."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = conn.cursor()
        # Use TRUNCATE for efficiency if possible and acceptable, otherwise DELETE
        # TRUNCATE is faster but cannot be rolled back easily and resets AUTO_INCREMENT
        # delete_query = "TRUNCATE TABLE host_history" # Option 1: Faster, resets auto_increment
        delete_query = "DELETE FROM host_history" # Option 2: Slower, allows rollback
        cursor.execute(delete_query)
        deleted_count = cursor.rowcount # DELETE returns count, TRUNCATE might return 0
        conn.commit()
        logging.warning(f"DB HISTORY DELETE: Cleared ALL history records ({deleted_count} estimated).") # Log as warning due to severity
        return jsonify({"success": True, "message": f"All host history cleared ({deleted_count} records affected)."}), 200

    except mariadb.Error as e:
        logging.error(f"DB Error clearing host_history: {e}")
        conn.rollback()
        return jsonify({"error": f"Database error during history clear: {e}"}), 500
    except Exception as e:
        logging.error(f"Unexpected error clearing host_history: {e}", exc_info=True)
        conn.rollback()
        return jsonify({"error": f"Unexpected server error during history clear: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()
# --- END NEW ROUTE ---

@app.route('/api/custom_oui/save', methods=['POST'])
def save_custom_oui():
    """API: Save content to the custom OUI file."""
    if not request.is_json: return jsonify({"error": "JSON required"}), 400
    data = request.get_json(); new_content = data.get('content')
    if new_content is None: return jsonify({"error": "'content' missing"}), 400
    try:
        with open(CUSTOM_OUI_FULL_PATH, 'w', encoding='utf-8') as f: f.write(new_content)
        logging.info(f"Custom OUI file '{CUSTOM_OUI_FILE}' saved."); return jsonify({"success": True, "message": f"File '{CUSTOM_OUI_FILE}' saved."})
    except Exception as e: logging.error(f"Error writing custom OUI: {e}"); return jsonify({"error": f"Error saving file: {e}. Check permissions."}), 500
