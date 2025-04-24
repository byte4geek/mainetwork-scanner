#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# === Imports ===
import os, sys, socket, logging, requests, subprocess, shutil, traceback, time
from datetime import datetime, timedelta, timezone
from ipaddress import ip_network, ip_address
from dotenv import load_dotenv
from collections import OrderedDict
import concurrent.futures

# --- Scapy Import ---
logging.getLogger("scapy.runtime").setLevel(logging.ERROR)
logging.getLogger("scapy.loading").setLevel(logging.ERROR)
try: from scapy.all import Ether, ARP, IP, ICMP, srp, sr1, conf
except Exception as e: logging.critical(f"ERROR importing Scapy: {e}"); sys.exit(1)

# --- MariaDB Connector Import ---
try: import mariadb
except ImportError: logging.critical("ERROR: 'mariadb' library not installed."); sys.exit(1)

# === Global Configuration ===
load_dotenv()
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
# --- Logging Configuration ---
log_level_name = os.getenv('LOG_LEVEL', 'INFO').upper()
log_level = getattr(logging, log_level_name, logging.INFO)
logging.basicConfig(level=log_level, format='%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S', stream=sys.stdout)
# --- Network & OUI ---
NETWORK_RANGE = os.getenv("NETWORK_RANGE")
OUI_FILE = os.getenv("OUI_FILE", "oui.txt")
OUI_URL = "https://standards-oui.ieee.org/oui/oui.txt"
CUSTOM_OUI_FILE = os.getenv("CUSTOM_OUI_FILE", "custom_oui.txt")
SCAN_TIMEOUT = 2; PING_TIMEOUT = 1; PING_RETRY = 1
# --- Port Scan Settings ---
raw_port_scan_enabled = os.getenv("PORT_SCAN_ENABLED", "false").lower(); PORT_SCAN_ENABLED = raw_port_scan_enabled in ['true', '1', 'yes', 'y']
PORT_SCAN_RANGE_STR = os.getenv("PORT_SCAN_RANGE", "1-1024")
try: PORT_SCAN_TIMEOUT = float(os.getenv("PORT_SCAN_TIMEOUT", "0.5"))
except ValueError: logging.warning("Invalid PORT_SCAN_TIMEOUT, using 0.5s"); PORT_SCAN_TIMEOUT = 0.5
try: PORT_SCAN_THREADS = int(os.getenv("PORT_SCAN_THREADS", "20")); assert PORT_SCAN_THREADS > 0
except (ValueError, AssertionError): logging.warning("Invalid PORT_SCAN_THREADS, using 20"); PORT_SCAN_THREADS = 20
try: SCAN_PORT_INTERVAL_SECONDS = int(os.getenv("SCAN_PORT_INTERVAL_SECONDS", "300")); assert SCAN_PORT_INTERVAL_SECONDS > 0
except (ValueError, AssertionError): logging.warning("Invalid SCAN_PORT_INTERVAL_SECONDS, using 300s"); SCAN_PORT_INTERVAL_SECONDS = 300
# --- History Purge Setting ---
try: PURGE_HISTORY_HOURS = int(os.getenv("PURGE_HISTORY_HOURS", "72"))
except ValueError: logging.warning("Invalid PURGE_HISTORY_HOURS, using 72"); PURGE_HISTORY_HOURS = 72
PORT_SCAN_STATE_FILE = os.path.join(PROJECT_DIR, "last_port_scan.ts")
# --- Database Credentials ---
DB_HOST = os.getenv("DB_HOST", "localhost"); DB_PORT = int(os.getenv("DB_PORT", 3306)); DB_USER = os.getenv("DB_USER"); DB_PASSWORD = os.getenv("DB_PASSWORD"); DB_NAME = os.getenv("DB_NAME")
# --- Other Globals ---
conf.verb = 0; oui_dict = {}; custom_oui_dict = {}; ports_to_scan_set = set()

# === Helper Functions ===
def check_root():
    if os.geteuid() != 0: logging.critical("ERROR: Root privileges required."); sys.exit(1)

def connect_db():
    conn = None
    if not all([DB_USER, DB_PASSWORD, DB_NAME]): logging.error("ERROR: DB credentials missing."); return None
    try: conn = mariadb.connect(host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, database=DB_NAME, connect_timeout=10); conn.autocommit = False; return conn
    except mariadb.Error as e: logging.error(f"ERROR: DB connection failed: {e}"); return None

