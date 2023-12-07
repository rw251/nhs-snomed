# SNOMED descriptions

Execute `node index.js` to pull the latest SNOMED zip file and extract all the definitions.

Initially this script would only get the "Delta" release, but that doesn't exist for the international SNOMED files so we just use the "Full" release each time. This is fine because the way the files are structured means that a new file contains all lines of the previous file, plus some additions i.e. there are no deletions or modifications to existing lines.

The resulting json files appear under `files/processed/latest/`. There is the `defs.json` file which is the one that should be used, and one called `defs-readable.json` which has line breaks and spaces to make it easier to read and search in a text viewer.
