// ===========================================
// static/custom_oui_editor.js - JS for the Editor Page
// ===========================================

document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('save-oui-button');
    const contentTextArea = document.getElementById('oui-content');
    const statusDiv = document.getElementById('save-status');

    if (!saveButton || !contentTextArea || !statusDiv) {
        console.error("Essential editor elements not found!");
        if(statusDiv) statusDiv.textContent = "Error: Page elements missing.";
        statusDiv.className = 'status-error';
        return;
    }

    saveButton.addEventListener('click', async () => {
        const newContent = contentTextArea.value; // Get current content
        statusDiv.textContent = 'Saving...';
        statusDiv.className = ''; // Clear previous status class
        saveButton.disabled = true;

        console.log("Attempting to save custom OUI content...");

        try {
            const response = await fetch('/api/custom_oui/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: newContent }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || `Server error ${response.status}`);
            }

            console.log("Save successful:", result.message);
            statusDiv.textContent = result.message || 'Saved successfully!';
            statusDiv.className = 'status-success';

        } catch (error) {
            console.error("Error saving custom OUI:", error);
            statusDiv.textContent = `Error: ${error.message}`;
            statusDiv.className = 'status-error';
        } finally {
            saveButton.disabled = false; // Re-enable button
            // Optionally clear status message after a delay
            setTimeout(() => {
                if (!statusDiv.className.includes('error')) { // Don't clear errors automatically
                     statusDiv.textContent = '';
                     statusDiv.className = '';
                }
            }, 5000); // Clear after 5 seconds
        }
    });

    console.log("Custom OUI editor initialized.");
});