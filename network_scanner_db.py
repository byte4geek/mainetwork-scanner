#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# === Imports ===
import os
import sys
import socket
from datetime import datetime, timedelta
from ipaddress import ip_network, ip_address
import logging
import requests
from dotenv import load_dotenv
from collections import OrderedDict
import subprocess
import shutil
import traceback
import concurrent.futures
import time

# --- Scapy Import ---
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)
logging.getLogger("scapy.loading").setLevel(logging.ERROR)
try: from scapy.all import Ether, ARP, srp, conf
except Exception as e: print(f"ERROR importing Scapy: {e}", file=sys.stderr); sys.exit(1)

# --- MariaDB Connector Import ---
try: import mariadb
except ImportError: print("ERROR: 'mariadb' library not installed. Run: pip install mariadb", file=sys.stderr); sys.exit(1)

# === Global Configuration ===
load_dotenv()
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
NETWORK_RANGE = os.getenv("NETWORK_RANGE")
OUI_FILE = os.getenv("OUI_FILE", "oui.txt")
OUI_URL = "https://standards-oui.ieee.org/oui/oui.txt"
CUSTOM_OUI_FILE = os.getenv("CUSTOM_OUI_FILE", "custom_oui.txt")
SCAN_TIMEOUT = 2
raw_port_scan_enabled = os.getenv("PORT_SCAN_ENABLED", "false").lower()
PORT_SCAN_ENABLED = raw_port_scan_enabled in ['true', '1', 'yes', 'y']
PORT_SCAN_RANGE_STR = os.getenv("PORT_SCAN_RANGE", "1-1024")
try: PORT_SCAN_TIMEOUT = float(os.getenv("PORT_SCAN_TIMEOUT", "0.5"))
except ValueError: print("WARNING: Invalid PORT_SCAN_TIMEOUT, using 0.5s", file=sys.stderr); PORT_SCAN_TIMEOUT = 0.5
try: PORT_SCAN_THREADS = int(os.getenv("PORT_SCAN_THREADS", "20")); assert PORT_SCAN_THREADS > 0
except (ValueError, AssertionError): print("WARNING: Invalid PORT_SCAN_THREADS, using 20", file=sys.stderr); PORT_SCAN_THREADS = 20
try: SCAN_PORT_INTERVAL_SECONDS = int(os.getenv("SCAN_PORT_INTERVAL_SECONDS", "300")); assert SCAN_PORT_INTERVAL_SECONDS > 0
except (ValueError, AssertionError): print("WARNING: Invalid SCAN_PORT_INTERVAL_SECONDS, using 300s", file=sys.stderr); SCAN_PORT_INTERVAL_SECONDS = 300
PORT_SCAN_STATE_FILE = os.path.join(PROJECT_DIR, "last_port_scan.ts")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")
conf.verb = 0; oui_dict = {}; custom_oui_dict = {}; ports_to_scan_set = set()

# === Helper Functions ===
def check_root():
    if os.geteuid() != 0: print("ERROR: Root privileges required.", file=sys.stderr); sys.exit(1)

def connect_db():
    conn = None
    if not all([DB_USER, DB_PASSWORD, DB_NAME]): print("ERROR: DB credentials missing.", file=sys.stderr); return None
    try: conn = mariadb.connect( host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, database=DB_NAME, connect_timeout=10); conn.autocommit = False; return conn
    except mariadb.Error as e: print(f"ERROR: DB connection failed: {e}", file=sys.stderr); return None

# Function download_oui_file (Corrected)
def download_oui_file(url, filename):
    if not os.path.exists(filename):
        print(f"Standard OUI file '{filename}' not found. Attempting download with wget...")
        wget_path = shutil.which('wget');
        if not wget_path: print("\nERROR: 'wget' command not found.", file=sys.stderr); return False
        command = [wget_path, '--tries=3', '--timeout=30', '-nv', url, '-O', filename]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=45)
            if result.returncode == 0 and os.path.exists(filename) and os.path.getsize(filename) > 0:
                print(f"Standard OUI file downloaded successfully: {filename}"); return True
            else:
                print(f"ERROR: wget failed (code {result.returncode}). Stderr: {result.stderr or '[None]'}", file=sys.stderr)
                if os.path.exists(filename):
                    try: os.remove(filename)
                    except OSError: pass
                return False
        except Exception as e:
            print(f"ERROR: Unexpected error during wget execution: {e}", file=sys.stderr)
            if os.path.exists(filename):
                 try: os.remove(filename)
                 except OSError: pass
            return False
    else: return True

