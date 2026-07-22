#!/usr/bin/env python3
"""
mint_seo_refresh_token.py — one-time OAuth consent to mint a refresh token for
the GE SEO pull (Search Console + GA4, read-only). Run once; the token is reused.

Usage:
    pip install google-auth-oauthlib
    python3 scripts/mint_seo_refresh_token.py ~/Downloads/client_secret_605266695454-*.json

Opens your browser to consent AS the Google account that has access to the GSC +
GA4 property (so no property grants are needed). Saves the result to
~/.ge-seo/oauth_credentials.json (chmod 600). The refresh token is never printed.

Note: use a **Desktop-type** OAuth client (e.g. your "Content Ops CLI") — the
loopback consent flow needs it. A "Web application" client will reject the
localhost redirect unless http://localhost is a registered redirect URI.
"""
import sys, os, json, glob, stat

SCOPES = [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
]
OUT = os.path.expanduser("~/.ge-seo/oauth_credentials.json")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python3 mint_seo_refresh_token.py <client_secret.json>")

    # Resolve ~ and any glob; if the shell expanded a glob to several files, take the first.
    arg = os.path.expanduser(sys.argv[1])
    matches = glob.glob(arg)
    path = matches[0] if matches else arg
    if not os.path.exists(path):
        sys.exit(f"client secret not found: {path}")

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        sys.exit("Missing dependency. Run:  pip install google-auth-oauthlib")

    with open(path) as f:
        cs = json.load(f)
    client = cs.get("installed") or cs.get("web") or {}
    kind = "installed" if "installed" in cs else ("web" if "web" in cs else "unknown")

    flow = InstalledAppFlow.from_client_secrets_file(path, SCOPES)
    print(f"Client type: {kind}. Opening your browser to consent — approve as the")
    print("account with Search Console + GA4 access...\n")
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    if not creds.refresh_token:
        sys.exit("No refresh token returned. Re-run (Google only returns it on first consent "
                 "or with prompt=consent).")

    out = {
        "client_id": client.get("client_id") or creds.client_id,
        "client_secret": client.get("client_secret") or creds.client_secret,
        "refresh_token": creds.refresh_token,
        "token_uri": client.get("token_uri", "https://oauth2.googleapis.com/token"),
        "scopes": SCOPES,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    os.chmod(OUT, stat.S_IRUSR | stat.S_IWUSR)  # 600

    print(f"\n✅ Saved OAuth credentials to {OUT}  (chmod 600; refresh token not printed)")
    print("   Next: tell Claude Code the creds are minted — it reads this file automatically.")


if __name__ == "__main__":
    main()
