// ==================================================
// static/history.js - COMPLETE, VERIFIED (v14 - EN)
// JS for the History Page (Table Layout, Delete History, Refresh Cookie)
// ==================================================

let allHistoryData = {}; // Store fetched data { ip: {hostname: '..', events: [...] } }
let filteredHistoryData = {}; // Store filtered data

// --- Global Variables & Constants ---
let refreshIntervalId = null;
let isAutoRefreshEnabled = false; // Default to disabled
let currentRefreshIntervalMs = 60000; // Default 60s for history page
const REFRESH_INTERVAL_COOKIE_NAME = 'networkScannerRefreshIntervalHistory'; // Separate cookie
const MIN_REFRESH_INTERVAL_S = 10; // Higher minimum for history page

// --- DOM References ---
let tableBody = null;
let lastUpdatedDiv = null;
let refreshCheckbox = null;
let refreshIntervalInput = null;
let ipFilterInput = null;
let hostnameFilterInput = null;
let startDateInput = null; // NEW
let endDateInput = null;   // NEW
let clearHistoryButton = null; // NEW


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
        document.cookie = name + "=" + encodedValue + expires + "; path=/; SameSite=Lax;";
        // console.log(`Cookie set: ${name}`);
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
                try { return JSON.parse(decodedValue); }
                catch (jsonError) { return decodedValue; } // Return string if not JSON
            } catch (e) { console.error("Error decoding cookie:", name, e); return null; }
        }
    }
    return null;
}

// --- Helper Functions ---
function updateTimestamp(apiFetchTime = true) {
    if (!lastUpdatedDiv) return;
    const now = new Date();
    const prefix = apiFetchTime ? "Server data updated at: " : "Filter applied at: ";
    lastUpdatedDiv.textContent = `${prefix}${now.toLocaleTimeString()}`;
}

function formatTimestampForDisplay(isoString) {
    if (!isoString) return 'N/A';
    try {
        const dateObj = new Date(isoString); // Parses ISO UTC string
        if (isNaN(dateObj)) return 'Invalid Date';
        // Display in user's locale time zone
        return dateObj.toLocaleString(undefined, {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        console.warn("Error formatting timestamp:", isoString, e);
        return isoString; // Fallback
    }
}

function formatTimestampForTooltip(isoString) { // Slightly more detail for tooltip
    if (!isoString) return 'N/A';
    try { const dateObj = new Date(isoString); if (isNaN(dateObj)) return 'Invalid Date'; return dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }); }
    catch (e) { return isoString; }
}

// --- Filtering Logic (CORRECT UTC Conversion) ---
function getHistoryFilters() {
    let startDateUTC = null;
    if (startDateInput?.value) {
        // 1. Parse the local datetime string into a local Date object
        const localStartDate = new Date(startDateInput.value);
        if (!isNaN(localStartDate)) {
            // 2. Convert the local Date object to a UTC timestamp (milliseconds since epoch)
            //    Then create a new Date object FROM that UTC timestamp. This object
            //    internally represents the correct point in UTC time.
            startDateUTC = new Date(localStartDate.getTime()); // getTime() is always UTC milliseconds
            // console.log("Start Date Input:", startDateInput.value, "Parsed Local:", localStartDate, "Converted UTC:", startDateUTC);
        }
    }

    let endDateUTC = null;
    if (endDateInput?.value) {
        const localEndDate = new Date(endDateInput.value);
        if (!isNaN(localEndDate)) {
            // Make range inclusive: go to the *end* of the selected minute or second
             localEndDate.setSeconds(59, 999); // End of the selected second
            endDateUTC = new Date(localEndDate.getTime());
            // console.log("End Date Input:", endDateInput.value, "Parsed Local:", localEndDate, "Converted UTC:", endDateUTC);
        }
    }

    const filters = {
        ip: ipFilterInput?.value.trim().toLowerCase() || '',
        hostname: hostnameFilterInput?.value.trim().toLowerCase() || '',
        start: startDateUTC, // Store UTC Date object or null
        end: endDateUTC     // Store UTC Date object or null
    };
    return filters;
}

