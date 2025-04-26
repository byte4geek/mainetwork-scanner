// ==================================================
// static/script.js - COMPLETE & VERIFIED (v14 - EN, Hostname Placeholder Fix)
// Includes: Filters, Known Switch, Delete, Inline Edit (Hostname/Note), Theme Toggle,
//           Refresh Toggle/Interval, Col Resizing, Col Visibility
// ==================================================

// --- Global Variables & Constants ---
let allHostsData = []; let refreshIntervalId = null; let isAutoRefreshEnabled = false;
let currentRefreshIntervalMs = 10000; const COL_WIDTH_COOKIE_NAME = 'networkScannerColWidths';
const THEME_COOKIE_NAME = 'networkScannerTheme'; const REFRESH_INTERVAL_COOKIE_NAME = 'networkScannerRefreshInterval';
const COLUMN_VISIBILITY_COOKIE_NAME = 'networkScannerColVisibility'; const MIN_REFRESH_INTERVAL_S = 5;
const MIN_COL_WIDTH = 40; let columnVisibilityState = [];

// Resizing state variables
let isResizing = false; let currentResizableTh = null; let currentResizableCol = null;
let startX = 0, startColWidth = 0;

// DOM References
let table = null; let colgroup = null; let tableBody = null; let firstHeaderRow = null; let filterHeaderRow = null;
let lastUpdatedDiv = null; let refreshCheckbox = null; let themeCheckbox = null; let refreshIntervalInput = null;
let columnToggleList = null;

// --- Cookie Functions ---
function setCookie(name, value, days) { let expires = ""; if (days) { const date = new Date(); date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000)); expires = "; expires=" + date.toUTCString(); } try { const vts = typeof value === 'string' ? value : JSON.stringify(value); const ev = encodeURIComponent(vts); document.cookie = name + "=" + ev + expires + "; path=/; SameSite=Lax;"; } catch (e) { console.error(`Error setting cookie ${name}:`, e); } }
function getCookie(name) { const nameEQ = name + "="; const ca = document.cookie.split(';'); for (let i = 0; i < ca.length; i++) { let c = ca[i]; while (c.charAt(0) === ' ') c = c.substring(1, c.length); if (c.indexOf(nameEQ) === 0) { const ev = c.substring(nameEQ.length, c.length); try { const dv = decodeURIComponent(ev); try { return JSON.parse(dv); } catch (j) { return dv; } } catch (e) { console.error(`Error decoding cookie ${name}:`, e); return null; } } } return null; }

// --- UI Update Functions ---
function updateTimestamp(apiFetchTime = true) { if (!lastUpdatedDiv) return; const now = new Date(); const prefix = apiFetchTime ? "Server data updated at: " : "Filter/UI updated at: "; lastUpdatedDiv.textContent = `${prefix}${now.toLocaleTimeString()}`; }
function getFilterValues() { const filters = {}; document.querySelectorAll('#filter-row .filter-input').forEach(input => { filters[input.id.replace('filter-', '')] = input.value.trim().toLowerCase(); }); return filters; }
function filterHostData(hosts, filters) { if (!Array.isArray(hosts)) return []; const noFiltersActive = Object.values(filters).every(val => val === ''); if (noFiltersActive) return hosts; return hosts.filter(host => { for (const key in filters) { const filterValue = filters[key]; if (filterValue !== '') { if (key === 'known_host') { const knownData = host[key]; let matches = false; if ((filterValue === 'yes' || filterValue === '1') && knownData == 1) matches = true; else if ((filterValue === 'no' || filterValue === '0') && knownData == 0) matches = true; if (!matches) return false; } else { const hostValue = String(host[key] || '').toLowerCase(); if (!hostValue.includes(filterValue)) return false; } } } return true; }); }
const formatTimestamp = (tsString) => { if (!tsString) return 'N/A'; try { const dateObj = new Date(tsString.replace(' ', 'T')); if (isNaN(dateObj)) return 'Invalid Date'; return dateObj.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); } catch (e) { console.warn("Timestamp format err:", tsString, e); return tsString; } };

