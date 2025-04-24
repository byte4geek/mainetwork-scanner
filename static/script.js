// ==================================================
// static/script.js - COMPLETE, VERIFIED & READABLE (v12 - EN)
// Includes: Filters, Known Switch, Delete, Inline Edit, Theme Toggle,
// Refresh Toggle/Interval, Col Resizing, Col Visibility
// ==================================================

// --- Global Variables & Constants ---
let allHostsData = []; // Stores the latest data fetched from the API
let refreshIntervalId = null; // Holds the interval timer ID
let isAutoRefreshEnabled = false; // Auto-refresh state (starts disabled by default in HTML)
let currentRefreshIntervalMs = 10000; // Current refresh interval in milliseconds (default 10s)
const COL_WIDTH_COOKIE_NAME = 'networkScannerColWidths'; // Cookie for column widths
const THEME_COOKIE_NAME = 'networkScannerTheme'; // Cookie for theme preference
const REFRESH_INTERVAL_COOKIE_NAME = 'networkScannerRefreshInterval'; // Cookie for refresh interval (seconds)
const COLUMN_VISIBILITY_COOKIE_NAME = 'networkScannerColVisibility'; // Cookie for column visibility
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
let firstHeaderRow = null; // Reference to the first <tr> in <thead>
let filterHeaderRow = null; // Reference to the filter <tr>
let lastUpdatedDiv = null;
let refreshCheckbox = null;
let themeCheckbox = null;
let refreshIntervalInput = null;
let columnToggleList = null; // UL element for column toggles

