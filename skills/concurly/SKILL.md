# concurly

Review software architecture concurrently with an expert AI peer. Open any HTML file in the browser, leave comments on elements, then let the AI apply the fixes and mark them resolved.

**Default behavior:** `/concurly <path-to-file.html>` with no subcommand defaults to `/concurly open`. If the user types `/concurly` followed by a file path, treat it as `/concurly open`.

## /concurly open

Opens an HTML design file in the browser with the comment layer active. Each file gets its own server instance and port. If the file is already open, the existing session is reused.

Usage: `/concurly open <path-to-file.html>`

Steps:
1. Run `concurly open <path>` in the shell
2. Tell the user the browser has opened with a dark header bar at the top showing the app
   name ("concurly"), the filename, and the full file path. They can also:
   - Click any element to leave a comment
   - Hover over elements to highlight them (brighter indigo outline = element has open comments; faint outline = no comments)
   - Use the sidebar panel (right edge) to see all open comment threads
   - Each thread card shows the selector, excerpt, and comment body with four actions:
     - **↳ Show in page** — scrolls to the element and briefly highlights it yellow
     - **✎ Edit** — opens an inline textarea to update the comment body; Save or Cancel
     - **✓ Resolve** — marks the comment resolved and removes it from the sidebar
     - **✕ Delete** — permanently removes the comment (only available while open/unresolved)
   - Click a commented element to open the sidebar focused on that thread
   - Collapse/expand the sidebar with the ✕/▶ button; state is remembered per browser tab
3. Remind them to run `/concurly review` when ready for you to address the comments

## /concurly list

Lists all running concurly instances with their port, PID, file path, and status.

Steps:
1. Run `concurly list` in the shell and show the output to the user

## /concurly review

Reads all open comments on an active session and addresses each one.

Steps:
1. Run `concurly review [port|path]` and parse the JSON output
   - If only one session is running, no port/path is needed
   - If multiple sessions are running, specify the port or file path
2. For each comment in `openComments`:
   a. Read the `selector` and `excerpt` to identify which element is being commented on
   b. Open the HTML file on disk and locate the element matching the selector
   c. Apply the change described in `body`
   d. Run `concurly agent resolve <id> [port]` to mark it resolved
3. After all comments are addressed, tell the user what was changed and ask them to review the browser

## /concurly complete

Stops a specific review session. The comments JSON file is preserved for historic reference — nothing is deleted.

Steps:
1. Say exactly: "we concur 🤝"
2. Run `concurly complete <port|path>` in the shell
   - Use the port number shown in `concurly list`, or the file path of the HTML being reviewed
3. Confirm to the user that the session has been stopped and that comments are preserved