// Render Table Function (with Hostname Placeholder)
function renderTable(hostsToRender) {
    if (!tableBody || !firstHeaderRow || !Array.isArray(columnVisibilityState)) { console.error("Cannot render table: Missing elements or state."); if(tableBody) tableBody.innerHTML = '<tr><td colspan="12">Table Render Error!</td></tr>'; return; }
    tableBody.innerHTML = '';
    const visibleColumnCount = columnVisibilityState.filter(isVisible => isVisible).length;
    if (!Array.isArray(hostsToRender) || hostsToRender.length === 0) { tableBody.innerHTML = `<tr><td colspan="${visibleColumnCount || 12}">No hosts found or matching filters.</td></tr>`; }
    else {
        hostsToRender.forEach(host => {
            try {
                const row = tableBody.insertRow();
                const addCell = (index, contentCallback) => { const cell = row.insertCell(index); cell.style.display = (columnVisibilityState[index] === false) ? 'none' : ''; if (contentCallback) { contentCallback(cell, host); } return cell; };
                // Cells using addCell helper...
                addCell(0, (cell, host) => { cell.classList.add('action-cell'); const dI = document.createElement('span'); dI.className = 'mdi mdi-delete delete-icon'; dI.title = `Delete ${host.ip_address}`; dI.dataset.ip = host.ip_address; cell.appendChild(dI); });
                addCell(1, (cell, host) => { cell.textContent = host.ip_address || 'N/D'; });
                addCell(2, (cell, host) => { cell.textContent = host.mac_address || 'N/D'; });
                addCell(3, (cell, host) => { cell.textContent = host.vendor || 'N/D'; });
                addCell(4, (cell, host) => { const hn = host.hostname || ''; cell.classList.add('editable-cell'); cell.dataset.ip = host.ip_address; cell.dataset.field = 'hostname'; if (hn) { cell.textContent = hn; cell.classList.remove('hostname-placeholder'); } else { cell.textContent = '2clicks2edit'; cell.classList.add('hostname-placeholder'); } });
                addCell(5, (cell, host) => { cell.classList.add('known-cell'); const isK = host.known_host == 1; const sL = document.createElement('label'); sL.className = 'switch'; const sC = document.createElement('input'); sC.type = 'checkbox'; sC.checked = isK; sC.dataset.ip = host.ip_address; sC.classList.add('known-switch-checkbox'); const sS = document.createElement('span'); sS.className = 'slider'; sL.appendChild(sC); sL.appendChild(sS); cell.appendChild(sL); });
                addCell(6, (cell, host) => { cell.textContent = host.status || 'N/D'; cell.className = host.status === 'ONLINE' ? 'status-online' : 'status-offline'; });
                addCell(7, (cell, host) => { cell.textContent = host.ports || ''; });
                // addCell(8, (cell, host) => { const nt = host.note || ''; cell.classList.add('editable-cell'); cell.dataset.ip = host.ip_address; cell.dataset.field = 'note'; cell.textContent = nt; /* Placeholder logic optional */ });
                addCell(8, (cell, host) => { const nt = host.note || ''; cell.classList.add('editable-cell'); cell.dataset.ip = host.ip_address; cell.dataset.field = 'note'; if (nt) { cell.textContent = nt; cell.classList.remove('hostname-placeholder'); } else { cell.textContent = '2clicks2edit'; cell.classList.add('hostname-placeholder'); } });
                addCell(9, (cell, host) => { cell.textContent = formatTimestamp(host.first_seen); });
                addCell(10, (cell, host) => { cell.textContent = formatTimestamp(host.last_seen_online); });
                addCell(11, (cell, host) => { cell.textContent = formatTimestamp(host.last_updated); });
            } catch (rowError){ console.error("Error rendering row:", host, rowError); const eR = tableBody.insertRow(-1); const eC = eR.insertCell(); eC.colSpan = visibleColumnCount || 12; eC.textContent = `Err row ${host?.ip_address || '?'}`; eC.style.color = 'red'; }
        });
    }
}

function applyFiltersAndRender() { try { const filters = getFilterValues(); const filteredHosts = filterHostData(allHostsData, filters); renderTable(filteredHosts); updateTimestamp(false); } catch(e) { console.error("Error apply/render:", e); } }

