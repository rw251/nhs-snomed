# SNOMED descriptions

Execute `node --max-old-space-size=4096 index.js` to pull the latest SNOMED zip file and extract all the definitions. I could probably avoid needing to up the memory allocation if I did descriptions and relationships separately, but good enough for now.

Initially this script would only get the "Delta" release, but that doesn't exist for the international SNOMED files so we just use the "Full" release each time. This is fine because the way the files are structured means that a new file contains all lines of the previous file, plus some additions i.e. there are no deletions or modifications to existing lines.

The resulting json files appear under `files/processed/latest/`. There is the `defs.json` file which is the one that should be used, and one called `defs-readable.json` which has line breaks and spaces to make it easier to read and search in a text viewer. There is now also a `defs-single.json` which just picks the best definition for each concept for ease of lookup.

## Finding all descendants of a code

Use `node children.js` to open a command-line interface that allows you to enter a SNOMED code and have it, and all of its descendants, copied to the clipboard.