# --- OUI File Handling ---
def download_oui_file(url, filename): # Syntax Corrected
    if not os.path.exists(filename):
        logging.info(f"Standard OUI file '{filename}' not found. Downloading...")
        wget_path = shutil.which('wget');
        if not wget_path: logging.error("ERROR: 'wget' not found."); return False
        command = [wget_path, '--tries=3', '--timeout=30', '-nv', url, '-O', filename]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=45)
            if result.returncode == 0 and os.path.exists(filename) and os.path.getsize(filename) > 0: logging.info(f"Standard OUI downloaded: {filename}"); return True
            else:
                logging.error(f"ERROR: wget failed (code {result.returncode}). Stderr: {result.stderr or '[None]'}")
                if os.path.exists(filename):
                    try: os.remove(filename)
                    except OSError: pass
                return False
        except Exception as e:
            logging.error(f"ERROR: wget execution error: {e}")
            if os.path.exists(filename):
                 try: os.remove(filename)
                 except OSError: pass
            return False
    else: return True

def parse_oui_file(filename): # Syntax Corrected
    global oui_dict; oui_dict = {}; logging.info(f"Loading standard OUI from '{filename}'...")
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            for line in f:
                if '(hex)' in line:
                    parts = line.split('(hex)', 1)
                    if len(parts) == 2:
                        mac_prefix = parts[0].strip().replace('-', '').upper()
                        vendor = parts[1].strip()
                        if len(mac_prefix) == 6: oui_dict[mac_prefix] = vendor
    except FileNotFoundError: logging.error(f"ERROR: Standard OUI file '{filename}' not found."); return False
    except Exception as e: logging.error(f"ERROR parsing standard OUI: {e}"); return False
    if not oui_dict: logging.warning("WARNING: No standard OUI data loaded.");
    logging.info(f"Loaded {len(oui_dict)} standard OUI records.")
    return True

def parse_custom_oui_file(filename): # Syntax Corrected
    global custom_oui_dict; custom_oui_dict = {}; full_path = os.path.join(PROJECT_DIR, filename)
    if not os.path.exists(full_path): logging.info(f"INFO: Custom OUI file '{filename}' not found."); return True
    logging.info(f"Loading custom OUI overrides from '{filename}'..."); loaded_count = 0
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line or line.startswith('#'): continue
                parts = line.split(None, 1)
                if len(parts) == 2:
                    prefix_str = parts[0].strip(); vendor_name = parts[1].strip(); normalized_prefix = prefix_str.replace(':','').replace('-','').upper()
                    if len(normalized_prefix) == 6:
                        try: int(normalized_prefix, 16); custom_oui_dict[normalized_prefix] = vendor_name; loaded_count += 1
                        except ValueError: logging.warning(f"WARNING: Invalid hex prefix '{prefix_str}' L{line_num} in '{filename}'.")
                    else:
                        if normalized_prefix.endswith('(HEX)'): normalized_prefix = normalized_prefix[:-5].strip().replace('-','').upper()
                        if len(normalized_prefix) == 6:
                             try: int(normalized_prefix, 16); custom_oui_dict[normalized_prefix] = vendor_name; loaded_count += 1
                             except ValueError: logging.warning(f"WARNING: Invalid hex prefix '{prefix_str}' L{line_num} in '{filename}'.")
                        else: logging.warning(f"WARNING: Invalid prefix len '{prefix_str}' L{line_num} in '{filename}'.")
                else: logging.warning(f"WARNING: Invalid format L{line_num} in '{filename}'.")
    except IOError as e: logging.error(f"ERROR: Cannot read custom OUI '{filename}': {e}"); return False
    except Exception as e: logging.error(f"ERROR parsing custom OUI '{filename}': {e}"); return False
    logging.info(f"Loaded {loaded_count} custom OUI prefix overrides.")
    return True

# Vendor Lookup Function (Corrected for UnboundLocalError AGAIN)
def get_vendor(mac_address):
    """Gets vendor, prioritizing custom OUI prefix, then standard."""
    if not mac_address:
        return "N/A"
    normalized_mac = mac_address.replace(':','').replace('-','').upper()
    if len(normalized_mac) < 6:
        return "Unknown (Short MAC)"
    oui_prefix = normalized_mac[:6] # Get prefix AFTER length check
    if oui_prefix in custom_oui_dict:
        return custom_oui_dict[oui_prefix] + " (Custom)"
    if oui_prefix in oui_dict:
        return oui_dict[oui_prefix]
    return "Unknown"

