"Copernicus" here refers to Galaxie Copernicus, a commercial typeface by
Chester Jenkins and Kris Sowersby (Klim Type Foundry). It is not something
that can be freely downloaded or bundled here.

If you own a license to it, export the web font files (.woff2) and drop
them into this folder using these exact names, and the site will pick
them up automatically via the @font-face rules at the top of style.css:

  fonts/Copernicus-Regular.woff2   (weight 400)
  fonts/Copernicus-Medium.woff2    (weight 500)
  fonts/Copernicus-Bold.woff2      (weight 700)

If these files are absent, the browser silently falls back to 'Literata'
(loaded from Google Fonts) — a free transitional serif that font-matching
tools consistently list as one of the closest free equivalents to Galaxie
Copernicus. Nothing breaks either way; the fallback is already wired up
and looks intentional on its own.
