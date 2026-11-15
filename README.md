# TrustFile

Free online file converter - 100% client-side. Files never leave the user's device.

Live site: https://trustfile-sigma.vercel.app/

## Structure
- `index.html` - homepage + all tools
- `<tool>.html` - one SEO landing page per conversion (12 tools)
- `css/style.css`, `js/main.js` - design + converter widget (lazy-loads CDN libraries)
- `js/client-side-converter.js` - conversion engine (Canvas, jsPDF, pdf.js, mammoth, SheetJS, docx)
- `sitemap.xml`, `robots.txt` - SEO

## Honest limits
PDF to Word extracts text (layout not preserved). Scanned PDFs need OCR (not supported). PPTX to PDF and Word to PDF with exact layout need a server and are not offered.

## Deploy
Vercel serves this repo from the `main` branch (auto-deploys on every push). No build step.