// --- Cookie Functions ---
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    try {
        const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
        const encodedValue = encodeURIComponent(valueToStore);
        // Use SameSite=Lax. Add '; Secure' if served over HTTPS
        document.cookie = name + "=" + encodedValue + expires + "; path=/; SameSite=Lax;";
        // console.log(`Cookie set: ${name}`); // Less verbose log
    } catch (e) {
        console.error("Error setting cookie:", name, e);
    }
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
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
    const now = new Date();
    const prefix = apiFetchTime ? "Server data updated at: " : "Filter/UI updated at: ";
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
    if (!tableBody || !firstHeaderRow) { console.error("Tbody or HeaderRow not found in renderTable!"); return; }
    tableBody.innerHTML = ''; // Clear

    const visibleColumnCount = columnVisibilityState.filter(isVisible => isVisible).length;

    if (!Array.isArray(hostsToRender) || hostsToRender.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="${visibleColumnCount || 12}">No hosts found or matching filters.</td></tr>`;
    } else {
        hostsToRender.forEach(host => {
            try {
                const row = tableBody.insertRow();
                // --- Create Cells and Apply Visibility ---
                // Delete Icon (Col 0)
                const deleteCell = row.insertCell(0); deleteCell.classList.add('action-cell'); const deleteIcon = document.createElement('span'); deleteIcon.className = 'mdi mdi-delete delete-icon'; deleteIcon.title = `Delete host ${host.ip_address}`; deleteIcon.dataset.ip = host.ip_address; deleteCell.appendChild(deleteIcon); deleteCell.style.display = columnVisibilityState[0] ? '' : 'none';
                // IP Address (Col 1)
                row.insertCell(1).style.display = columnVisibilityState[1] ? '' : 'none'; row.cells[1].textContent = host.ip_address || 'N/D';
                // MAC Address (Col 2)
                row.insertCell(2).style.display = columnVisibilityState[2] ? '' : 'none'; row.cells[2].textContent = host.mac_address || 'N/D';
                // Vendor (Col 3)
                row.insertCell(3).style.display = columnVisibilityState[3] ? '' : 'none'; row.cells[3].textContent = host.vendor || 'N/D';
                // Hostname (Col 4, Editable)
                const hostnameCell = row.insertCell(4); hostnameCell.style.display = columnVisibilityState[4] ? '' : 'none'; hostnameCell.textContent = host.hostname || ''; hostnameCell.classList.add('editable-cell'); hostnameCell.dataset.ip = host.ip_address; hostnameCell.dataset.field = 'hostname';
                // Known (Col 5, Switch)
                const knownCell = row.insertCell(5); knownCell.style.display = columnVisibilityState[5] ? '' : 'none'; knownCell.classList.add('known-cell'); const isKnown = host.known_host == 1; const switchLabel = document.createElement('label'); switchLabel.className = 'switch'; const switchCheckbox = document.createElement('input'); switchCheckbox.type = 'checkbox'; switchCheckbox.checked = isKnown; switchCheckbox.dataset.ip = host.ip_address; switchCheckbox.classList.add('known-switch-checkbox'); const sliderSpan = document.createElement('span'); sliderSpan.className = 'slider'; switchLabel.appendChild(switchCheckbox); switchLabel.appendChild(sliderSpan); knownCell.appendChild(switchLabel);
                // Status (Col 6)
                const statusCell = row.insertCell(6); statusCell.style.display = columnVisibilityState[6] ? '' : 'none'; statusCell.textContent = host.status || 'N/D'; statusCell.className = host.status === 'ONLINE' ? 'status-online' : 'status-offline';
                // Ports (Col 7)
                row.insertCell(7).style.display = columnVisibilityState[7] ? '' : 'none'; row.cells[7].textContent = host.ports || '';
                // Note (Col 8, Editable)
                const noteCell = row.insertCell(8); noteCell.style.display = columnVisibilityState[8] ? '' : 'none'; noteCell.textContent = host.note || ''; noteCell.classList.add('editable-cell'); noteCell.dataset.ip = host.ip_address; noteCell.dataset.field = 'note';
                // --- MODIFIED: Timestamp Formatting ---
                // Function to format date string or return 'N/A'
                const formatTimestamp = (tsString) => {
                    if (!tsString) return 'N/A';
                    try {
                        // Create Date object. Assumes the string from API is in local time (or UTC if server provides 'Z')
                        const dateObj = new Date(tsString.replace(' ', 'T')); // Replace space with 'T' for better ISO parsing
                         if (isNaN(dateObj)) return 'Invalid Date'; // Check if parsing worked
                        // Display using user's locale settings
                        return dateObj.toLocaleString(undefined, { // undefined locale uses browser default
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false // Example format
                        });
                    } catch (e) {
                        console.warn("Error formatting timestamp:", tsString, e);
                        return tsString; // Fallback to original string on error
                    }
                };

                row.insertCell(9).style.display = columnVisibilityState[9] ? '' : 'none'; row.cells[9].textContent = formatTimestamp(host.first_seen);
                row.insertCell(10).style.display = columnVisibilityState[10] ? '' : 'none'; row.cells[10].textContent = formatTimestamp(host.last_seen_online);
                row.insertCell(11).style.display = columnVisibilityState[11] ? '' : 'none'; row.cells[11].textContent = formatTimestamp(host.last_updated);
                // --- END MODIFIED ---
            } catch (rowError){ console.error("Error rendering row:", host, rowError); const errorRow = tableBody.insertRow(-1); const errorCell = errorRow.insertCell(); errorCell.colSpan = visibleColumnCount || 12; errorCell.textContent = `Error rendering row for IP ${host?.ip_address || 'unknown'}`; errorCell.style.color = 'red'; }
        });
    }
}

function applyFiltersAndRender() {
    try { const filters = getFilterValues(); const filteredHosts = filterHostData(allHostsData, filters); renderTable(filteredHosts); updateTimestamp(false); }
    catch(e) { console.error("Error in applyFiltersAndRender:", e); }
}

// --- API and Action Functions ---
async function fetchDataAndUpdate() {
    if (!tableBody) { console.error("Cannot fetch data, tbody not found."); return;}
    try {
        const response = await fetch('/api/hosts');
        if (!response.ok) { let errorText = `HTTP error ${response.status}`; try { const errData = await response.json(); if (errData && errData.error) errorText += `: ${errData.error}`; } catch (e) {} throw new Error(errorText); }
        const data = await response.json();
        if (Array.isArray(data)) { allHostsData = data; applyFiltersAndRender(); updateTimestamp(true); }
        else if (data && data.error) { throw new Error(`API Error: ${data.error}`); }
        else { throw new Error("Invalid API response format."); }
    } catch (error) { console.error("Fetch/process error:", error); if(tableBody) tableBody.innerHTML = `<tr><td colspan="12">Error loading data: ${error.message}</td></tr>`; allHostsData = []; }
}

async function handleKnownSwitchChange(event) { // Renamed from handleKnownToggle
    const checkbox = event.target; // The checkbox that triggered the change
    const ip = checkbox.dataset.ip;
    const newState = checkbox.checked ? 1 : 0; // New state based on checkbox
    if (!ip) { console.error("Known switch change: IP missing from dataset."); return; }
    // console.log(`Known switch change for IP: ${ip}, New state: ${newState}`);
    checkbox.disabled = true; // Disable temporarily
    try {
        const response = await fetch(`/api/hosts/${ip}/known`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ known: newState }) });
        const result = await response.json();
        if (!response.ok || !result.success) { checkbox.checked = !checkbox.checked; throw new Error(result.error || `Server error ${response.status}`); } // Revert checkbox on error
        // console.log(`Successfully updated known status for ${ip} to ${newState}`);
        const hostIndex = allHostsData.findIndex(h => h.ip_address === ip); if (hostIndex > -1) allHostsData[hostIndex].known_host = newState; // Update local data
    } catch (error) { console.error(`Known update error for ${ip}:`, error); alert(`DB Error updating 'Known' for ${ip}: ${error.message}`); checkbox.checked = !checkbox.checked; } // Revert checkbox on error
    finally { checkbox.disabled = false; } // Re-enable checkbox
}

async function handleDeleteHost(targetIcon) {
    const ip = targetIcon.dataset.ip; if (!ip) { console.error("Delete icon missing IP."); return; }
    if (!window.confirm(`Confirm delete host ${ip}?`)) return;
    targetIcon.style.opacity = "0.5"; targetIcon.style.pointerEvents = "none";
    try { const response = await fetch(`/api/hosts/${ip}`, { method: 'DELETE' }); let errorMsg = `Server error ${response.status}`; if (!response.ok) { try { const result = await response.json(); if(result.error) errorMsg = result.error; } catch(e) {} throw new Error(errorMsg); }
        console.log(`Host ${ip} deleted.`); const rowToRemove = targetIcon.closest('tr'); if (rowToRemove) rowToRemove.remove(); allHostsData = allHostsData.filter(host => host.ip_address !== ip); updateTimestamp(false);
    } catch (error) { console.error(`Delete error for ${ip}:`, error); alert(`Deletion error: ${error.message}`); targetIcon.style.opacity = "1"; targetIcon.style.pointerEvents = "auto"; }
}

// --- Inline Editing Functions ---
function makeCellEditable(cell) {
    if (document.querySelector('.inline-edit-input')) { return; } const originalValue = cell.textContent; const ip = cell.dataset.ip; const field = cell.dataset.field; if (!ip || !field) { console.error("Editable cell data missing."); return;}
    const input = document.createElement('input'); input.type = 'text'; input.className = 'inline-edit-input'; input.value = originalValue; input.dataset.ip = ip; input.dataset.field = field; input.dataset.originalValue = originalValue;
    cell.innerHTML = ''; cell.appendChild(input); input.focus(); input.select();
    input.addEventListener('blur', handleSaveCellEdit, { once: true }); input.addEventListener('keydown', handleEditInputKeydown);
}
function handleEditInputKeydown(event) { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } else if (event.key === 'Escape') { cancelCellEdit(event.target); } }
async function handleSaveCellEdit(event) {
    const input = event.target; input.removeEventListener('keydown', handleEditInputKeydown); const newValue = input.value.trim(); const originalValue = input.dataset.originalValue; const ip = input.dataset.ip; const field = input.dataset.field; const cell = input.parentNode;
    input.remove(); cell.textContent = originalValue; if (newValue === originalValue) { cell.style.cursor = "text"; return; }
    // console.log(`Saving: IP=${ip}, Field=${field}, New=${newValue}`);
    cell.style.cursor = "wait";
    try { const response = await fetch(`/api/hosts/${ip}/update`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ field: field, value: newValue }) }); const result = await response.json(); if (!response.ok || !result.success) { throw new Error(result.error || `Server error ${response.status}`); }
        console.log(`Updated ${field} for ${ip}`); cell.textContent = newValue; const hostIndex = allHostsData.findIndex(h => h.ip_address === ip); if (hostIndex > -1) allHostsData[hostIndex][field] = newValue;
    } catch (error) { console.error(`Save error ${field} for ${ip}:`, error); alert(`Save error: ${error.message}`); cell.textContent = originalValue; }
    finally { cell.style.cursor = "text"; }
}
function cancelCellEdit(input) { const originalValue = input.dataset.originalValue; const cell = input.parentNode; input.removeEventListener('blur', handleSaveCellEdit); input.removeEventListener('keydown', handleEditInputKeydown); input.remove(); cell.textContent = originalValue; cell.style.cursor = "text"; /* console.log("Edit cancelled."); */ }

// --- Auto Refresh Logic ---
function stopAutoRefreshInterval() { if (refreshIntervalId !== null) { clearInterval(refreshIntervalId); refreshIntervalId = null; /* console.log("Auto-refresh stopped."); */ } }
function startAutoRefreshInterval() { stopAutoRefreshInterval(); if (isAutoRefreshEnabled) { console.log(`Starting auto-refresh: ${currentRefreshIntervalMs}ms`); fetchDataAndUpdate(); refreshIntervalId = setInterval(fetchDataAndUpdate, currentRefreshIntervalMs); } }
function handleRefreshToggleChange() { if (!refreshCheckbox) return; isAutoRefreshEnabled = refreshCheckbox.checked; console.log(`Auto-refresh toggled: ${isAutoRefreshEnabled ? 'ON' : 'OFF'}`); if (isAutoRefreshEnabled) startAutoRefreshInterval(); else stopAutoRefreshInterval(); }
function handleRefreshIntervalChange() { if (!refreshIntervalInput) return; let newIntervalS = parseInt(refreshIntervalInput.value, 10); if (isNaN(newIntervalS) || newIntervalS < MIN_REFRESH_INTERVAL_S) { newIntervalS = MIN_REFRESH_INTERVAL_S; refreshIntervalInput.value = newIntervalS; console.warn(`Interval set to minimum ${MIN_REFRESH_INTERVAL_S}s`); } currentRefreshIntervalMs = newIntervalS * 1000; console.log(`Refresh interval changed to ${newIntervalS}s`); setCookie(REFRESH_INTERVAL_COOKIE_NAME, newIntervalS, 365); if (isAutoRefreshEnabled) startAutoRefreshInterval(); }
function loadInitialRefreshState() { const savedIntervalS = getCookie(REFRESH_INTERVAL_COOKIE_NAME); let initialIntervalS = 10; if (savedIntervalS !== null) { const parsedInterval = parseInt(savedIntervalS, 10); if (!isNaN(parsedInterval) && parsedInterval >= MIN_REFRESH_INTERVAL_S) initialIntervalS = parsedInterval; } currentRefreshIntervalMs = initialIntervalS * 1000; if(refreshIntervalInput) refreshIntervalInput.value = initialIntervalS; isAutoRefreshEnabled = refreshCheckbox ? refreshCheckbox.checked : false; console.log(`Initial refresh interval: ${initialIntervalS}s / Initial Auto-refresh: ${isAutoRefreshEnabled}`); if (isAutoRefreshEnabled) startAutoRefreshInterval(); }

// --- Column Resizing Logic ---
function applyColumnWidths(widths) { if (!colgroup || !widths || !Array.isArray(widths) || widths.length !== colgroup.children.length) { console.warn("applyColumnWidths: Invalid data."); return; } Array.from(colgroup.children).forEach((col, index) => { const widthValue = parseInt(widths[index], 10); if (!isNaN(widthValue) && widthValue >= MIN_COL_WIDTH) { col.style.width = `${widthValue}px`; } else { /* console.warn(`Invalid width (${widths[index]}) for col ${index}.`); */ col.style.width = ''; } }); /* console.log("Applied widths:", widths); */ }
function saveColumnWidths() { if (!colgroup) return; const widths = Array.from(colgroup.children).map(col => parseInt(window.getComputedStyle(col).width, 10)); const validWidths = widths.filter(w => !isNaN(w) && w >= MIN_COL_WIDTH); if(validWidths.length === colgroup.children.length) { setCookie(COL_WIDTH_COOKIE_NAME, validWidths, 30); } else { console.warn("Cannot save widths.", widths); } }
function loadAndApplyColumnWidths() { const savedWidths = getCookie(COL_WIDTH_COOKIE_NAME); if (savedWidths && Array.isArray(savedWidths)) { console.log("Loaded widths:", savedWidths); applyColumnWidths(savedWidths); } else { console.log("No valid widths cookie found."); } }
function handleMouseDown(event) { const target = event.target; const headerCell = target.closest('th.resizable-th'); if (!headerCell) return; const isResizerClick = target.classList.contains('resizer'); const rect = headerCell.getBoundingClientRect(); const isNearEdge = event.clientX > rect.right - 10 && event.clientX <= rect.right + 5; const hasResizerSpan = headerCell.querySelector('.resizer'); if ((isResizerClick || isNearEdge) && hasResizerSpan) { currentResizableTh = headerCell; const thIndex = Array.from(currentResizableTh.parentNode.children).indexOf(currentResizableTh); if (colgroup && colgroup.children[thIndex]) { currentResizableCol = colgroup.children[thIndex]; startColWidth = parseInt(window.getComputedStyle(currentResizableCol).width, 10); /* console.log(`Start resize col ${thIndex}`); */ } else { console.error("Col not found:", thIndex); return; } isResizing = true; startX = event.pageX; document.body.style.cursor = 'col-resize'; document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp, { once: true }); event.preventDefault(); } }
function handleMouseMove(event) { if (!isResizing || !currentResizableCol) return; const diffX = event.pageX - startX; let newWidth = startColWidth + diffX; if (newWidth < MIN_COL_WIDTH) newWidth = MIN_COL_WIDTH; currentResizableCol.style.width = `${newWidth}px`; }
function handleMouseUp() { if (!isResizing) return; /* console.log("End resize"); */ isResizing = false; document.body.style.cursor = 'default'; document.removeEventListener('mousemove', handleMouseMove); if (currentResizableCol) { saveColumnWidths(); } else { console.warn("MouseUp but no currentResizableCol?"); } currentResizableTh = null; currentResizableCol = null; startX = 0; startColWidth = 0; }

// --- Theme Logic ---
function getCurrentTheme() { const savedTheme = getCookie(THEME_COOKIE_NAME); if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme; return 'light'; }
function applyTheme(theme) { const body = document.body; if (!body) return; if (theme === 'dark') { body.classList.add('dark-theme'); body.classList.remove('light-theme'); if (themeCheckbox) themeCheckbox.checked = true; } else { body.classList.add('light-theme'); body.classList.remove('dark-theme'); if (themeCheckbox) themeCheckbox.checked = false; } }
function saveThemePreference(theme) { const themeToSave = (theme === 'dark' || theme === 'light') ? theme : 'light'; setCookie(THEME_COOKIE_NAME, themeToSave, 365); }
function handleThemeToggle() { if (!themeCheckbox) return; const newTheme = themeCheckbox.checked ? 'dark' : 'light'; applyTheme(newTheme); saveThemePreference(newTheme); }

// --- Column Visibility Logic ---
function applyVisibilityState() { if (!table || !colgroup || !firstHeaderRow || !filterHeaderRow || !tableBody || !Array.isArray(columnVisibilityState)) { console.error("Cannot apply visibility: Missing elements/state."); return; } let visibleColumnCount = 0; columnVisibilityState.forEach((isVisible, index) => { const displayStyle = isVisible ? '' : 'none'; const colEl = colgroup.children[index]; if (colEl) colEl.style.display = displayStyle; const th1El = firstHeaderRow.children[index]; if (th1El) th1El.style.display = displayStyle; const th2El = filterHeaderRow.children[index]; if (th2El) th2El.style.display = displayStyle; if (isVisible) visibleColumnCount++; }); const placeholderRows = tableBody.querySelectorAll('td[colspan]'); placeholderRows.forEach(td => { td.colSpan = visibleColumnCount || 1; }); /* console.log("Applied visibility. Visible:", visibleColumnCount); */ }
function saveVisibilityState() { const currentVisibility = []; const toggles = columnToggleList.querySelectorAll('input[type="checkbox"]'); toggles.forEach(checkbox => { currentVisibility.push(checkbox.checked); }); setCookie(COLUMN_VISIBILITY_COOKIE_NAME, currentVisibility, 365); }
function handleVisibilityToggle(event) { const checkbox = event.target; const colIndex = parseInt(checkbox.dataset.colIndex, 10); if (isNaN(colIndex)) { console.error("Invalid col index on visibility toggle."); return; } columnVisibilityState[colIndex] = checkbox.checked; applyVisibilityState(); renderTable(filterHostData(allHostsData, getFilterValues())); saveVisibilityState(); }
function generateVisibilityToggles() { if (!columnToggleList || !firstHeaderRow || !colgroup) { console.error("Cannot generate visibility toggles."); return; } columnToggleList.innerHTML = ''; columnVisibilityState = []; const savedVisibility = getCookie(COLUMN_VISIBILITY_COOKIE_NAME); const numCols = colgroup.children.length; const headers = firstHeaderRow.querySelectorAll('th'); headers.forEach((th, index) => { const isInitiallyVisible = (Array.isArray(savedVisibility) && savedVisibility.length === numCols) ? savedVisibility[index] : true; columnVisibilityState.push(isInitiallyVisible); const colText = th.textContent.trim() || `Col ${index}`; const listItem = document.createElement('li'); const label = document.createElement('label'); label.className = 'col-toggle-label'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = isInitiallyVisible; checkbox.dataset.colIndex = index; checkbox.addEventListener('change', handleVisibilityToggle); label.appendChild(checkbox); label.appendChild(document.createTextNode(` ${colText}`)); listItem.appendChild(label); columnToggleList.appendChild(listItem); }); console.log("Initial column visibility state:", columnVisibilityState); applyVisibilityState(); }


// --- Event Listeners & Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing...");
    // Get DOM References
    table = document.getElementById('hosts-table'); colgroup = table ? table.querySelector('colgroup') : null; tableBody = table ? table.querySelector('tbody') : null;
    firstHeaderRow = table ? table.querySelector('thead tr:first-child') : null; filterHeaderRow = document.getElementById('filter-row');
    lastUpdatedDiv = document.getElementById('last-updated'); refreshCheckbox = document.getElementById('auto-refresh-checkbox');
    themeCheckbox = document.getElementById('theme-switch-checkbox'); refreshIntervalInput = document.getElementById('refresh-interval-input');
    columnToggleList = document.getElementById('column-toggle-list');

    // Critical check
    if (!table || !colgroup || !tableBody || !firstHeaderRow || !filterHeaderRow || !refreshCheckbox || !lastUpdatedDiv || !themeCheckbox || !refreshIntervalInput || !columnToggleList) { console.error("CRITICAL ERROR: Essential DOM elements missing!"); if(document.body) document.body.innerHTML = '<h1>Interface Init Error!</h1>'; return; }

    // Initial Setup
    const initialTheme = getCurrentTheme(); applyTheme(initialTheme); // Apply theme
    generateVisibilityToggles(); // Generate/Load/Apply column visibility **before** widths
    loadAndApplyColumnWidths(); // Load/apply widths
    loadInitialRefreshState(); // Setup refresh state/timer

    // Add Event Listeners
    document.querySelectorAll('#filter-row .filter-input').forEach(input => { input.addEventListener('input', applyFiltersAndRender); });
    if (tableHead) { tableHead.addEventListener('mousedown', handleMouseDown); } else { console.error("Thead not found for resize listener."); } // Use stored ref tableHead
    if (tableBody) { tableBody.addEventListener('click', (event) => { const t = event.target; if (t.tagName === 'TD' && t.classList.contains('known-toggle')) {/* Handled by switch change */} else if (t.classList.contains('delete-icon')) handleDeleteHost(t); }); tableBody.addEventListener('dblclick', (event) => { const t = event.target; if (t.tagName === 'TD' && t.classList.contains('editable-cell')) makeCellEditable(t); }); tableBody.addEventListener('change', (event) => { const t = event.target; if (t.tagName === 'INPUT' && t.type === 'checkbox' && t.classList.contains('known-switch-checkbox')) handleKnownSwitchChange(event); }); } else { console.error("Tbody not found."); }
    refreshCheckbox.addEventListener('change', handleRefreshToggleChange); themeCheckbox.addEventListener('change', handleThemeToggle); refreshIntervalInput.addEventListener('change', handleRefreshIntervalChange);
    // Visibility toggle listeners added in generateVisibilityToggles

    // Initial Data Load
    fetchDataAndUpdate();

    console.log("Initialization complete.");
});

// --- Assign tableHead after table is defined in DOMContentLoaded ---
let tableHead = null;
document.addEventListener('DOMContentLoaded', () => {
     tableHead = table ? table.querySelector('thead') : null; // Assign here
     if (tableHead) {
        tableHead.addEventListener('mousedown', handleMouseDown);
     } else if(table) { // Check if table exists but thead doesn't (unlikely)
         console.error("Thead element not found within the table.");
     }
});
// End of static/script.js