def parse_oui_file(filename):
    global oui_dict; oui_dict = {}; print(f"Loading standard OUI from '{filename}'...")
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            for line in f:
                if '(hex)' in line:
                    parts = line.split('(hex)', 1);
                    if len(parts) == 2: mac_prefix = parts[0].strip().replace('-','').upper(); vendor = parts[1].strip();
                    if len(mac_prefix) == 6: oui_dict[mac_prefix] = vendor
    except FileNotFoundError: print(f"ERROR: Standard OUI file '{filename}' not found.", file=sys.stderr); return False
    except Exception as e: print(f"ERROR parsing standard OUI: {e}", file=sys.stderr); return False
    if not oui_dict: print("WARNING: No standard OUI data loaded.", file=sys.stderr);
    print(f"Loaded {len(oui_dict)} standard OUI records.")
    return True

# Parse custom OUI file (PREFIX based - Corrected)
def parse_custom_oui_file(filename):
    global custom_oui_dict; custom_oui_dict = {}; full_path = os.path.join(PROJECT_DIR, filename)
    if not os.path.exists(full_path): print(f"INFO: Custom OUI file '{filename}' not found."); return True
    print(f"Loading custom OUI overrides from '{filename}'..."); loaded_count = 0
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line or line.startswith('#'): continue # Correct indent
                parts = line.split(None, 1);
                if len(parts) == 2:
                    prefix_str = parts[0].strip(); vendor_name = parts[1].strip()
                    normalized_prefix = prefix_str.replace(':','').replace('-','').upper()
                    if len(normalized_prefix) == 6:
                        try: int(normalized_prefix, 16); custom_oui_dict[normalized_prefix] = vendor_name; loaded_count += 1
                        except ValueError: print(f"WARNING: Invalid hex prefix '{prefix_str}' L{line_num} in '{filename}'.", file=sys.stderr)
                    else:
                        if normalized_prefix.endswith('(HEX)'):
                            normalized_prefix = normalized_prefix[:-5].strip().replace('-','').upper()
                            if len(normalized_prefix) == 6:
                                 try: int(normalized_prefix, 16); custom_oui_dict[normalized_prefix] = vendor_name; loaded_count += 1
                                 except ValueError: print(f"WARNING: Invalid hex prefix '{prefix_str}' L{line_num} in '{filename}'.", file=sys.stderr)
                            else: print(f"WARNING: Invalid prefix len '{prefix_str}' L{line_num} in '{filename}'.", file=sys.stderr)
                        else: print(f"WARNING: Invalid prefix len '{prefix_str}' L{line_num} in '{filename}'.", file=sys.stderr)
                else: print(f"WARNING: Invalid format L{line_num} in '{filename}'.", file=sys.stderr)
    except IOError as e: print(f"ERROR: Cannot read custom OUI '{filename}': {e}", file=sys.stderr); return False
    except Exception as e: print(f"ERROR parsing custom OUI '{filename}': {e}", file=sys.stderr); return False
    print(f"Loaded {loaded_count} custom OUI prefix overrides.")
    return True

# Vendor Lookup Function (Prefix Priority - Corrected for UnboundLocalError)
def get_vendor(mac_address):
    """Gets vendor, prioritizing custom OUI prefix, then standard."""
    # 1. Check for empty/None input first
    if not mac_address:
        return "N/A"

    # 2. Normalize the input MAC address
    normalized_mac = mac_address.replace(':','').replace('-','').upper()

    # 3. Check length *after* normalization
    if len(normalized_mac) < 6:
        return "Unknown (Short MAC)" # Cannot determine OUI from short MAC

    # 4. Get the OUI prefix
    oui_prefix = normalized_mac[:6]

    # 5. Check custom dictionary
    if oui_prefix in custom_oui_dict:
        return custom_oui_dict[oui_prefix] + " (Custom)"

    # 6. Check standard dictionary
    if oui_prefix in oui_dict:
        return oui_dict[oui_prefix]

    # 7. Fallback
    return "Unknown"

# --- Port Scan Functions ---
# Function parse_port_range (Syntax Corrected Previously)
def parse_port_range(range_str):
    ports = set();
    if not range_str: print("WARNING: PORT_SCAN_RANGE is empty.", file=sys.stderr); return ports
    try:
        for part in range_str.split(','):
            part = part.strip()
            if not part: continue # Correctly indented
            if '-' in part:
                start, end = map(int, part.split('-', 1))
                if start <= end and start > 0 and end < 65536: ports.update(range(start, end + 1))
                else: print(f"WARNING: Invalid port range ignored: {part}", file=sys.stderr)
            else:
                 port_num = int(part)
                 if 1 <= port_num <= 65535: ports.add(port_num)
                 else: print(f"WARNING: Invalid port number ignored: {part}", file=sys.stderr)
    except ValueError: print(f"ERROR: Invalid PORT_SCAN_RANGE format: '{range_str}'.", file=sys.stderr); return set()
    return ports

