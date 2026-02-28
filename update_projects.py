import urllib.request
import json
import re
import os
from datetime import datetime

USERNAME = "Nicholas-Tritsaris"
REPO_NAME = "Nicholas-Tritsaris.github.io"

def fetch_repos():
    url = f"https://api.github.com/users/{USERNAME}/repos?sort=created&direction=desc&per_page=100"
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Python-Urllib')
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header('Authorization', f'token {token}')

    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def format_card(repo):
    name = repo['name']
    description = repo['description'] or "A cool project by Nicholas."
    display_name = name.replace("-", " ").replace("_", " ").title()

    homepage = repo['homepage']
    html_url = repo['html_url']

    link = homepage if homepage else html_url

    if link and link.startswith("http://"):
        link = link.replace("http://", "https://", 1)

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

def generate_rss(repos):
    rss_items = []
    for repo in repos:
        name = repo['name']
        description = repo['description'] or "A cool project by Nicholas."
        display_name = name.replace("-", " ").replace("_", " ").title()

        homepage = repo['homepage']
        html_url = repo['html_url']
        link = homepage if homepage else html_url
        if link and link.startswith("http://"):
            link = link.replace("http://", "https://", 1)

        # GitHub API returns ISO 8601 strings
        created_at = datetime.strptime(repo['created_at'], "%Y-%m-%dT%H:%M:%SZ")
        pub_date = created_at.strftime("%a, %d %b %Y %H:%M:%S GMT")

        rss_items.append(f"""    <item>
      <title>{display_name}</title>
      <link>{link}</link>
      <description>{description}</description>
      <pubDate>{pub_date}</pubDate>
      <guid isPermaLink="false">{repo['id']}</guid>
    </item>""")

    rss_content = f"""<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Retroverse Online - Latest Projects</title>
  <link>https://{USERNAME.lower()}.github.io/</link>
  <description>Stay updated with the latest projects from Nicholas Tritsaris.</description>
  <language>en-us</language>
  <lastBuildDate>{datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")}</lastBuildDate>
  <atom:link href="https://{USERNAME.lower()}.github.io/rss.xml" rel="self" type="application/rss+xml" />
{"".join(rss_items)}
</channel>
</rss>"""

    with open("rss.xml", "w", encoding="utf-8") as f:
        f.write(rss_content)
    print("Successfully generated rss.xml")

def main():
    print(f"Fetching repositories for {USERNAME}...")
    try:
        repos = fetch_repos()
    except Exception as e:
        print(f"Error fetching repos: {e}")
        return

    filtered_repos = [
        repo for repo in repos
        if repo['name'].lower() != REPO_NAME.lower()
        and not repo['fork']
        and not repo['archived']
        and repo['name'] != "Nicholas-Tritsaris"
    ]

    print(f"Found {len(filtered_repos)} public repositories.")

    cards_html = "".join([format_card(repo) for repo in filtered_repos])

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

    generate_rss(filtered_repos)

if __name__ == "__main__":
    main()
