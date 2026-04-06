import urllib.request
import json
import re
import os
import base64
import html
from datetime import datetime

# Optional Groq integration
try:
    from groq import Groq
    GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
    if GROQ_API_KEY:
        client = Groq(api_key=GROQ_API_KEY)
    else:
        client = None
except ImportError:
    client = None

USERNAME = "Nicholas-Tritsaris"
REPO_NAME = "Nicholas-Tritsaris.github.io"
GENERIC_DESCRIPTION = "A cool project by Nicholas."

# Caches to avoid redundant calls
EXISTING_DESCRIPTIONS = {}
README_CACHE = {}

def get_display_name(repo_name):
    """Formats a repo name into its display title (e.g., 'my-repo' -> 'My Repo')."""
    return repo_name.replace("-", " ").replace("_", " ").title()

def load_existing_descriptions():
    """Parses index.html to find existing project descriptions."""
    global EXISTING_DESCRIPTIONS
    if not os.path.exists("index.html"):
        return

    with open("index.html", "r", encoding="utf-8") as f:
        content = f.read()

    # Matches the card titles and descriptions based on the established HTML structure
    pattern = re.compile(r"<h4>(.*?)</h4>\s*<p>(.*?)</p>", re.DOTALL)
    matches = pattern.findall(content)
    for title, desc in matches:
        # Use the exact display name as the key for reliable lookup
        clean_title = title.strip()
        EXISTING_DESCRIPTIONS[clean_title] = desc.strip()

def fetch_json(url):
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Python-Urllib')
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header('Authorization', f'token {token}')
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def fetch_repos():
    url = f"https://api.github.com/users/{USERNAME}/repos?sort=created&direction=desc&per_page=100"
    return fetch_json(url)

def fetch_readme_text(repo_name):
    """Fetches and caches the README content for a given repository."""
    if repo_name in README_CACHE:
        return README_CACHE[repo_name]

    readme_urls = [
        f"https://api.github.com/repos/{USERNAME}/{repo_name}/contents/README.md",
        f"https://api.github.com/repos/{USERNAME}/{repo_name}/contents/{repo_name}/README.md"
    ]

    for url in readme_urls:
        try:
            content_data = fetch_json(url)
            if 'content' in content_data:
                content = base64.b64decode(content_data['content']).decode('utf-8')
                README_CACHE[repo_name] = content
                return content
        except Exception:
            continue

    README_CACHE[repo_name] = ""
    return ""

def get_ai_description(repo, readme_text):
    """Uses Groq AI to generate a short, nostalgic description."""
    if not client:
        return None

    name = repo['name']
    api_desc = repo.get('description', '')
    if api_desc == GENERIC_DESCRIPTION:
        api_desc = "None provided."

    prompt = f"""
Create a short, nostalgic, and catchy description (max 160 characters) for the following GitHub repository.
The description should fit a 90s/early 2000s "retro" web aesthetic.
Repo Name: {name}
Existing Description: {api_desc}
README Snippet:
{readme_text[:1000]}

Rules:
- Max 160 characters.
- Use a fun, slightly informal, retro-enthusiast tone.
- Output ONLY the description text.
"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that writes catchy, retro-style web descriptions."
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_completion_tokens=100,
        )
        ai_desc = response.choices[0].message.content.strip().strip('"')
        return ai_desc
    except Exception as e:
        print(f"Error generating AI description for {name}: {e}")
        return None

def get_enhanced_description(repo):
    """
    Attempts to find a better description for the repository.
    Strictly follows the "only regenerate if generic" rule.
    """
    repo_name = repo['name']
    display_name = get_display_name(repo_name)

    # 1. Check existing descriptions (Cache from index.html OR newly generated)
    # If the description is already in index.html and isn't the generic one, reuse it.
    existing_desc = EXISTING_DESCRIPTIONS.get(display_name)
    if existing_desc and existing_desc != GENERIC_DESCRIPTION:
        return existing_desc

    # 2. Check API Description
    # If the API has a non-generic description, we'll use it (treating it as manual input).
    api_desc = repo.get('description')
    if api_desc and api_desc.strip() and api_desc != GENERIC_DESCRIPTION:
        EXISTING_DESCRIPTIONS[display_name] = api_desc
        return api_desc

    # 3. AI Generation
    # Triggered only if we are currently stuck with a generic description or none at all.
    if client:
        readme_text = fetch_readme_text(repo_name)
        if readme_text:
            ai_desc = get_ai_description(repo, readme_text)
            if ai_desc:
                EXISTING_DESCRIPTIONS[display_name] = ai_desc
                return ai_desc

    # 4. Fallback to README manual extraction
    readme_text = fetch_readme_text(repo_name)
    if readme_text:
        # Find the first paragraph that isn't a header, HTML tag, or separator
        lines = readme_text.split('\n')
        for line in lines:
            line = line.strip()
            if line and not (line.startswith('#') or line.startswith('<') or line.startswith('---')):
                EXISTING_DESCRIPTIONS[display_name] = line
                return line

    return GENERIC_DESCRIPTION

def format_card(repo):
    name = repo['name']
    description = html.escape(get_enhanced_description(repo), quote=False)
    display_name = get_display_name(name)

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
        # Already cached in card generation phase
        description = html.escape(get_enhanced_description(repo))
        display_name = get_display_name(name)

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

    load_existing_descriptions()

    # Phase 1: Card Generation (populates cache)
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

    # Phase 2: RSS Generation (uses populated cache)
    generate_rss(filtered_repos)

if __name__ == "__main__":
    main()