def scan_port(ip, port, timeout):
    sock = None
    try: sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM); sock.settimeout(timeout); return sock.connect_ex((ip, port)) == 0
    except socket.error: return False
    finally:
        if sock: sock.close()

def scan_ports_threaded(ip, ports_to_scan, timeout, max_threads):
    open_ports = []; actual_threads = min(max_threads, len(ports_to_scan) if ports_to_scan else 1);
    if actual_threads <= 0 : actual_threads = 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=actual_threads) as executor:
        future_to_port = {executor.submit(scan_port, ip, port, timeout): port for port in ports_to_scan}
        for future in concurrent.futures.as_completed(future_to_port):
            port = future_to_port[future];
            try:
                if future.result(): open_ports.append(port)
            except Exception as exc: print(f'WARNING: Exception scanning {ip}:{port} - {exc}', file=sys.stderr)
    if open_ports: open_ports.sort(); return ",".join(map(str, open_ports))
    else: return ""

# --- ARP Network Scan Function ---
def scan_network(network_cidr):
    active_hosts = {}; print(f"\nStarting ARP scan on {network_cidr}...")
    try:
        network_obj = ip_network(network_cidr, strict=False); packet = Ether(dst="ff:ff:ff:ff:ff:ff")/ARP(pdst=str(network_cidr))
        answered, _ = srp(packet, timeout=SCAN_TIMEOUT, retry=1, verbose=False); print(f"ARP scan completed. {len(answered)} hosts responded.")
        for _, received in answered:
            ip = received.psrc; mac = received.hwsrc
            try:
                if ip_address(ip) in network_obj: active_hosts[ip] = {'mac': mac}
            except ValueError: print(f"Debug: Ignoring invalid IP received {ip}")
    except ValueError: print(f"ERROR: Invalid network range '{network_cidr}'", file=sys.stderr); return None
    except PermissionError: print("ERROR: Root permissions needed.", file=sys.stderr); sys.exit(1)
    except NameError as ne: print(f"ERROR: NameError during ARP scan: {ne}. Check imports.", file=sys.stderr); return None
    except Exception as e: print(f"ERROR during ARP scan: {e}", file=sys.stderr); return None
    return active_hosts

# --- Database State Functions ---
def load_state_from_db(conn):
    last_db_state = {}; cursor = None
    if not conn: return last_db_state
    print("Loading previous state from DB...");
    try:
        cursor = conn.cursor(dictionary=True)
        query = "SELECT ip_address, mac_address, vendor, hostname, ports, note, status, known_host, last_seen_online FROM hosts"
        cursor.execute(query); results = cursor.fetchall()
        for row in results:
            ip = row['ip_address']; last_db_state[ip] = row
            if last_db_state[ip]['known_host'] is not None:
                try: last_db_state[ip]['known_host'] = int(last_db_state[ip]['known_host'])
                except (ValueError, TypeError): last_db_state[ip]['known_host'] = 0
            else: last_db_state[ip]['known_host'] = 0
        print(f"Loaded state for {len(last_db_state)} hosts.")
    except mariadb.Error as e: print(f"ERROR reading DB state: {e}", file=sys.stderr)
    except Exception as e: print(f"ERROR loading DB state: {e}", file=sys.stderr)
    finally:
        if cursor: cursor.close()
    return last_db_state

