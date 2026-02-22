import urllib.request
import json
import re
import os

USERNAME = "Nicholas-Tritsaris"
REPO_NAME = "Nicholas-Tritsaris.github.io"

def fetch_repos():
    # Sort by created to show newest first, or updated?
    # User said "when I make a new repository", so created sounds appropriate.
    url = f"https://api.github.com/users/{USERNAME}/repos?sort=created&direction=desc&per_page=100"
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Python-Urllib')
    # Use GITHUB_TOKEN if available (set by GitHub Actions)
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header('Authorization', f'token {token}')

    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def format_card(repo):
    name = repo['name']
    description = repo['description'] or "A cool project by Nicholas."
    # Clean up name for display: replace hyphens with spaces and capitalize
    display_name = name.replace("-", " ").replace("_", " ").title()

    homepage = repo['homepage']
    html_url = repo['html_url']

    link = homepage if homepage else html_url

    # Upgrade http to https, especially for blueboop.is-a.dev as per guidelines
    if link and link.startswith("http://"):
        link = link.replace("http://", "https://", 1)

    # Determine link text based on the URL
    if homepage:
        if "github.io" in homepage:
            link_text = f"Visit {display_name}"
        elif "blueboop.is-a.dev" in homepage:
            link_text = f"Explore {display_name}"
        else:
            link_text = f"Open {display_name}"
    else:
        link_text = "View on GitHub"

    return f"""
          <div class="card">
            <h4>{display_name}</h4>
            <p>{description}</p>
            <p><a href="{link}" target="_blank" rel="noopener">{link_text}</a></p>
          </div>"""

def main():
    print(f"Fetching repositories for {USERNAME}...")
    try:
        repos = fetch_repos()
    except Exception as e:
        print(f"Error fetching repos: {e}")
        return

    # Filter: Not this repo, not forks, and must be public (already handled by API for public users)
    filtered_repos = [
        repo for repo in repos
        if repo['name'].lower() != REPO_NAME.lower()
        and not repo['fork']
        and not repo['archived']
        and repo['name'] != "Nicholas-Tritsaris" # Exclude profile README repo
    ]

    print(f"Found {len(filtered_repos)} public repositories.")

    # Generate HTML
    cards_html = "".join([format_card(repo) for repo in filtered_repos])

    # Update index.html
    with open("index.html", "r", encoding="utf-8") as f:
        content = f.read()

    start_marker = "<!-- PROJECTS_START -->"
    end_marker = "<!-- PROJECTS_END -->"

    if start_marker in content and end_marker in content:
        pattern = re.compile(f"{re.escape(start_marker)}.*?{re.escape(end_marker)}", re.DOTALL)
        new_content = pattern.sub(f"{start_marker}{cards_html}\n          {end_marker}", content)

        with open("index.html", "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully updated index.html with latest projects.")
    else:
        print("Markers not found in index.html. Make sure <!-- PROJECTS_START --> and <!-- PROJECTS_END --> are present.")

if __name__ == "__main__":
    main()
