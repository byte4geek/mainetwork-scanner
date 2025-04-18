// ===========================================
// static/script.js - COMPLETE & VERIFIED (v10 - EN Comments)
// Includes: Filters, Known Toggle, Delete, Inline Edit (Hostname/Note),
//           Theme Toggle (Cookie), Refresh Toggle/Interval (Cookie), Column Resizing (Cookie)
// ===========================================

// --- Global Variables & Constants ---
let allHostsData = []; // Stores the latest data fetched from the API
let refreshIntervalId = null; // Holds the interval timer ID
let isAutoRefreshEnabled = false; // Auto-refresh state (starts disabled)
let currentRefreshIntervalMs = 10000; // Current refresh interval in milliseconds (default 10s)
const COL_WIDTH_COOKIE_NAME = 'networkScannerColWidths'; // Cookie for column widths
const THEME_COOKIE_NAME = 'networkScannerTheme'; // Cookie for theme preference
const REFRESH_INTERVAL_COOKIE_NAME = 'networkScannerRefreshInterval'; // Cookie for refresh interval (seconds)
const MIN_REFRESH_INTERVAL_S = 5; // Minimum allowed refresh interval in seconds
const MIN_COL_WIDTH = 40; // Minimum column width in pixels

// Resizing state variables
let isResizing = false;
let currentResizableTh = null; // The <th> being resized
let currentResizableCol = null; // The corresponding <col> element
let startX = 0, startColWidth = 0; // Initial mouse position and column width during resize

// DOM References (assigned in DOMContentLoaded)
let table = null;
let colgroup = null;
let tableBody = null;
let lastUpdatedDiv = null;
let refreshCheckbox = null;
let themeCheckbox = null;
let refreshIntervalInput = null;

// --- Cookie Functions ---
function setCookie(name, value, days) {
    let expires = "";
    if (days) { const date = new Date(); date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000)); expires = "; expires=" + date.toUTCString(); }
    try {
        // Store strings directly, JSON stringify others
        const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
        const encodedValue = encodeURIComponent(valueToStore);
        document.cookie = name + "=" + encodedValue + expires + "; path=/; SameSite=Lax;"; // Removed Secure for local HTTP
        // console.log(`Cookie set: ${name}=${valueToStore}`); // Verbose log
    } catch (e) { console.error("Error setting cookie:", name, e); }
}

function getCookie(name) {
    const nameEQ = name + "="; const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i]; while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) {
            const encodedValue = c.substring(nameEQ.length, c.length);
            try {
                const decodedValue = decodeURIComponent(encodedValue);
                try { return JSON.parse(decodedValue); } // Try JSON first
                catch (jsonError) { return decodedValue; } // Return string if not JSON
            } catch (e) { console.error("Error decoding cookie:", name, e); return null; }
        }
    }
    return null;
}

// --- UI Update Functions ---
function updateTimestamp(apiFetchTime = true) {
    if (!lastUpdatedDiv) return;
    const now = new Date(); const prefix = apiFetchTime ? "Server data updated at: " : "Filter/UI updated at: ";
    lastUpdatedDiv.textContent = `${prefix}${now.toLocaleTimeString()}`;
}

function getFilterValues() {
    const filters = {};
    document.querySelectorAll('#filter-row .filter-input').forEach(input => {
        filters[input.id.replace('filter-', '')] = input.value.trim().toLowerCase();
    });
    return filters;
}

function filterHostData(hosts, filters) {
    if (!Array.isArray(hosts)) return [];
    const noFiltersActive = Object.values(filters).every(val => val === '');
    if (noFiltersActive) return hosts;
    return hosts.filter(host => {
        for (const key in filters) {
            const filterValue = filters[key];
            if (filterValue !== '') {
                if (key === 'known_host') {
                    const knownData = host[key]; let matches = false;
                    if ((filterValue === 'yes' || filterValue === '1') && knownData == 1) matches = true;
                    else if ((filterValue === 'no' || filterValue === '0') && knownData == 0) matches = true;
                    if (!matches) return false;
                } else {
                    const hostValue = String(host[key] || '').toLowerCase();
                    if (!hostValue.includes(filterValue)) return false;
                }
            }
        }
        return true;
    });
}