# --- Port Scan Functions ---
def parse_port_range(range_str): # Syntax Corrected
    ports = set();
    if not range_str: logging.warning("WARNING: PORT_SCAN_RANGE is empty."); return ports
    try:
        for part in range_str.split(','):
            part = part.strip()
            if not part: continue
            if '-' in part:
                start, end = map(int, part.split('-', 1))
                if start <= end and start > 0 and end < 65536: ports.update(range(start, end + 1))
                else: logging.warning(f"WARNING: Invalid port range ignored: {part}")
            else:
                 port_num = int(part)
                 # Corrected Indentation
                 if 1 <= port_num <= 65535:
                     ports.add(port_num)
                 else:
                     logging.warning(f"WARNING: Invalid port number ignored: {part}")
    except ValueError: logging.error(f"ERROR: Invalid PORT_SCAN_RANGE format: '{range_str}'."); return set()
    return ports

def scan_port(ip, port, timeout): # Unchanged
    sock = None
    try: sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM); sock.settimeout(timeout); return sock.connect_ex((ip, port)) == 0
    except socket.error: return False
    finally:
        if sock: sock.close()

def scan_ports_threaded(ip, ports_to_scan, timeout, max_threads): # Unchanged
    open_ports = []; actual_threads = min(max_threads, len(ports_to_scan) if ports_to_scan else 1);
    if actual_threads <= 0 : actual_threads = 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=actual_threads) as executor:
        future_to_port = {executor.submit(scan_port, ip, port, timeout): port for port in ports_to_scan}
        for future in concurrent.futures.as_completed(future_to_port):
            port = future_to_port[future];
            try:
                if future.result(): open_ports.append(port)
            except Exception as exc: logging.warning(f'WARNING: Exception scanning {ip}:{port} - {exc}')
    if open_ports: open_ports.sort(); return ",".join(map(str, open_ports))
    else: return ""

# --- Network Discovery Functions ---
def scan_network(network_cidr): # Syntax Corrected
    active_hosts = {}; logging.info(f"\nStarting ARP scan on {network_cidr}...")
    try:
        network_obj = ip_network(network_cidr, strict=False); packet = Ether(dst="ff:ff:ff:ff:ff:ff")/ARP(pdst=str(network_cidr))
        answered, _ = srp(packet, timeout=SCAN_TIMEOUT, retry=1, verbose=False); logging.info(f"ARP scan completed. {len(answered)} hosts responded.")
        # Corrected loop syntax
        for _, received in answered:
            ip = received.psrc; mac = received.hwsrc
            try:
                if ip_address(ip) in network_obj: active_hosts[ip] = {'mac': mac}
            except ValueError: logging.debug(f"Debug: Ignoring invalid IP format received '{ip}'")
    except ValueError: logging.error(f"ERROR: Invalid network range '{network_cidr}'"); return None
    except PermissionError: logging.critical("ERROR: Root permissions needed."); sys.exit(1)
    except NameError as ne: logging.critical(f"ERROR: NameError during ARP scan: {ne}. Check imports."); return None
    except Exception as e: logging.error(f"ERROR during ARP scan: {e}"); return None
    return active_hosts

def is_host_reachable_by_ping(ip_address, timeout=PING_TIMEOUT, retry=PING_RETRY): # Unchanged
    if not ip_address: return False
    try: response = sr1(IP(dst=ip_address)/ICMP(), timeout=timeout, retry=retry, verbose=False); return response is not None
    except Exception as e: logging.warning(f"WARNING: Ping error to {ip_address}: {e}"); return False

# --- Database State Functions ---
# Function load_state_from_db (Syntax Corrected)
def load_state_from_db(conn):
    last_db_state = {}; cursor = None
    if not conn: return last_db_state
    logging.info("Loading previous state from DB...");
    try:
        cursor = conn.cursor(dictionary=True)
        query = "SELECT ip_address, mac_address, vendor, hostname, ports, note, status, known_host, last_seen_online FROM hosts"
        cursor.execute(query); results = cursor.fetchall()
        for row in results:
            ip = row['ip_address']; last_db_state[ip] = row
            # Corrected known_host handling
            try:
                if last_db_state[ip]['known_host'] is not None:
                    last_db_state[ip]['known_host'] = int(last_db_state[ip]['known_host'])
                else: last_db_state[ip]['known_host'] = 0
            except (ValueError, TypeError):
                 last_db_state[ip]['known_host'] = 0
        # Log count *after* the loop
        logging.info(f"Loaded state for {len(last_db_state)} hosts.")
    except mariadb.Error as e: logging.error(f"ERROR reading DB state: {e}")
    except Exception as e: logging.error(f"ERROR loading DB state: {e}")
    finally:
        if cursor: cursor.close()
    return last_db_state