// --- API and Action Functions ---
async function fetchDataAndUpdate() { if (!tableBody) { console.error("No tbody"); return;} try { const response = await fetch('/api/hosts'); if (!response.ok) { let e = `HTTP ${response.status}`; try{const d=await response.json();if(d.error)e+=`: ${d.error}`}catch(er){} throw new Error(e); } const data = await response.json(); if (Array.isArray(data)) { allHostsData = data; applyFiltersAndRender(); updateTimestamp(true); } else if (data && data.error) { throw new Error(`API Err: ${data.error}`); } else { throw new Error("Invalid API rsp."); } } catch (error) { console.error("Fetch err:", error); if(tableBody) tableBody.innerHTML = `<tr><td colspan="12">Load err: ${error.message}</td></tr>`; allHostsData = []; } }
async function handleKnownSwitchChange(event) { const checkbox = event.target; const ip = checkbox.dataset.ip; const newState = checkbox.checked ? 1 : 0; if (!ip) { console.error("Known switch IP missing"); return; } checkbox.disabled = true; try { const response = await fetch(`/api/hosts/${ip}/known`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ known: newState }) }); const result = await response.json(); if (!response.ok || !result.success) { checkbox.checked = !checkbox.checked; throw new Error(result.error || `Server error ${response.status}`); } const hostIndex = allHostsData.findIndex(h => h.ip_address === ip); if (hostIndex > -1) allHostsData[hostIndex].known_host = newState; } catch (error) { console.error(`Known update err ${ip}:`, error); alert(`DB Error: ${error.message}`); checkbox.checked = !checkbox.checked; } finally { checkbox.disabled = false; } }
async function handleDeleteHost(targetIcon) { const ip = targetIcon.dataset.ip; if (!ip) { console.error("Del icon IP missing"); return; } if (!window.confirm(`Confirm delete host ${ip}?`)) return; targetIcon.style.opacity = "0.5"; targetIcon.style.pointerEvents = "none"; try { const response = await fetch(`/api/hosts/${ip}`, { method: 'DELETE' }); let errorMsg = `Server error ${response.status}`; if (!response.ok) { try { const result = await response.json(); if(result.error) errorMsg = result.error; } catch(e) {} throw new Error(errorMsg); } console.log(`Host ${ip} deleted.`); const rowToRemove = targetIcon.closest('tr'); if (rowToRemove) rowToRemove.remove(); allHostsData = allHostsData.filter(host => host.ip_address !== ip); updateTimestamp(false); } catch (error) { console.error(`Del error ${ip}:`, error); alert(`Del error: ${error.message}`); targetIcon.style.opacity = "1"; targetIcon.style.pointerEvents = "auto"; } }

// --- Inline Editing Functions ---
function makeCellEditable(cell) { if (document.querySelector('.inline-edit-input')) return; const originalValue = cell.textContent; const ip = cell.dataset.ip; const field = cell.dataset.field; if (!ip || !field) { console.error("Edit cell data missing"); return;} const input = document.createElement('input'); input.type = 'text'; input.className = 'inline-edit-input'; input.value = originalValue; input.dataset.ip = ip; input.dataset.field = field; input.dataset.originalValue = originalValue; cell.innerHTML = ''; cell.appendChild(input); input.focus(); input.select(); input.addEventListener('blur', handleSaveCellEdit, { once: true }); input.addEventListener('keydown', handleEditInputKeydown); }
function handleEditInputKeydown(event) { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } else if (event.key === 'Escape') { cancelCellEdit(event.target); } }
async function handleSaveCellEdit(event) { const input = event.target; input.removeEventListener('keydown', handleEditInputKeydown); const newValue = input.value.trim(); const originalValue = input.dataset.originalValue; const ip = input.dataset.ip; const field = input.dataset.field; const cell = input.parentNode; input.remove(); cell.textContent = originalValue; if (newValue === originalValue) { cell.style.cursor = "text"; return; } cell.style.cursor = "wait"; try { const response = await fetch(`/api/hosts/${ip}/update`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ field: field, value: newValue }) }); const result = await response.json(); if (!response.ok || !result.success) { throw new Error(result.error || `Server error ${response.status}`); } console.log(`Updated ${field} for ${ip}`); cell.textContent = newValue; const hostIndex = allHostsData.findIndex(h => h.ip_address === ip); if (hostIndex > -1) allHostsData[hostIndex][field] = newValue; } catch (error) { console.error(`Save error ${field} ${ip}:`, error); alert(`Save error: ${error.message}`); cell.textContent = originalValue; } finally { cell.style.cursor = "text"; } }
function cancelCellEdit(input) { const originalValue = input.dataset.originalValue; const cell = input.parentNode; input.removeEventListener('blur', handleSaveCellEdit); input.removeEventListener('keydown', handleEditInputKeydown); input.remove(); cell.textContent = originalValue; cell.style.cursor = "text"; }