# Function update_db_and_get_status (Includes KeyError fix)
def update_db_and_get_status(conn, current_scan_results, last_db_state, ports_to_scan, perform_port_scan):
    final_report_state = OrderedDict(); updated_count, inserted_count, offline_count, port_scan_count = 0, 0, 0, 0
    if not conn: print("ERROR: Invalid DB connection for update.", file=sys.stderr); return final_report_state
    cursor = None; now_ts = datetime.now()
    try:
        cursor = conn.cursor(); online_ips = set(current_scan_results.keys())
        # Process ONLINE
        for ip in online_ips:
            data = current_scan_results[ip]; mac = data['mac']; vendor = get_vendor(mac); ports_result_str = None # <-- Call get_vendor here
            if PORT_SCAN_ENABLED and perform_port_scan and ports_to_scan:
                print(f"INFO: Starting port scan for {ip} ({len(ports_to_scan)} ports)..."); ports_result_str = scan_ports_threaded(ip, ports_to_scan, PORT_SCAN_TIMEOUT, PORT_SCAN_THREADS)
                if ports_result_str is not None: port_scan_count += 1; print(f"INFO: Port scan {ip} -> '{ports_result_str or 'None Open'}'")
            last_state = last_db_state.get(ip)
            current_ports = ports_result_str if ports_result_str is not None else (last_state.get('ports', '') if last_state else '')
            final_report_state[ip] = {'mac': mac, 'vendor': vendor, 'status': 'ONLINE', 'ports': current_ports or "", 'hostname': last_state.get('hostname', '') if last_state else '', 'note': last_state.get('note', '') if last_state else '', 'known_host': last_state.get('known_host', 0) if last_state else 0, 'timestamp': now_ts}
            if last_state: # UPDATE
                last_mac=last_state.get('mac','') or ''; last_vendor=last_state.get('vendor','') or ''; last_status=last_state.get('status','OFFLINE'); last_ports=last_state.get('ports','') or ''
                current_ports_compare = ports_result_str if ports_result_str is not None else last_ports
                port_scan_rel = PORT_SCAN_ENABLED and perform_port_scan and ports_to_scan and ports_result_str is not None
                ports_differ = (port_scan_rel and (current_ports_compare or "") != (last_ports or ""))
                needs_update = (last_status == 'OFFLINE' or last_mac != mac or last_vendor != vendor or ports_differ)
                if needs_update:
                    set_clauses = ["mac_address = ?", "vendor = ?", "status = 'ONLINE'", "last_seen_online = NOW()"]; params = [mac, vendor]
                    if port_scan_rel: set_clauses.append("ports = ?"); params.append(ports_result_str if ports_result_str else None);
                    # if last_status == 'ONLINE': print(f"DB UPDATE: {ip} (Data/Ports Changed)")
                    params.append(ip); update_query = f"UPDATE hosts SET {', '.join(set_clauses)} WHERE ip_address = ?"; cursor.execute(update_query, tuple(params)); updated_count += 1
            else: # INSERT
                current_ports_insert = ports_result_str if (PORT_SCAN_ENABLED and perform_port_scan and ports_result_str is not None) else None
                print(f"DB INSERT: {ip} (MAC: {mac}, Ports: '{current_ports_insert or 'NULL'}')")
                insert_query = "INSERT INTO hosts (ip_address, mac_address, vendor, ports, status, first_seen, last_seen_online) VALUES (?, ?, ?, ?, 'ONLINE', NOW(), NOW())"; cursor.execute(insert_query, (ip, mac, vendor, current_ports_insert)); inserted_count += 1
        # Process OFFLINE
        offline_ips = set(last_db_state.keys()) - online_ips
        for ip in offline_ips:
            last_data = last_db_state[ip]
            if last_data.get('status') == 'ONLINE': print(f"DB UPDATE: {ip} (Status: OFFLINE)"); cursor.execute("UPDATE hosts SET status = 'OFFLINE' WHERE ip_address = ?", (ip,)); offline_count += 1; final_report_state[ip] = {**last_data, 'status': 'OFFLINE', 'timestamp': now_ts}
        # Commit
        conn.commit(); print(f"\nDB update complete: {inserted_count} INSERTED, {updated_count} UPDATED (Online), {offline_count} marked OFFLINE.")
        if port_scan_count > 0: print(f"Port scans performed for {port_scan_count} online hosts.")
    except mariadb.Error as e: print(f"ERROR during DB update: {e}", file=sys.stderr); print("Rolling back...", file=sys.stderr); conn.rollback(); final_report_state = {ip: {**d, 'status': d['status'] + " (DB Fail)"} for ip, d in final_report_state.items()}
    except Exception as e: print(f"ERROR during DB update: {e}", file=sys.stderr); traceback.print_exc(); conn.rollback(); final_report_state = {ip: {**d, 'status': d['status'] + " (DB Fail)"} for ip, d in final_report_state.items()}
    finally:
        if cursor: cursor.close()
    return final_report_state

