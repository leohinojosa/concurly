# docreview

Review HTML design documents with inline comments and resolve them as an agent.

## /docreview-open

Opens an HTML design file in the browser with the comment layer active.

Usage: `/docreview-open <path-to-file.html>`

Steps:
1. Run `docreview open <path>` in the shell
2. Tell the user the browser has opened and they can:
   - Click any element to leave a comment
   - Hover over elements to highlight them (brighter outline = element has open comments)
   - Use the sidebar panel (right edge) to see all open comment threads
   - Click "↳ Show in page" in a thread card to scroll to and highlight the element
   - Click "✓ Resolve" in a thread card to resolve a comment without using the agent
   - Click "▶ Review Comments" at the bottom of the sidebar to trigger the AI agent directly from the browser
3. Remind them to run `/docreview-review` when ready for you to address the comments (or they can use the in-browser button)

## /docreview-review

Reads all open comments on the active HTML file and addresses each one.

Steps:
1. Run `docreview agent list` and parse the JSON output
2. For each comment in `openComments`:
   a. Read the `selector` and `excerpt` to identify which element is being commented on
   b. Open the HTML file on disk and locate the element matching the selector
   c. Apply the change described in `body`
   d. Run `docreview agent resolve <id>` to mark it resolved
3. After all comments are addressed, tell the user what was changed and ask them to refresh the browser to review