// --- Auto Refresh Logic ---
function stopAutoRefreshInterval() { if (refreshIntervalId !== null) { clearInterval(refreshIntervalId); refreshIntervalId = null; /* console.log("Refresh stopped."); */ } }
function startAutoRefreshInterval() { stopAutoRefreshInterval(); if (isAutoRefreshEnabled) { /* console.log(`Starting refresh: ${currentRefreshIntervalMs}ms`); */ fetchDataAndUpdate(); refreshIntervalId = setInterval(fetchDataAndUpdate, currentRefreshIntervalMs); } }
function handleRefreshToggleChange() { if (!refreshCheckbox) return; isAutoRefreshEnabled = refreshCheckbox.checked; console.log(`Auto-refresh: ${isAutoRefreshEnabled ? 'ON' : 'OFF'}`); if (isAutoRefreshEnabled) startAutoRefreshInterval(); else stopAutoRefreshInterval(); }
function handleRefreshIntervalChange() { if (!refreshIntervalInput) return; let newIntervalS = parseInt(refreshIntervalInput.value, 10); if (isNaN(newIntervalS) || newIntervalS < MIN_REFRESH_INTERVAL_S) { newIntervalS = MIN_REFRESH_INTERVAL_S; refreshIntervalInput.value = newIntervalS; console.warn(`Interval set min ${MIN_REFRESH_INTERVAL_S}s`); } currentRefreshIntervalMs = newIntervalS * 1000; console.log(`Refresh interval: ${newIntervalS}s`); setCookie(REFRESH_INTERVAL_COOKIE_NAME, newIntervalS, 365); if (isAutoRefreshEnabled) startAutoRefreshInterval(); }
function loadInitialRefreshState() { const savedIntervalS = getCookie(REFRESH_INTERVAL_COOKIE_NAME); let initialIntervalS = 10; if (savedIntervalS !== null) { const parsedInterval = parseInt(savedIntervalS, 10); if (!isNaN(parsedInterval) && parsedInterval >= MIN_REFRESH_INTERVAL_S) initialIntervalS = parsedInterval; } currentRefreshIntervalMs = initialIntervalS * 1000; if(refreshIntervalInput) refreshIntervalInput.value = initialIntervalS; isAutoRefreshEnabled = refreshCheckbox ? refreshCheckbox.checked : false; console.log(`Initial interval: ${initialIntervalS}s / Auto-refresh: ${isAutoRefreshEnabled}`); /* Start timer handled in DOMContentLoaded */ }