def update_db_and_get_status(conn, current_scan_results, last_db_state, ports_to_scan, perform_port_scan): # Unchanged logic
    final_report_state = OrderedDict(); updated_count, inserted_count, offline_count, port_scan_count, ping_check_count, history_count = 0, 0, 0, 0, 0, 0
    if not conn: logging.error("ERROR: Invalid DB connection for update."); return final_report_state
    cursor = None; now_ts = datetime.now(); history_inserts = []
    try:
        cursor = conn.cursor(); online_ips = set(current_scan_results.keys())
        # Process ONLINE
        for ip in online_ips:
            data = current_scan_results[ip]; mac = data['mac']; vendor = get_vendor(mac); ports_result_str = None # Call get_vendor here
            if PORT_SCAN_ENABLED and perform_port_scan and ports_to_scan:
                logging.info(f"Starting port scan for {ip} ({len(ports_to_scan)} ports)..."); ports_result_str = scan_ports_threaded(ip, ports_to_scan, PORT_SCAN_TIMEOUT, PORT_SCAN_THREADS)
                if ports_result_str is not None: port_scan_count += 1; logging.info(f"Port scan {ip} -> '{ports_result_str or 'None Open'}'")
            last_state = last_db_state.get(ip)
            current_ports = ports_result_str if ports_result_str is not None else (last_state.get('ports', '') if last_state else '')
            final_report_state[ip] = {'mac': mac, 'vendor': vendor, 'status': 'ONLINE', 'ports': current_ports or "", 'hostname': last_state.get('hostname', '') if last_state else '', 'note': last_state.get('note', '') if last_state else '', 'known_host': last_state.get('known_host', 0) if last_state else 0, 'timestamp': now_ts}
            if last_state: # UPDATE
                last_mac=last_state.get('mac','') or ''; last_vendor=last_state.get('vendor','') or ''; last_status=last_state.get('status','OFFLINE'); last_ports=last_state.get('ports','') or ''
                current_ports_compare = ports_result_str if ports_result_str is not None else last_ports
                port_scan_rel = PORT_SCAN_ENABLED and perform_port_scan and ports_to_scan and ports_result_str is not None
                ports_differ = (port_scan_rel and (current_ports_compare or "") != (last_ports or ""))
                status_changed = (last_status == 'OFFLINE')
                needs_update = (status_changed or last_mac != mac or last_vendor != vendor or ports_differ)
                if needs_update:
                    set_clauses = ["mac_address = ?", "vendor = ?", "status = 'ONLINE'", "last_seen_online = NOW()"]; params = [mac, vendor]
                    if port_scan_rel: set_clauses.append("ports = ?"); params.append(ports_result_str if ports_result_str else None);
                    if status_changed: history_inserts.append((ip, 1, now_ts)); logging.debug(f"DB HISTORY Queued: {ip} -> ONLINE")
                    params.append(ip); update_query = f"UPDATE hosts SET {', '.join(set_clauses)} WHERE ip_address = ?"; cursor.execute(update_query, tuple(params)); updated_count += 1
            else: # INSERT
                current_ports_insert = ports_result_str if (PORT_SCAN_ENABLED and perform_port_scan and ports_result_str is not None) else None
                logging.info(f"DB INSERT: {ip} (MAC: {mac}, Ports: '{current_ports_insert or 'NULL'}')")
                insert_query = "INSERT INTO hosts (ip_address, mac_address, vendor, ports, status, first_seen, last_seen_online) VALUES (?, ?, ?, ?, 'ONLINE', NOW(), NOW())"; cursor.execute(insert_query, (ip, mac, vendor, current_ports_insert)); inserted_count += 1
                history_inserts.append((ip, 1, now_ts)); logging.debug(f"DB HISTORY Queued: {ip} -> ONLINE (New)")
        # Process OFFLINE
        potentially_offline_ips = set(last_db_state.keys()) - online_ips
        if potentially_offline_ips: logging.info(f"{len(potentially_offline_ips)} hosts not in ARP. Pinging...");
        for ip in potentially_offline_ips:
            last_data = last_db_state[ip]
            if last_data.get('status') == 'ONLINE':
                ping_check_count += 1; logging.debug(f"Pinging {ip}...")
                if is_host_reachable_by_ping(ip): logging.info(f"Ping success for {ip}. Kept as ONLINE."); final_report_state[ip] = {**last_data, 'status': 'ONLINE', 'timestamp': now_ts}
                else: logging.info(f"Ping failed for {ip}. Marking OFFLINE."); cursor.execute("UPDATE hosts SET status = 'OFFLINE' WHERE ip_address = ?", (ip,)); offline_count += 1; final_report_state[ip] = {**last_data, 'status': 'OFFLINE', 'timestamp': now_ts}; history_inserts.append((ip, 0, now_ts)); logging.debug(f"DB HISTORY Queued: {ip} -> OFFLINE")
            else: final_report_state[ip] = {**last_data, 'timestamp': now_ts}
        # Insert History Records
        if history_inserts:
            logging.info(f"Inserting {len(history_inserts)} history records...")
            history_query = "INSERT INTO host_history (ip_address, status, event_time) VALUES (?, ?, ?)"
            try: cursor.executemany(history_query, history_inserts); history_count = cursor.rowcount; logging.info(f"Inserted {history_count} history records.")
            except mariadb.Error as hist_e: logging.error(f"ERROR: Failed to insert history: {hist_e}")
        # Commit
        conn.commit(); logging.info(f"DB update complete: {inserted_count} INSERTED, {updated_count} UPDATED (Online), {offline_count} marked OFFLINE.")
        if ping_check_count > 0: logging.info(f"Ping checks performed for {ping_check_count} hosts.")
        if port_scan_count > 0: logging.info(f"Port scans performed for {port_scan_count} online hosts.")
        if history_count > 0: logging.info(f"Status change history events recorded: {history_count}")
    except mariadb.Error as e: logging.error(f"ERROR during DB update: {e}"); logging.warning("Rolling back DB changes..."); conn.rollback(); final_report_state = {ip: {**d, 'status': d['status'] + " (DB Fail)"} for ip, d in final_report_state.items()}
    except Exception as e: logging.exception(f"ERROR during DB update: {e}"); logging.warning("Rolling back DB changes..."); conn.rollback(); final_report_state = {ip: {**d, 'status': d['status'] + " (DB Fail)"} for ip, d in final_report_state.items()}
    finally:
        if cursor: cursor.close()
    return final_report_state

