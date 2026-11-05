# concurly

Review software architecture concurrently with an expert AI peer. Open any HTML file in the browser, leave comments on elements, then let the AI apply the fixes and mark them resolved.

**File Type Requirement:** concurly only works with HTML files (`.html`). For markdown (`.md`) or text files (`.txt`), skip concurly and proceed with standard review/editing directly — no user reminder needed.

**Default behavior:** `/concurly <path-to-file.html>` with no subcommand defaults to `/concurly open`. If the user types `/concurly` followed by a file path, treat it as `/concurly open`.

## Natural Language Triggers

Recognize these phrases and execute the corresponding command automatically — no explicit `/concurly` invocation needed.

| If the user says anything like… | Run this |
|---|---|
| "let's review the design", "open the design", "let's start a review", "let's review the architecture design", "let's review the architecture" | Check file type first; if `.html`, run `/concurly open`; if `.md` or `.txt`, proceed with standard review |
| "open `<file>.html` from github", "review the `<name>` spec in `<repo>`", "open this github link", or a bare `.html` file name that isn't on disk | `/concurly open` — resolve the target first (see "Resolving the target") |
| "review ready", "review the comments I left", "review the changes", "go ahead and review", "please review my comments" | `/concurly review` (only if concurly is already active) |
| "we concur", "review is complete", "we're done", "that's all the comments", "all done reviewing" | `/concurly complete` (only if concurly is active) |

When a trigger fires, you **must** know the file path before running `open`. If it hasn't been provided, ask for it first. For `review` and `complete`, use the single running session automatically.

## File Type Check

Before opening any file with concurly:
1. Inspect the file extension
2. If `.html` → proceed with `/concurly open`
3. If `.md`, `.txt`, or other non-HTML → skip concurly entirely and proceed with standard review/editing instead
4. Do not mention this to the user — handle silently

## /concurly open

Opens an HTML design file in the browser with the comment layer active. Each file gets its own server instance and port. If the file is already open, the existing session is reused.

Usage: `/concurly open <path-to-file.html | url | github-file-name> [owner/repo] [ref]`

### Resolving the target

`concurly` itself only needs a local path or a URL — it never depends on the GitHub CLI. The `gh` steps below are **this skill's** convenience for turning a GitHub file name or link into a URL `concurly` can fetch. Work out which case applies:

**A. A local path** → use it as-is.

**B. An `http(s)` URL**
- Already has a `?token=` or isn't a GitHub URL → pass it through as-is. `concurly` fetches it into `~/.concurly/reviews/<hash>/` and reviews the cached copy. The URL only needs to serve HTML; it doesn't need a `.html` extension.
- A GitHub file URL without a token (`github.com/<o>/<r>/blob/<ref>/<path>` or `raw.githubusercontent.com/<o>/<r>/<ref>/<path>`) and `gh` is available → parse owner, repo, ref and path from it and mint a fetchable URL with step 4 below (this is what makes **private** repos work). If `gh` is unavailable, pass the URL as-is: it works for public repos, and a private one will fail with a "use a fresh Raw link" error — then ask the user for the Raw link from GitHub.

**C. A bare file name or partial path that is not on disk** (e.g. `01-accounts-api-global-spec.html`) → needs `gh`:

0. Check `gh auth status`. If `gh` is missing or not logged in, say so plainly — "I need the GitHub CLI (`gh`) to find a file by name; install/log in, or paste the file's GitHub or Raw URL" — and stop. Don't guess a URL.
1. **Repo:** use the `owner/repo` the user gave; otherwise the current directory's repo (`gh repo view --json nameWithOwner --jq .nameWithOwner`); if neither applies, ask.
2. **Ref:** use the branch, tag or commit SHA the user gave; otherwise the repo's default branch (`gh api repos/<owner>/<repo> --jq .default_branch`).
3. **Find the path** with the git tree API (more reliable than `gh search code`, which can miss files):
   ```
   gh api "repos/<owner>/<repo>/git/trees/<ref>?recursive=1" --jq '{truncated, matches: [.tree[] | select(.type=="blob") | select((.path|ascii_downcase) == ("<name>"|ascii_downcase) or (.path|ascii_downcase|endswith("/" + ("<name>"|ascii_downcase)))) | .path]}'
   ```
   - `truncated: true` → the repo is too large to list; ask for the full path or a URL.
   - **0 matches** → tell the user the file isn't on `<ref>` and ask which branch/commit it lives on (files often exist only on a PR branch). If the repo is the current directory's, you may retry once with the current branch (`git branch --show-current`) and say which ref you used. Never guess a different file.
   - **1 match** → continue.
   - **Several matches** → list them and ask which one.