// --- Column Resizing Logic ---
function applyColumnWidths(widths) { if (!colgroup || !widths || !Array.isArray(widths) || widths.length !== colgroup.children.length) { console.warn("applyColWidths: Invalid data."); return; } Array.from(colgroup.children).forEach((col, index) => { const w = parseInt(widths[index], 10); if (!isNaN(w) && w >= MIN_COL_WIDTH) { col.style.width = `${w}px`; } else { col.style.width = ''; } }); }
function saveColumnWidths() { if (!colgroup) return; const widths = Array.from(colgroup.children).map(col => parseInt(window.getComputedStyle(col).width, 10)); const validWidths = widths.filter(w => !isNaN(w) && w >= MIN_COL_WIDTH); if(validWidths.length === colgroup.children.length) { setCookie(COL_WIDTH_COOKIE_NAME, validWidths, 30); } else { console.warn("Cannot save widths.", widths); } }
function loadAndApplyColumnWidths() { const savedWidths = getCookie(COL_WIDTH_COOKIE_NAME); if (savedWidths && Array.isArray(savedWidths)) { /* console.log("Loaded widths:", savedWidths); */ applyColumnWidths(savedWidths); } else { /* console.log("No widths cookie."); */ } }
function handleMouseDown(event) { const target = event.target; const headerCell = target.closest('th.resizable-th'); if (!headerCell) return; const isResizer = target.classList.contains('resizer'); const rect = headerCell.getBoundingClientRect(); const isNearEdge = event.clientX > rect.right - 10 && event.clientX <= rect.right + 5; const hasResizer = headerCell.querySelector('.resizer'); if ((isResizer || isNearEdge) && hasResizer) { currentResizableTh = headerCell; const thIndex = Array.from(currentResizableTh.parentNode.children).indexOf(currentResizableTh); if (colgroup && colgroup.children[thIndex]) { currentResizableCol = colgroup.children[thIndex]; startColWidth = parseInt(window.getComputedStyle(currentResizableCol).width, 10); } else { console.error("Col not found:", thIndex); return; } isResizing = true; startX = event.pageX; document.body.style.cursor = 'col-resize'; document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp, { once: true }); event.preventDefault(); } }
function handleMouseMove(event) { if (!isResizing || !currentResizableCol) return; const diffX = event.pageX - startX; let newWidth = startColWidth + diffX; if (newWidth < MIN_COL_WIDTH) newWidth = MIN_COL_WIDTH; currentResizableCol.style.width = `${newWidth}px`; }
function handleMouseUp() { if (!isResizing) return; isResizing = false; document.body.style.cursor = 'default'; document.removeEventListener('mousemove', handleMouseMove); if (currentResizableCol) { saveColumnWidths(); } else { console.warn("MouseUp no currentResizableCol?"); } currentResizableTh = null; currentResizableCol = null; startX = 0; startColWidth = 0; }

// --- Theme Logic ---
function getCurrentTheme() { const savedTheme = getCookie(THEME_COOKIE_NAME); if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme; return 'light'; }
function applyTheme(theme) { const body = document.body; if (!body) return; if (theme === 'dark') { body.classList.add('dark-theme'); body.classList.remove('light-theme'); if (themeCheckbox) themeCheckbox.checked = true; } else { body.classList.add('light-theme'); body.classList.remove('dark-theme'); if (themeCheckbox) themeCheckbox.checked = false; } }
function saveThemePreference(theme) { const themeToSave = (theme === 'dark' || theme === 'light') ? theme : 'light'; setCookie(THEME_COOKIE_NAME, themeToSave, 365); }
function handleThemeToggle() { if (!themeCheckbox) return; const newTheme = themeCheckbox.checked ? 'dark' : 'light'; applyTheme(newTheme); saveThemePreference(newTheme); }

