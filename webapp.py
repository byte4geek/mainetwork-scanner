#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from flask import Flask, render_template, jsonify, request
import mariadb
from dotenv import load_dotenv
from datetime import datetime
import logging

# Configure base logging 
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Load variables
load_dotenv()

# --- Configuring Flask and Database ---
app = Flask(__name__)

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")

# Field permits for the Inline API/UPDATE
ALLOWED_UPDATE_FIELDS = ['hostname', 'note']

# helper function for DB connection
def get_db_connection():
    conn = None
    try:
        conn = mariadb.connect(
            host=DB_HOST, port=DB_PORT, user=DB_USER,
            password=DB_PASSWORD, database=DB_NAME, connect_timeout=5
        )
        conn.autocommit = False # Manual managing transactions
        return conn
    except mariadb.Error as e:
        logging.error(f"Errore connessione DB: {e}")
        return None

# --- Route Flask ---

@app.route('/')
def index():
    """Serving main HTML page."""
    return render_template('index.html')

@app.route('/api/hosts')
def get_hosts_data():
    """Endpoint API to provide Host data in Json format."""
    conn = get_db_connection()
    hosts_data = []
    if not conn:
        return jsonify({"error": "Impossible to connect to the database"}), 500

    cursor = None
    try:
        cursor = conn.cursor(dictionary=True)
        query = """
            SELECT
                ip_address, mac_address, vendor, hostname, ports, note, status, known_host,
                DATE_FORMAT(first_seen, '%Y-%m-%d %H:%i:%s') as first_seen,
                DATE_FORMAT(last_seen_online, '%Y-%m-%d %H:%i:%s') as last_seen_online,
                DATE_FORMAT(last_updated, '%Y-%m-%d %H:%i:%s') as last_updated
            FROM hosts
            ORDER BY INET_ATON(ip_address)
        """
        cursor.execute(query)
        results = cursor.fetchall()

        # The results for Json processes, ensuring correct types and managing Null
        for row in results:
            processed_row = {}
            for key, value in row.items():
                if key == 'known_host' and value is not None:
                    processed_row[key] = int(value) # Ensure 0 or 1
                elif value is None:
                    processed_row[key] = "" # Empty String for other NULL
                else:
                    processed_row[key] = value
            hosts_data.append(processed_row)

        return jsonify(hosts_data) # Return the list (also empty)

    except mariadb.Error as e:
        logging.error(f"Errore query DB /api/hosts: {e}")
        return jsonify({"error": f"Error query database: {e}"}), 500
    except Exception as e:
        logging.error(f"Unexpected error /api/hosts: {e}", exc_info=True)
        return jsonify({"error": f"Unexpected Error server: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# Route to update known_host
@app.route('/api/hosts/<ip_address>/known', methods=['POST'])
def update_known_host(ip_address):
    """Updes the known_host state for an IP."""
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Impossible to connect to the database"}), 500
    if not request.is_json: return jsonify({"error": "Non-valid request, Json required"}), 400

    data = request.get_json()
    new_known_state = data.get('known')

    if new_known_state not in [0, 1]: return jsonify({"error": "Value 'known' not valid (0 o 1)"}), 400

    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE hosts SET known_host = ? WHERE ip_address = ?", (new_known_state, ip_address))
        if cursor.rowcount == 0:
            conn.rollback()
            logging.warning(f"UPDATE known_host failed: IP {ip_address} not found.")
            return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit()
        logging.info(f"DB UPDATE: IP={ip_address}, known_host={new_known_state}")
        return jsonify({"success": True, "ip": ip_address, "new_state": new_known_state})
    except mariadb.Error as e:
        logging.error(f"Errore DB update known_host {ip_address}: {e}")
        conn.rollback()
        return jsonify({"error": f"Database error: {e}"}), 500
    except Exception as e:
        logging.error(f"Unexpected Error update known_host {ip_address}: {e}", exc_info=True)
        conn.rollback()
        return jsonify({"error": f"Server error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# Route to update text fields (hostname, notes)
@app.route('/api/hosts/<ip_address>/update', methods=['POST'])
def update_host_field(ip_address):
    """Updes a specific field (hostname or notes) for an IP data."""
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Unable to connect to database"}), 500
    if not request.is_json: return jsonify({"error": "Non-valid request, Json required"}), 400

    data = request.get_json()
    field_name = data.get('field')
    new_value = data.get('value')

    if field_name not in ALLOWED_UPDATE_FIELDS:
        logging.warning(f"Attempt to do with no valid field '{field_name}' for IP {ip_address}")
        return jsonify({"error": f"Field '{field_name}' not updatable"}), 400
    if new_value is None: new_value = "" # manage None as a empty string

    cursor = None
    try:
        cursor = conn.cursor()
        # Secure Query using placeholder
        update_query = f"UPDATE hosts SET `{field_name}` = ? WHERE ip_address = ?"
        cursor.execute(update_query, (new_value, ip_address))
        if cursor.rowcount == 0:
            conn.rollback()
            logging.warning(f"UPDATE {field_name} failed: IP {ip_address} not found.")
            return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit()
        logging.info(f"DB UPDATE: IP={ip_address}, {field_name}='{new_value}'")
        return jsonify({"success": True, "ip": ip_address, "field": field_name, "new_value": new_value})
    except mariadb.Error as e:
        logging.error(f"Error DB update {field_name} for {ip_address}: {e}")
        conn.rollback()
        return jsonify({"error": f"Database error: {e}"}), 500
    except Exception as e:
        logging.error(f"Unexpected Error update {field_name} for {ip_address}: {e}", exc_info=True)
        conn.rollback()
        return jsonify({"error": f"Server Error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# Route to delete host
@app.route('/api/hosts/<ip_address>', methods=['DELETE'])
def delete_host(ip_address):
    """Endpoint API to delete host from database."""
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Unable to connect to database"}), 500

    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM hosts WHERE ip_address = ?", (ip_address,))
        if cursor.rowcount == 0:
            conn.rollback()
            logging.warning(f"DELETE failed: IP {ip_address} not found.")
            return jsonify({"error": f"Host {ip_address} not found"}), 404
        conn.commit()
        logging.info(f"DB DELETE: IP={ip_address} deleted.")
        return jsonify({"success": True, "message": f"Host {ip_address} deleted."})
    except mariadb.Error as e:
        logging.error(f"Error DB delete {ip_address}: {e}")
        conn.rollback()
        return jsonify({"error": f"Database error: {e}"}), 500
    except Exception as e:
        logging.error(f"Unexpected Error delete {ip_address}: {e}", exc_info=True)
        conn.rollback()
        return jsonify({"error": f"Server Error: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# Gunicorn is looking for 'app' by default, no app.run is needed()