4. **Mint a fetchable URL** (URL-encode special characters in the path):
   ```
   gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>" --jq .download_url
   ```
   For a private repo this is a `raw.githubusercontent.com` URL with a short-lived `?token=`; for a public repo it is a plain raw URL.

**Treat the minted URL as a secret.** Pass it to `concurly` (quoted), but never print it back to the user, paste it into a file, or put it in a commit. Refer to the file as `<owner>/<repo>:<path>@<ref>` instead.

Steps:
1. Run `concurly open "<path-or-url>"` in the shell **as a background process** (`run_in_background: true` on the Bash tool) so the server starts without blocking the agent
2. Tell the user the browser has opened with a dark header bar at the top showing the app
   name ("concurly"), the filename, and the full file path. They can also:
   - Switch the header toggle from Read (default) to Review, then click any element to leave a comment
   - In Review mode, hover over elements to highlight them (brighter indigo outline = element has open comments; faint outline = no comments)
   - Use the sidebar panel (right edge) to see all open comment threads
   - Each thread card shows the selector, excerpt, and comment body with four actions:
     - **↳ Show in page** — scrolls to the element and briefly highlights it yellow
     - **✎ Edit** — opens an inline textarea to update the comment body; Save or Cancel
     - **✓ Resolve** — marks the comment resolved and removes it from the sidebar
     - **✕ Delete** — permanently removes the comment (only available while open/unresolved)
   - In Review mode, click a commented element to open the sidebar focused on that thread
   - Collapse/expand the sidebar with the ← / → icon button on the right edge; the sidebar starts collapsed on every page load, expands when the user switches to Review mode, and collapses when they switch to Read mode
3. Remind them to say "review ready" or run `/concurly review` when ready for you to address the comments

## /concurly refresh

Refetches a remote page in an active session. Comments are kept; the browser reloads if the content changed. Only valid for sessions opened from a URL (`concurly list` shows a `Source:` line for those).

Usage: `/concurly refresh [port|url]`

Steps:
1. Run `concurly refresh [port|url]` in the shell
2. Report the result: "Updated", "No changes", or the error
3. If it fails with "link expired or not accessible" (GitHub's `?token=` links are short-lived), get a fresh link and run `concurly refresh "<fresh-url>"` (or `concurly open "<fresh-url>"`); this swaps the link in the live session without losing comments:
   - If `gh` is available and the session's `Source:` URL (from `concurly list`, or `sourceUrl` in `concurly review`) is a `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` URL, re-mint it yourself with step 4 of "Resolving the target". If the branch name contains `/` the ref/path split is ambiguous — ask the user for the ref.
   - Otherwise ask the user for a fresh "Raw" link.

Pages pinned to a commit SHA can't change, so refreshing them is never useful.

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
   - For remote sessions the JSON also includes `sourceUrl`; `htmlFile` is the local cached copy
2. For each comment in `openComments`:
   a. Read the `selector` and `excerpt` to identify which element is being commented on
   b. Open the HTML file on disk (`htmlFile`) and locate the element matching the selector. For a remote session this edits the **local cached copy only** — it does not change the remote file, and a later refresh will overwrite those edits if the remote content differs. Tell the user this when you finish
   c. Apply the change described in `body`
   d. Run `concurly agent resolve <id> [port]` to mark it resolved
3. After all comments are addressed, tell the user what was changed and ask them to review the browser

## /concurly complete

Stops a specific review session. The comments JSON file is preserved for historic reference — nothing is deleted.

Steps:
1. Say exactly: "we concur 🤝"
2. Run `concurly complete` in the shell (no argument needed when only one session is running)
   - If multiple sessions are running, specify port or path: `concurly complete <port|path>`
3. Confirm to the user that the session has been stopped and that comments are preserved