function renderTable(hostsToRender) {
    if (!tableBody) { console.error("Tbody not found in renderTable!"); return; }
    tableBody.innerHTML = ''; // Clear existing rows

    if (!Array.isArray(hostsToRender) || hostsToRender.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="12">No hosts found or matching filters.</td></tr>';
    } else {
        hostsToRender.forEach(host => {
            try { // Add try-catch per row for robustness
                const row = tableBody.insertRow();
                // Delete Icon (Col 0)
                const deleteCell = row.insertCell(0); deleteCell.classList.add('action-cell'); const deleteIcon = document.createElement('span'); deleteIcon.className = 'mdi mdi-delete delete-icon'; deleteIcon.title = `Delete host ${host.ip_address}`; deleteIcon.dataset.ip = host.ip_address; deleteCell.appendChild(deleteIcon);
                // Data Cells (Cols 1+)
                row.insertCell(1).textContent = host.ip_address || 'N/D';
                row.insertCell(2).textContent = host.mac_address || 'N/D';
                row.insertCell(3).textContent = host.vendor || 'N/D';
                const hostnameCell = row.insertCell(4); hostnameCell.textContent = host.hostname || ''; hostnameCell.classList.add('editable-cell'); hostnameCell.dataset.ip = host.ip_address; hostnameCell.dataset.field = 'hostname';
                const knownCell = row.insertCell(5); const isKnown = host.known_host == 1; knownCell.textContent = isKnown ? 'Yes' : 'No'; knownCell.className = isKnown ? 'known-yes' : 'known-no'; knownCell.classList.add('known-toggle'); knownCell.dataset.ip = host.ip_address; knownCell.dataset.currentState = host.known_host;
                const statusCell = row.insertCell(6); statusCell.textContent = host.status || 'N/D'; statusCell.className = host.status === 'ONLINE' ? 'status-online' : 'status-offline';
                row.insertCell(7).textContent = host.ports || '';
                const noteCell = row.insertCell(8); noteCell.textContent = host.note || ''; noteCell.classList.add('editable-cell'); noteCell.dataset.ip = host.ip_address; noteCell.dataset.field = 'note';
                row.insertCell(9).textContent = host.first_seen || 'N/D';
                row.insertCell(10).textContent = host.last_seen_online || 'N/D';
                row.insertCell(11).textContent = host.last_updated || 'N/D';
            } catch (rowError){
                console.error("Error rendering row:", host, rowError); // Log specific error
                const errorRow = tableBody.insertRow(-1); const errorCell = errorRow.insertCell(); errorCell.colSpan = 12; errorCell.textContent = `Error rendering row for IP ${host?.ip_address || 'unknown'}`; errorCell.style.color = 'red';
            }
        });
    }
}

function applyFiltersAndRender() {
    try { const filters = getFilterValues(); const filteredHosts = filterHostData(allHostsData, filters); renderTable(filteredHosts); updateTimestamp(false); }
    catch(e) { console.error("Error in applyFiltersAndRender:", e); }
}

// --- API and Action Functions ---
async function fetchDataAndUpdate() {
    // console.log("Fetching data..."); // Less verbose log
    if (!tableBody) { console.error("Cannot fetch data, tbody not found."); return;}
    try {
        const response = await fetch('/api/hosts');
        if (!response.ok) { let errorText = `HTTP error ${response.status}`; try { const errData = await response.json(); if (errData && errData.error) errorText += `: ${errData.error}`; } catch (e) {} throw new Error(errorText); }
        const data = await response.json();
        if (Array.isArray(data)) { allHostsData = data; applyFiltersAndRender(); updateTimestamp(true); } // Apply filters *after* getting fresh data
        else if (data && data.error) { throw new Error(`API Error: ${data.error}`); }
        else { throw new Error("Invalid API response format."); }
    } catch (error) { console.error("Fetch/process error:", error); if(tableBody) tableBody.innerHTML = `<tr><td colspan="12">Error loading data: ${error.message}</td></tr>`; allHostsData = []; } // Reset data on error
}

async function handleKnownToggle(targetCell) {
    const ip = targetCell.dataset.ip; const currentState = parseInt(targetCell.dataset.currentState, 10); if (!ip || isNaN(currentState)) { console.error("Known toggle data missing"); return; }
    const newState = currentState === 0 ? 1 : 0; const originalText = targetCell.textContent; const originalClassName = targetCell.className;
    targetCell.textContent = "Wait..."; targetCell.style.cursor = "wait"; targetCell.classList.remove('known-yes', 'known-no');
    try { const response = await fetch(`/api/hosts/${ip}/known`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ known: newState }) }); const result = await response.json(); if (!response.ok || !result.success) { throw new Error(result.error || `Server error ${response.status}`); }
        targetCell.textContent = newState === 1 ? 'Yes' : 'No'; targetCell.className = newState === 1 ? 'known-yes known-toggle' : 'known-no known-toggle'; targetCell.dataset.currentState = newState; const hostIndex = allHostsData.findIndex(h => h.ip_address === ip); if (hostIndex > -1) allHostsData[hostIndex].known_host = newState; // Update local data
    } catch (error) { console.error(`Known update error for ${ip}:`, error); alert(`DB Error: ${error.message}`); targetCell.textContent = originalText; targetCell.className = originalClassName; } // Restore on error
    finally { targetCell.style.cursor = "pointer"; }
}