# --- History Purge Function ---
def purge_old_history(conn, hours_to_keep): # Unchanged logic
    if not conn or hours_to_keep <= 0:
        if hours_to_keep <= 0: logging.info("History purge disabled (PURGE_HISTORY_HOURS <= 0).")
        return
    logging.info(f"Purging history records older than {hours_to_keep} hours...")
    cursor = None
    try: cutoff_date = datetime.now(timezone.utc) - timedelta(hours=hours_to_keep); cursor = conn.cursor(); purge_query = "DELETE FROM host_history WHERE event_time < ?"; cursor.execute(purge_query, (cutoff_date,)); deleted_count = cursor.rowcount; conn.commit(); logging.info(f"History purge complete. Deleted {deleted_count} old records.")
    except mariadb.Error as e: logging.error(f"ERROR: Failed to purge history: {e}"); conn.rollback()
    except Exception as e: logging.exception(f"ERROR: Unexpected error during history purge: {e}"); conn.rollback()
    finally:
        if cursor: cursor.close()

# --- Console Output Function ---
def print_results(final_state): # Unchanged logic
    logging.info("\n--- Network Scan Results (Current Status) ---")
    if not final_state: logging.info("No hosts found or state to report."); return
    hostname_width=20; ports_width=30; note_width=20; known_width=5; vendor_width=25; total_width = 18+1+20+1+vendor_width+1+hostname_width+1+ports_width+1+note_width+1+known_width+1+15
    header = f"{'IP Address':<18} {'MAC Address':<20} {'Vendor':<{vendor_width}} {'Hostname':<{hostname_width}} {'Ports':<{ports_width}} {'Note':<{note_width}} {'Known':<{known_width}} {'Status':<10}"; separator = "-" * len(header)
    logging.info(header); logging.info(separator)
    for ip in final_state: data=final_state[ip]; mac=data.get('mac') or 'N/A'; vendor=data.get('vendor') or 'N/A'; hostname=data.get('hostname') or ''; ports=data.get('ports') or ''; note=data.get('note') or ''; known='Y' if data.get('known_host',0)==1 else 'N'; status=data.get('status') or 'N/A'; logging.info(f"{ip:<18} {mac:<20} {vendor:<{vendor_width}} {hostname:<{hostname_width}} {ports:<{ports_width}} {note:<{note_width}} {known:<{known_width}} {status:<10}")
    logging.info(separator); logging.info(f"Total hosts monitored: {len(final_state)}")