// --- Column Visibility Logic ---
function applyVisibilityState() { if (!colgroup || !firstHeaderRow || !filterHeaderRow || !tableBody || !Array.isArray(columnVisibilityState)) { console.error("Cannot apply visibility."); return; } const expectedCols = colgroup.children.length; if (columnVisibilityState.length !== expectedCols) { console.error(`Vis state len (${columnVisibilityState.length}) != col len (${expectedCols})!`); while(columnVisibilityState.length < expectedCols) columnVisibilityState.push(true); if(columnVisibilityState.length > expectedCols) columnVisibilityState = columnVisibilityState.slice(0, expectedCols); console.warn("Corrected vis state:", columnVisibilityState); } let visibleCols = 0; columnVisibilityState.forEach((isVisible, index) => { const disp = isVisible ? '' : 'none'; try { const colEl = colgroup.children[index]; if (colEl) colEl.style.display = disp; const th1El = firstHeaderRow.children[index]; if (th1El) th1El.style.display = disp; const th2El = filterHeaderRow.children[index]; if (th2El) th2El.style.display = disp; if (isVisible) visibleCols++; } catch (e) { console.error(`Vis error col ${index}:`, e); } }); const phRows = tableBody.querySelectorAll('td[colspan]'); phRows.forEach(td => { td.colSpan = visibleCols || 1; }); }
function saveVisibilityState() { const currentVisibility = []; const toggles = columnToggleList.querySelectorAll('input[type="checkbox"]'); toggles.forEach(checkbox => { currentVisibility.push(checkbox.checked); }); if (colgroup && currentVisibility.length === colgroup.children.length) { setCookie(COLUMN_VISIBILITY_COOKIE_NAME, currentVisibility, 365); } else { console.warn(`Vis save fail: len mismatch.`); } }
function handleVisibilityToggle(event) { const checkbox = event.target; const colIndex = parseInt(checkbox.dataset.colIndex, 10); if (isNaN(colIndex) || colIndex < 0 || colIndex >= columnVisibilityState.length) { console.error("Invalid col index vis toggle:", checkbox.dataset.colIndex); return; } columnVisibilityState[colIndex] = checkbox.checked; applyVisibilityState(); renderTable(filterHostData(allHostsData, getFilterValues())); saveVisibilityState(); }
function generateVisibilityToggles() { if (!columnToggleList || !firstHeaderRow || !colgroup) { console.error("Cannot generate vis toggles."); return; } columnToggleList.innerHTML = ''; columnVisibilityState = []; const savedVisibility = getCookie(COLUMN_VISIBILITY_COOKIE_NAME); const numCols = colgroup.children.length; const headers = firstHeaderRow.querySelectorAll('th'); const limit = Math.min(numCols, headers.length); /* console.log(`Generating vis toggles for ${limit} columns.`); */ for (let index = 0; index < limit; index++) { const th = headers[index]; const isInitiallyVisible = (Array.isArray(savedVisibility) && savedVisibility.length === limit) ? savedVisibility[index] : true; columnVisibilityState.push(isInitiallyVisible); const colText = th.textContent.trim() || `Col ${index}`; const listItem = document.createElement('li'); const label = document.createElement('label'); label.className = 'col-toggle-label'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = isInitiallyVisible; checkbox.dataset.colIndex = index; checkbox.addEventListener('change', handleVisibilityToggle); label.appendChild(checkbox); label.appendChild(document.createTextNode(` ${colText}`)); listItem.appendChild(label); columnToggleList.appendChild(listItem); } if(limit !== numCols || limit !== headers.length) { console.warn(`Mismatch: cols=${numCols}, headers=${headers.length}.`); } /* console.log("Initial visibility state:", columnVisibilityState); */ applyVisibilityState(); }

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

    // Initial Setup (Order matters)
    const initialTheme = getCurrentTheme(); applyTheme(initialTheme);
    generateVisibilityToggles(); // Setup visibility controls and state
    loadAndApplyColumnWidths();  // Load widths after visibility is known
    loadInitialRefreshState(); // Setup refresh interval/state

    // Add Event Listeners
    document.querySelectorAll('#filter-row .filter-input').forEach(input => { input.addEventListener('input', applyFiltersAndRender); });
    if (firstHeaderRow) { firstHeaderRow.addEventListener('mousedown', handleMouseDown); } else { console.error("Thead first row not found."); }
    if (tableBody) { tableBody.addEventListener('click', (event) => { const t = event.target; if (t.classList.contains('delete-icon')) handleDeleteHost(t); }); tableBody.addEventListener('dblclick', (event) => { const t = event.target; if (t.tagName === 'TD' && t.classList.contains('editable-cell')) makeCellEditable(t); }); tableBody.addEventListener('change', (event) => { const t = event.target; if (t.tagName === 'INPUT' && t.type === 'checkbox' && t.classList.contains('known-switch-checkbox')) handleKnownSwitchChange(event); }); } else { console.error("Tbody not found."); }
    refreshCheckbox.addEventListener('change', handleRefreshToggleChange); themeCheckbox.addEventListener('change', handleThemeToggle); refreshIntervalInput.addEventListener('change', handleRefreshIntervalChange);
    // Visibility listeners added in generateVisibilityToggles

    // Initial Data Load
    fetchDataAndUpdate();

    console.log("Initialization complete.");
});
// End of static/script.js