async function handleDeleteHost(targetIcon) {
    const ip = targetIcon.dataset.ip; if (!ip) { console.error("Delete icon missing IP."); return; }
    if (!window.confirm(`Confirm delete host ${ip}?`)) return;
    targetIcon.style.opacity = "0.5"; targetIcon.style.pointerEvents = "none";
    try { const response = await fetch(`/api/hosts/${ip}`, { method: 'DELETE' }); let errorMsg = `Server error ${response.status}`; if (!response.ok) { try { const result = await response.json(); if(result.error) errorMsg = result.error; } catch(e) {} throw new Error(errorMsg); }
        console.log(`Host ${ip} deleted.`); const rowToRemove = targetIcon.closest('tr'); if (rowToRemove) rowToRemove.remove(); // Remove row from UI
        allHostsData = allHostsData.filter(host => host.ip_address !== ip); // Remove from local data
        updateTimestamp(false); // Update UI timestamp
    } catch (error) { console.error(`Delete error for ${ip}:`, error); alert(`Deletion error: ${error.message}`); targetIcon.style.opacity = "1"; targetIcon.style.pointerEvents = "auto"; } // Restore icon on error
}

// --- Inline Editing Functions ---
function makeCellEditable(cell) {
    if (document.querySelector('.inline-edit-input')) { return; } // Prevent multi-edit
    const originalValue = cell.textContent; const ip = cell.dataset.ip; const field = cell.dataset.field; if (!ip || !field) { console.error("Editable cell data missing."); return;}
    const input = document.createElement('input'); input.type = 'text'; input.className = 'inline-edit-input'; input.value = originalValue; input.dataset.ip = ip; input.dataset.field = field; input.dataset.originalValue = originalValue;
    cell.innerHTML = ''; cell.appendChild(input); input.focus(); input.select();
    input.addEventListener('blur', handleSaveCellEdit, { once: true }); input.addEventListener('keydown', handleEditInputKeydown);
}

function handleEditInputKeydown(event) { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } else if (event.key === 'Escape') { cancelCellEdit(event.target); } }

async function handleSaveCellEdit(event) {
    const input = event.target; input.removeEventListener('keydown', handleEditInputKeydown); // Clean listener
    const newValue = input.value.trim(); const originalValue = input.dataset.originalValue; const ip = input.dataset.ip; const field = input.dataset.field; const cell = input.parentNode;
    input.remove(); cell.textContent = originalValue; // Restore original text immediately
    if (newValue === originalValue) { /* console.log("Value unchanged."); */ cell.style.cursor = "text"; return; } // Exit if unchanged
    // console.log(`Saving: IP=${ip}, Field=${field}, New=${newValue}`); // Less verbose
    cell.style.cursor = "wait";
    try { const response = await fetch(`/api/hosts/${ip}/update`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ field: field, value: newValue }) }); const result = await response.json(); if (!response.ok || !result.success) { throw new Error(result.error || `Server error ${response.status}`); }
        console.log(`Updated ${field} for ${ip}`); cell.textContent = newValue; // Update UI cell
        const hostIndex = allHostsData.findIndex(h => h.ip_address === ip); if (hostIndex > -1) allHostsData[hostIndex][field] = newValue; // Update local data
    } catch (error) { console.error(`Save error ${field} for ${ip}:`, error); alert(`Save error: ${error.message}`); cell.textContent = originalValue; } // Restore original on error
    finally { cell.style.cursor = "text"; }
}

function cancelCellEdit(input) { const originalValue = input.dataset.originalValue; const cell = input.parentNode; input.removeEventListener('blur', handleSaveCellEdit); input.removeEventListener('keydown', handleEditInputKeydown); input.remove(); cell.textContent = originalValue; cell.style.cursor = "text"; /* console.log("Edit cancelled."); */ }

