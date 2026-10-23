# Third-party notices and data terms

The Apache-2.0 license covers this project's first-party code. It does not relicense dependencies, external data, brands or provider services. The lockfile pins the exact dependency graph; `sbom.cdx.json` records it. Package distributions include their original license texts.

- **Fonts:** Geist/Geist Mono, VT323 and Instrument Serif use the SIL Open Font License 1.1. Notices are in `public/fonts/licenses/`. Font names remain subject to their reserved-name terms.
- **Mapbox GL JS:** distributed under Mapbox's SDK terms, not Apache-2.0. A Mapbox account/token and compliance with attribution and usage terms are required for the basemap. See https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt .
- **GSAP:** uses the GSAP Standard License, including its usage restrictions. See https://gsap.com/standard-license/ . Source inclusion does not imply that all dependencies are OSI-approved.
- **SheetJS CE:** installed from the official 0.20.3 distribution, with SHA-512 integrity in package-lock.json, under Apache-2.0. See https://docs.sheetjs.com/docs/getting-started/installation/nodejs/ .
- **Sharp/libvips:** Sharp is Apache-2.0; bundled libvips binaries retain LGPL-3.0-or-later terms and notices. If redistributing container binaries, retain their licenses and meet applicable source/rel linking obligations. Source and build instructions: https://github.com/libvips/libvips .
- **caniuse-lite:** CC-BY-4.0; see https://github.com/browserslist/caniuse-lite .
- **MITRE ATT&CK:** MITRE attribution and terms apply to bundled/example ATT&CK descriptions and collected STIX data. See https://attack.mitre.org/resources/terms-of-use/ .

## Feed redistribution

Connectors do not grant redistribution rights. NVD/CISA public datasets, MITRE ATT&CK, abuse.ch, HIBP, vendor advisories, news RSS, financial data, YouTube and X each have independent API, attribution, storage and redistribution terms. Users supply their own API accounts and must review the relevant provider terms before enabling ingestion or public publishing. Public feeds are off by default. Prefer source links and short factual summaries; do not republish full articles, breach records, copyrighted images or provider datasets without permission. Third-party links and public organizations in synthetic/example intelligence are attribution, not endorsements.

Bundled map facts are illustrative, city-level public information, with source attribution in the GeoJSON/JSON metadata where applicable. They are not a complete, current or licensed export of any upstream commercial dataset. Original first-party summaries remain under the project license; cited provider names and data rights remain with their owners.