function filterAndRender() {
    const filters = getHistoryFilters();
    // Filter hosts based on IP/Hostname
    filteredHostsList = Object.keys(allHistoryData).filter(ip => {
        const hostData = allHistoryData[ip];
        const ipMatch = !filters.ip || ip.toLowerCase().includes(filters.ip);
        const hostnameMatch = !filters.hostname || (hostData.hostname && hostData.hostname.toLowerCase().includes(filters.hostname));
        return ipMatch && hostnameMatch;
    });
    // Render table, passing UTC date filters
    renderHistoryTable(filters.start, filters.end);
    updateTimestamp(false);
}


// --- Rendering Logic (Compares against UTC filters) ---
function renderHistoryTable(filterStartDateUTC, filterEndDateUTC) { // Receive UTC Date objects
    if (!tableBody) { console.error("History table body not found!"); return; }
    tableBody.innerHTML = '';

    const sortedIPs = filteredHostsList.sort((a, b) => { /* ... IP sort ... */ try { const numA = a.split('.').reduce((acc, octet)=>(acc<<8)+parseInt(octet,10),0); const numB = b.split('.').reduce((acc, octet)=>(acc<<8)+parseInt(octet,10),0); return numA - numB; } catch (e) { return 0; }});

    if (sortedIPs.length === 0) { tableBody.innerHTML = '<tr><td colspan="4">No hosts match current filters.</td></tr>'; return; }

    sortedIPs.forEach(ip => {
        const hostData = allHistoryData[ip];
        const row = tableBody.insertRow();
        // Delete, IP, Hostname cells...
        const deleteCell = row.insertCell(0); /* ... */ deleteCell.classList.add('action-cell'); const deleteIcon = document.createElement('span'); deleteIcon.className = 'mdi mdi-delete delete-icon history-delete-icon'; deleteIcon.title = `Delete history for ${ip}`; deleteIcon.dataset.ip = ip; deleteCell.appendChild(deleteIcon);
        row.insertCell(1).textContent = ip; row.insertCell(2).textContent = hostData.hostname || '';

        // Timeline Bar Cell
        const timelineCell = row.insertCell(3); timelineCell.classList.add('timeline-bar-cell');
        const barContainer = document.createElement('div'); barContainer.className = 'timeline-bar-container';

        // Filter events based on UTC date range
        const eventsToDisplay = (hostData.events || []).filter(event => {
            if (!event.event_time) return false;
            try {
                const eventDate = new Date(event.event_time); // Parses ISO UTC string into Date obj (representing UTC)
                if (isNaN(eventDate)) return false;
                // Compare eventDate (UTC) with filterStartDateUTC / filterEndDateUTC (also UTC)
                const afterStart = !filterStartDateUTC || eventDate >= filterStartDateUTC;
                const beforeEnd = !filterEndDateUTC || eventDate <= filterEndDateUTC;
                return afterStart && beforeEnd;
            } catch (e) { console.warn("Error parsing event date:", event.event_time, e); return false; }
        }).sort((a,b) => new Date(a.event_time) - new Date(b.event_time)); // Sort filtered

        if (eventsToDisplay.length > 0) {
            eventsToDisplay.forEach(event => {
                const segment = document.createElement('div'); segment.className = 'timeline-segment'; segment.classList.add(event.status === 1 ? 'online' : 'offline');
                const tooltip = document.createElement('span'); tooltip.className = 'tooltiptext'; tooltip.textContent = `${event.status === 1 ? 'Online' : 'Offline'} at ${formatTimestampForTooltip(event.event_time)}`; segment.appendChild(tooltip); barContainer.appendChild(segment);
            });
        } else { barContainer.textContent = "No events in selected range."; barContainer.style.cssText = "text-align: center; color: var(--text-muted-color); font-size: 0.9em; padding: 2px;"; }
        timelineCell.appendChild(barContainer);
    });
}