// --- Auto Refresh Logic ---
function stopAutoRefreshInterval() { if (refreshIntervalId !== null) { clearInterval(refreshIntervalId); refreshIntervalId = null; console.log("Auto-refresh stopped."); } }
function startAutoRefreshInterval() { stopAutoRefreshInterval(); if (isAutoRefreshEnabled) { console.log(`Starting auto-refresh: ${currentRefreshIntervalMs}ms`); fetchDataAndUpdate(); refreshIntervalId = setInterval(fetchDataAndUpdate, currentRefreshIntervalMs); } }
function handleRefreshToggleChange() { if (!refreshCheckbox) return; isAutoRefreshEnabled = refreshCheckbox.checked; console.log(`Auto-refresh toggled: ${isAutoRefreshEnabled ? 'ON' : 'OFF'}`); if (isAutoRefreshEnabled) startAutoRefreshInterval(); else stopAutoRefreshInterval(); }
function handleRefreshIntervalChange() { if (!refreshIntervalInput) return; let newIntervalS = parseInt(refreshIntervalInput.value, 10); if (isNaN(newIntervalS) || newIntervalS < MIN_REFRESH_INTERVAL_S) { newIntervalS = MIN_REFRESH_INTERVAL_S; refreshIntervalInput.value = newIntervalS; console.warn(`Interval set to minimum ${MIN_REFRESH_INTERVAL_S}s`); } currentRefreshIntervalMs = newIntervalS * 1000; console.log(`Refresh interval changed to ${newIntervalS}s`); setCookie(REFRESH_INTERVAL_COOKIE_NAME, newIntervalS, 365); if (isAutoRefreshEnabled) startAutoRefreshInterval(); } // Restart timer if enabled
function loadInitialRefreshState() { const savedIntervalS = getCookie(REFRESH_INTERVAL_COOKIE_NAME); let initialIntervalS = 10; if (savedIntervalS !== null) { const parsedInterval = parseInt(savedIntervalS, 10); if (!isNaN(parsedInterval) && parsedInterval >= MIN_REFRESH_INTERVAL_S) initialIntervalS = parsedInterval; } currentRefreshIntervalMs = initialIntervalS * 1000; if(refreshIntervalInput) refreshIntervalInput.value = initialIntervalS; console.log(`Initial refresh interval: ${initialIntervalS}s`); isAutoRefreshEnabled = refreshCheckbox ? refreshCheckbox.checked : false; console.log(`Initial Auto-refresh State: ${isAutoRefreshEnabled}`); if (isAutoRefreshEnabled) startAutoRefreshInterval(); } // Start only if needed

// --- Column Resizing Logic ---
function applyColumnWidths(widths) { if (!colgroup || !widths || !Array.isArray(widths) || widths.length !== colgroup.children.length) { console.warn("applyColumnWidths: Invalid data.", {colgroup, widths}); return; } Array.from(colgroup.children).forEach((col, index) => { const widthValue = parseInt(widths[index], 10); if (!isNaN(widthValue) && widthValue >= MIN_COL_WIDTH) { col.style.width = `${widthValue}px`; } else { console.warn(`Invalid width (${widths[index]}) for col ${index}.`); col.style.width = ''; } }); /* console.log("Applied widths:", widths); */ }
function saveColumnWidths() { if (!colgroup) return; const widths = Array.from(colgroup.children).map(col => parseInt(window.getComputedStyle(col).width, 10)); const validWidths = widths.filter(w => !isNaN(w) && w >= MIN_COL_WIDTH); if(validWidths.length === colgroup.children.length) { setCookie(COL_WIDTH_COOKIE_NAME, validWidths, 30); } else { console.warn("Cannot save widths: invalid data.", widths); } }
function loadAndApplyColumnWidths() { const savedWidths = getCookie(COL_WIDTH_COOKIE_NAME); if (savedWidths && Array.isArray(savedWidths)) { console.log("Loaded widths:", savedWidths); applyColumnWidths(savedWidths); } else { console.log("No valid widths cookie found."); } }
function handleMouseDown(event) { const target = event.target; const headerCell = target.closest('th.resizable-th'); if (!headerCell) return; const isResizerClick = target.classList.contains('resizer'); const rect = headerCell.getBoundingClientRect(); const isNearEdge = event.clientX > rect.right - 10 && event.clientX <= rect.right + 5; const hasResizerSpan = headerCell.querySelector('.resizer'); if ((isResizerClick || isNearEdge) && hasResizerSpan) { currentResizableTh = headerCell; const thIndex = Array.from(currentResizableTh.parentNode.children).indexOf(currentResizableTh); if (colgroup && colgroup.children[thIndex]) { currentResizableCol = colgroup.children[thIndex]; startColWidth = parseInt(window.getComputedStyle(currentResizableCol).width, 10); /* console.log(`Start resize col ${thIndex}, width: ${startColWidth}px`); */ } else { console.error("Col element not found:", thIndex); return; } isResizing = true; startX = event.pageX; document.body.style.cursor = 'col-resize'; document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp, { once: true }); event.preventDefault(); } }
function handleMouseMove(event) { if (!isResizing || !currentResizableCol) return; const diffX = event.pageX - startX; let newWidth = startColWidth + diffX; if (newWidth < MIN_COL_WIDTH) newWidth = MIN_COL_WIDTH; currentResizableCol.style.width = `${newWidth}px`; } // Update <col>
function handleMouseUp() { if (!isResizing) return; /* console.log("End resize"); */ isResizing = false; document.body.style.cursor = 'default'; document.removeEventListener('mousemove', handleMouseMove); if (currentResizableCol) { /* console.log(`Saving width col index: ${Array.from(colgroup.children).indexOf(currentResizableCol)}`); */ saveColumnWidths(); } else { console.warn("MouseUp but no currentResizableCol?"); } currentResizableTh = null; currentResizableCol = null; startX = 0; startColWidth = 0; } // Reset state