# Function print_results (Corrected for NoneType)
def print_results(final_state):
    print("\n--- Network Scan Results (Current Status) ---")
    if not final_state: print("No hosts found or state to report."); return
    hostname_width=20; ports_width=30; note_width=20; known_width=5; vendor_width=25; total_width = 18+1+20+1+vendor_width+1+hostname_width+1+ports_width+1+note_width+1+known_width+1+15
    print(f"{'IP Address':<18} {'MAC Address':<20} {'Vendor':<{vendor_width}} {'Hostname':<{hostname_width}} {'Ports':<{ports_width}} {'Note':<{note_width}} {'Known':<{known_width}} {'Status':<10}")
    print("-" * total_width)
    for ip in final_state:
        data=final_state[ip]; mac = data.get('mac') or 'N/A'; vendor = data.get('vendor') or 'N/A'; hostname = data.get('hostname') or ''; ports = data.get('ports') or ''; note = data.get('note') or ''; known = 'Y' if data.get('known_host', 0) == 1 else 'N'; status = data.get('status') or 'N/A'
        print(f"{ip:<18} {mac:<20} {vendor:<{vendor_width}} {hostname:<{hostname_width}} {ports:<{ports_width}} {note:<{note_width}} {known:<{known_width}} {status:<10}")
    print("-" * total_width); print(f"Total hosts monitored: {len(final_state)}")

# === Main Execution Block ===
if __name__ == "__main__":
    print("Starting Network Scanner DB Script..."); start_time = datetime.now()
    check_root()
    if not NETWORK_RANGE: print("ERROR: NETWORK_RANGE not defined.", file=sys.stderr); sys.exit(1)
    if not all([DB_USER, DB_PASSWORD, DB_NAME]): print("ERROR: DB credentials not defined.", file=sys.stderr); sys.exit(1)
    print(f"Config: Net={NETWORK_RANGE}, PortScan={PORT_SCAN_ENABLED}, Range='{PORT_SCAN_RANGE_STR}', Timeout={PORT_SCAN_TIMEOUT}s, Threads={PORT_SCAN_THREADS}, Interval={SCAN_PORT_INTERVAL_SECONDS}s")

    # Port Scan Interval Logic
    do_port_scan_this_run = False
    if PORT_SCAN_ENABLED:
        ports_to_scan_set = parse_port_range(PORT_SCAN_RANGE_STR)
        if not ports_to_scan_set: print("WARNING: No valid ports. Port scanning DISABLED.", file=sys.stderr);
        else:
            print(f"INFO: {len(ports_to_scan_set)} ports configured."); now_ts_float = time.time(); last_scan_ts_float = 0.0
            try:
                if os.path.exists(PORT_SCAN_STATE_FILE):
                    with open(PORT_SCAN_STATE_FILE, 'r') as f: last_scan_ts_float = float(f.read().strip())
            except (ValueError, IOError) as e: print(f"WARNING: Error reading port scan state file: {e}. Forcing scan.", file=sys.stderr); last_scan_ts_float = 0.0
            time_since_last = now_ts_float - last_scan_ts_float
            if time_since_last >= SCAN_PORT_INTERVAL_SECONDS:
                print(f"INFO: Port scan interval elapsed ({time_since_last:.0f}s >= {SCAN_PORT_INTERVAL_SECONDS}s). Enabling scan."); do_port_scan_this_run = True
                try: # Update timestamp *before* scan starts
                    with open(PORT_SCAN_STATE_FILE, 'w') as f: f.write(str(now_ts_float))
                except IOError as e: print(f"ERROR: Failed update port scan state file: {e}", file=sys.stderr)
            else: print(f"INFO: Port scan interval not elapsed ({time_since_last:.0f}s < {SCAN_PORT_INTERVAL_SECONDS}s). Skipping.")
    else: ports_to_scan_set = set()

    db_connection = connect_db()

    # Load OUI data
    oui_available = False
    if download_oui_file(OUI_URL, OUI_FILE):
        if parse_oui_file(OUI_FILE): oui_available = True
    parse_custom_oui_file(CUSTOM_OUI_FILE) # Load custom overrides
    if not oui_available and not custom_oui_dict: print("WARNING: No OUI data loaded.", file=sys.stderr)
    elif not oui_available and custom_oui_dict: print("WARNING: Standard OUI failed, using custom only.", file=sys.stderr)

    # Main logic
    last_state = load_state_from_db(db_connection)
    current_scan = scan_network(NETWORK_RANGE)
    if current_scan is None: print("ARP Scan failed.", file=sys.stderr); final_report_state = {}
    else: final_report_state = update_db_and_get_status( db_connection, current_scan, last_state, ports_to_scan_set, do_port_scan_this_run )

    # Print results & Close DB
    print_results(final_report_state)
    if db_connection:
        try: db_connection.close(); print("\nDatabase connection closed.")
        except mariadb.Error as e: print(f"Error closing DB connection: {e}", file=sys.stderr)

    end_time = datetime.now(); print(f"\nScanner script finished in {(end_time - start_time).total_seconds():.2f} seconds.")