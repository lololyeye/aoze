#!/usr/bin/env bash
# Builds the GitHub Pages copy as redirects only: every page of the built site (dist/) gets a tiny
# page at the same path that sends the visitor to the same page on https://aoze.fr, keeping the
# query and the anchor. Unknown paths go through 404.html. Usage: pages-redirects.sh <dist> <out>
set -euo pipefail
dist="$1"
out="$2"
site="https://aoze.fr"

page() { # $1: target URL
  cat <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Aoze has moved to aoze.fr</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="$1">
<meta http-equiv="refresh" content="0; url=$1">
<script>location.replace("$1" + location.search + location.hash);</script>
</head>
<body style="background:#0a0e15;color:#e9edf3;font:16px system-ui,sans-serif;padding:40px">
<p>Aoze is now at <a style="color:#3dd6d0" href="$1">aoze.fr</a>.</p>
</body>
</html>
EOF
}

rm -rf "$out"
mkdir -p "$out"
(cd "$dist" && find . -name index.html) | while read -r f; do
  dir="${f%/index.html}"
  path="${dir#.}"
  path="${path#/}"
  [ -n "$path" ] && path="$path/"
  mkdir -p "$out/$dir"
  page "$site/$path" > "$out/$dir/index.html"
done

# Any other address under /aoze/: the same path on aoze.fr.
cat > "$out/404.html" <<'EOF'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Aoze has moved to aoze.fr</title>
<meta name="robots" content="noindex">
<script>location.replace("https://aoze.fr/" + location.pathname.replace(/^\/aoze\/?/, "") + location.search + location.hash);</script>
</head>
<body style="background:#0a0e15;color:#e9edf3;font:16px system-ui,sans-serif;padding:40px">
<p>Aoze is now at <a style="color:#3dd6d0" href="https://aoze.fr/">aoze.fr</a>.</p>
</body>
</html>
EOF
echo "$(find "$out" -name '*.html' | wc -l) redirect pages in $out"