// --- Fetching Data ---
async function fetchHistoryData() {
    console.log("Fetching history data...");
    if (!tableBody) { console.error("Cannot fetch: tableBody not found."); return;}
    try { const response = await fetch('/api/history'); if (!response.ok) { let e = `HTTP error ${response.status}`; try{const d=await response.json();if(d.error)e+=`: ${d.error}`}catch(er){} throw new Error(e); }
        allHistoryData = await response.json(); // Store ALL data
        console.log(`Fetched history for ${Object.keys(allHistoryData).length} hosts.`);
        filterAndRender(); // Apply initial filters (which might be empty) and render
        updateTimestamp(true);
    } catch (error) { console.error("Error fetching history data:", error); if(tableBody) tableBody.innerHTML = `<tr><td colspan="4">Error loading history: ${error.message}</td></tr>`; allHistoryData = {}; filteredHistoryData = []; } // Reset data
}

// --- Delete History Handler ---
async function handleDeleteHistory(targetIcon) {
    const ip = targetIcon.dataset.ip; if (!ip) { console.error("Delete history icon missing IP."); return; }
    if (!window.confirm(`Delete ALL history for host ${ip}? This cannot be undone.`)) return;

    targetIcon.style.opacity = "0.5"; targetIcon.style.pointerEvents = "none"; // Disable icon
    try {
        const response = await fetch(`/api/history/${ip}`, { method: 'DELETE' }); // Call DELETE API endpoint
        let errorMsg = `Server error ${response.status}`;
        if (!response.ok) { try { const result = await response.json(); if(result.error) errorMsg = result.error; } catch(e) {} throw new Error(errorMsg); }

        const result = await response.json();
        console.log(`History for ${ip} deleted: ${result.message}`);
        // Remove row from UI
        const rowToRemove = targetIcon.closest('tr'); if (rowToRemove) rowToRemove.remove();
        // Remove from local data stores
        delete allHistoryData[ip]; delete filteredHistoryData[ip];
        updateTimestamp(false);

    } catch (error) {
        console.error(`Delete history error for ${ip}:`, error);
        alert(`Error deleting history for ${ip}: ${error.message}`);
        targetIcon.style.opacity = "1"; targetIcon.style.pointerEvents = "auto"; // Re-enable icon on error
    }
}

// --- NEW: Clear All History Handler ---
async function handleClearAllHistory() {
    if (!window.confirm('Are you sure you want to delete ALL host history entries?\nThis action CANNOT be undone!')) {
        return; // User cancelled
    }

    if (!clearHistoryButton) return; // Safety check

    console.log("Attempting to clear all history...");
    clearHistoryButton.disabled = true; // Disable button during operation
    clearHistoryButton.textContent = "Clearing...";

    try {
        const response = await fetch(`/api/history/all`, { method: 'DELETE' }); // Call new API endpoint
        let errorMsg = `Server error ${response.status}`;
        if (!response.ok) { try { const result = await response.json(); if(result.error) errorMsg = result.error; } catch(e) {} throw new Error(errorMsg); }

        const result = await response.json();
        console.log(`All history cleared: ${result.message}`);
        alert(`Success: ${result.message}`); // Notify user

        // Clear local data and re-render the empty table
        allHistoryData = {};
        filteredHostsList = []; // Also clear filtered list
        renderHistoryTable(null, null); // Re-render with no data
        updateTimestamp(false); // Update UI timestamp

    } catch (error) {
        console.error(`Error clearing all history:`, error);
        alert(`Error clearing history: ${error.message}`);
    } finally {
        clearHistoryButton.disabled = false; // Re-enable button
        clearHistoryButton.innerHTML = '<span class="mdi mdi-delete-sweep"></span> Clear All'; // Restore text/icon
    }
}


// --- Auto Refresh Logic (Includes Cookie Handling) ---
function stopAutoRefreshInterval() {
	if (refreshIntervalId !== null) { clearInterval(refreshIntervalId);
		refreshIntervalId = null; console.log("History auto-refresh stopped.");
		}
	}
	
function startAutoRefreshInterval() { stopAutoRefreshInterval();
	if (isAutoRefreshEnabled) { console.log(`Starting history auto-refresh: ${currentRefreshIntervalMs}ms`);
		fetchHistoryData(); refreshIntervalId = setInterval(fetchHistoryData, currentRefreshIntervalMs); } }