// --- Theme Logic ---
function getCurrentTheme() { const savedTheme = getCookie(THEME_COOKIE_NAME); if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme; return 'light'; }
function applyTheme(theme) { const body = document.body; if (!body) return; if (theme === 'dark') { body.classList.add('dark-theme'); body.classList.remove('light-theme'); if (themeCheckbox) themeCheckbox.checked = true; } else { body.classList.add('light-theme'); body.classList.remove('dark-theme'); if (themeCheckbox) themeCheckbox.checked = false; } }
function saveThemePreference(theme) { const themeToSave = (theme === 'dark' || theme === 'light') ? theme : 'light'; setCookie(THEME_COOKIE_NAME, themeToSave, 365); }
function handleThemeToggle() { if (!themeCheckbox) return; const newTheme = themeCheckbox.checked ? 'dark' : 'light'; applyTheme(newTheme); saveThemePreference(newTheme); }

// --- Event Listeners & Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing...");
    // Get DOM References
    table = document.getElementById('hosts-table'); colgroup = table ? table.querySelector('colgroup') : null; tableBody = table ? table.querySelector('tbody') : null;
    lastUpdatedDiv = document.getElementById('last-updated'); refreshCheckbox = document.getElementById('auto-refresh-checkbox');
    themeCheckbox = document.getElementById('theme-switch-checkbox'); refreshIntervalInput = document.getElementById('refresh-interval-input');

    // Critical check for essential elements
    if (!table || !colgroup || !tableBody || !refreshCheckbox || !lastUpdatedDiv || !themeCheckbox || !refreshIntervalInput ) {
        console.error("CRITICAL ERROR: Essential DOM elements missing! Check IDs in index.html.");
        if(document.body) document.body.innerHTML = '<h1>Interface Initialization Error! Check Console (F12).</h1>';
        return; // Stop execution if critical elements are missing
    }

    // Initial Setup
    // Note: refreshIntervalSpan is removed, interval displayed via input field setup
    refreshCheckbox.checked = isAutoRefreshEnabled; // Set initial checkbox state
    const initialTheme = getCurrentTheme(); applyTheme(initialTheme); // Apply theme first
    loadAndApplyColumnWidths(); // Then load/apply widths
    loadInitialRefreshState(); // Then setup refresh interval/state and start timer if needed

    // Add Event Listeners
    document.querySelectorAll('#filter-row .filter-input').forEach(input => input.addEventListener('input', applyFiltersAndRender));
    const tableHead = table.querySelector('thead'); if (tableHead) { tableHead.addEventListener('mousedown', handleMouseDown); } else { console.error("Thead not found for resize listener."); }
    if (tableBody) { tableBody.addEventListener('click', (event) => { const t = event.target; if (t.tagName === 'TD' && t.classList.contains('known-toggle')) handleKnownToggle(t); else if (t.classList.contains('delete-icon')) handleDeleteHost(t); }); tableBody.addEventListener('dblclick', (event) => { const t = event.target; if (t.tagName === 'TD' && t.classList.contains('editable-cell')) makeCellEditable(t); }); } else { console.error("Tbody not found for action listeners."); }
    refreshCheckbox.addEventListener('change', handleRefreshToggleChange); themeCheckbox.addEventListener('change', handleThemeToggle); refreshIntervalInput.addEventListener('change', handleRefreshIntervalChange);

    // Initial Data Load (after setup)
    fetchDataAndUpdate();

    console.log("Initialization complete.");
});