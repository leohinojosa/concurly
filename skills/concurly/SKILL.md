# concurly

Review software architecture concurrently with an expert AI peer. Open any HTML file in the browser, leave comments on elements, then let the AI apply the fixes and mark them resolved.

## /concurly-open

Opens an HTML design file in the browser with the comment layer active.

Usage: `/concurly-open <path-to-file.html>`

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
3. Remind them to run `/concurly-review` when ready for you to address the comments

## /concurly-review

Reads all open comments on the active HTML file and addresses each one.

Steps:
1. Run `concurly review` and parse the JSON output
2. For each comment in `openComments`:
   a. Read the `selector` and `excerpt` to identify which element is being commented on
   b. Open the HTML file on disk and locate the element matching the selector
   c. Apply the change described in `body`
   d. Run `concurly agent resolve <id>` to mark it resolved
3. After all comments are addressed, tell the user what was changed and ask them to review the browser