function handleRefreshToggleChange()
	{ if (!refreshCheckbox) return;
		isAutoRefreshEnabled = refreshCheckbox.checked; console.log(`History auto-refresh toggled: ${isAutoRefreshEnabled ? 'ON' : 'OFF'}`);
	if (isAutoRefreshEnabled) startAutoRefreshInterval();
	else stopAutoRefreshInterval(); }

function handleRefreshIntervalChange() {
	if (!refreshIntervalInput) return;
	let newIntervalS = parseInt(refreshIntervalInput.value, 10);
	if (isNaN(newIntervalS) || newIntervalS < MIN_REFRESH_INTERVAL_S) { newIntervalS = MIN_REFRESH_INTERVAL_S;
		refreshIntervalInput.value = newIntervalS; console.warn(`History interval set to minimum ${MIN_REFRESH_INTERVAL_S}s`); }
		currentRefreshIntervalMs = newIntervalS * 1000; console.log(`History refresh interval changed to ${newIntervalS}s`);
		setCookie(REFRESH_INTERVAL_COOKIE_NAME, newIntervalS, 365);
	if (isAutoRefreshEnabled) startAutoRefreshInterval();
	}

function loadInitialRefreshState() { const savedIntervalS = getCookie(REFRESH_INTERVAL_COOKIE_NAME); let initialIntervalS = 60; /* Default 60s */ if (savedIntervalS !== null) { const parsedInterval = parseInt(savedIntervalS, 10); if (!isNaN(parsedInterval) && parsedInterval >= MIN_REFRESH_INTERVAL_S) initialIntervalS = parsedInterval; } currentRefreshIntervalMs = initialIntervalS * 1000; if(refreshIntervalInput) refreshIntervalInput.value = initialIntervalS; isAutoRefreshEnabled = refreshCheckbox ? refreshCheckbox.checked : false; console.log(`Initial history refresh interval: ${initialIntervalS}s / Initial Auto-refresh: ${isAutoRefreshEnabled}`); /* Don't start timer here, wait for fetch */ }

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("History page DOM loaded.");
    // Get DOM References (includes clear button)
    tableBody = document.getElementById('history-table-body'); lastUpdatedDiv = document.getElementById('last-updated'); refreshCheckbox = document.getElementById('auto-refresh-checkbox'); refreshIntervalInput = document.getElementById('refresh-interval-input'); ipFilterInput = document.getElementById('filter-ip'); hostnameFilterInput = document.getElementById('filter-hostname'); startDateInput = document.getElementById('filter-start-date'); endDateInput = document.getElementById('filter-end-date');
    clearHistoryButton = document.getElementById('clear-history-button'); // NEW

    // Critical check (includes clear button)
    if (!tableBody || !refreshCheckbox || !lastUpdatedDiv || !refreshIntervalInput || !ipFilterInput || !hostnameFilterInput || !startDateInput || !endDateInput || !clearHistoryButton) {
        console.error("CRITICAL ERROR: Essential History DOM elements missing!");
        if(document.body) document.body.innerHTML = '<h1>Interface Initialization Error!</h1>';
        return;
    }

    // Add event listeners
    ipFilterInput.addEventListener('input', filterAndRender); hostnameFilterInput.addEventListener('input', filterAndRender);
    startDateInput.addEventListener('change', filterAndRender); endDateInput.addEventListener('change', filterAndRender);
    refreshCheckbox.addEventListener('change', handleRefreshToggleChange); refreshIntervalInput.addEventListener('change', handleRefreshIntervalChange);
    clearHistoryButton.addEventListener('click', handleClearAllHistory); // NEW Listener for clear button
    if (tableBody) { tableBody.addEventListener('click', (event) => { if (event.target.classList.contains('history-delete-icon')) handleDeleteHistory(event.target); }); } // Listener for individual delete
    else { console.error("History Tbody not found."); }

    // Load initial state
    loadInitialRefreshState();

    // Initial data fetch & start timer
    fetchHistoryData().then(() => { if (isAutoRefreshEnabled) { startAutoRefreshInterval(); } });

    console.log("History page initialization complete.");
});
// End of static/history.js