# === Main Execution Block ===
if __name__ == "__main__":
    logging.info("Starting Network Scanner DB Script..."); start_time = datetime.now()
    check_root()
    if not NETWORK_RANGE: logging.critical("ERROR: NETWORK_RANGE not defined."); sys.exit(1)
    if not all([DB_USER, DB_PASSWORD, DB_NAME]): logging.critical("ERROR: DB credentials not defined."); sys.exit(1)
    logging.info(f"Config: Net={NETWORK_RANGE}, PortScan={PORT_SCAN_ENABLED}, Range='{PORT_SCAN_RANGE_STR}', Threads={PORT_SCAN_THREADS}, Interval={SCAN_PORT_INTERVAL_SECONDS}s, PurgeHours={PURGE_HISTORY_HOURS}, LogLevel={log_level_name}")

    # Port Scan Interval Logic (Syntax Corrected)
    do_port_scan_this_run = False
    if PORT_SCAN_ENABLED:
        ports_to_scan_set = parse_port_range(PORT_SCAN_RANGE_STR)
        if not ports_to_scan_set: logging.warning("WARNING: No valid ports. Port scanning DISABLED.")
        else:
            logging.info(f"INFO: {len(ports_to_scan_set)} ports configured."); now_ts_float = time.time(); last_scan_ts_float = 0.0
            try:
                if os.path.exists(PORT_SCAN_STATE_FILE):
                    with open(PORT_SCAN_STATE_FILE, 'r') as f: last_scan_ts_float = float(f.read().strip())
            except (ValueError, IOError) as e: logging.warning(f"WARNING: Error reading port scan state file: {e}. Forcing scan."); last_scan_ts_float = 0.0
            time_since_last = now_ts_float - last_scan_ts_float
            if time_since_last >= SCAN_PORT_INTERVAL_SECONDS:
                logging.info(f"INFO: Port scan interval elapsed. Enabling scan."); do_port_scan_this_run = True
                try: # Correctly indented block
                    with open(PORT_SCAN_STATE_FILE, 'w') as f:
                        f.write(str(now_ts_float))
                except IOError as e: logging.error(f"ERROR: Failed update port scan state file: {e}"); logging.warning(f"WARNING: Next port scan might occur sooner.")
            else: logging.info(f"INFO: Port scan interval not elapsed. Skipping.")
    else: ports_to_scan_set = set()

    db_connection = connect_db()

    # Purge History
    if db_connection:
        purge_old_history(db_connection, PURGE_HISTORY_HOURS)

    # Load OUI data
    oui_available = False
    if download_oui_file(OUI_URL, OUI_FILE):
        if parse_oui_file(OUI_FILE): oui_available = True
    parse_custom_oui_file(CUSTOM_OUI_FILE)
    if not oui_available and not custom_oui_dict: logging.warning("WARNING: No OUI data loaded.")
    elif not oui_available and custom_oui_dict: logging.warning("WARNING: Standard OUI failed, using custom only.")

    # Main logic
    last_state = load_state_from_db(db_connection)
    current_scan = scan_network(NETWORK_RANGE) # ARP Scan
    if current_scan is None: logging.error("ARP Scan failed."); final_report_state = {}
    else: final_report_state = update_db_and_get_status( db_connection, current_scan, last_state, ports_to_scan_set, do_port_scan_this_run )

    # Print results (uses logging - respects LOG_LEVEL)
    print_results(final_report_state)

    # Close DB
    if db_connection:
        try: # Correctly indented try...except
            db_connection.close(); logging.info("Database connection closed.")
        except mariadb.Error as e: logging.error(f"Error closing DB connection: {e}")

    end_time = datetime.now(); logging.info(f"Scanner script finished in {(end_time - start_time).total_seconds():.2f} seconds.")
