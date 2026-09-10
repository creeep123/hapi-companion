# Settings tabs
Status: ready for UI review
Spec: docs/specs/SETTINGS_TABS.md
Implement two pages with sounds secondary. Preserve existing state and behavior. Verify both native pages, draft persistence across switches, existing tests and Release build.

Validation: 45 existing Swift tests passed; Release build passed; git diff --check passed. No new layout-mirroring tests were added. Native preview verified initial reminder page, secondary system/sound page, all existing selected values, and preservation of both search text and an unsubmitted keyword draft across tab switches. Temporary test inputs cleared. Both pages inspected at the minimum window size: rule content scrolls, sound controls fit, and shared tabs/footer remain available. Returned to reminder page. No live app/Hub/Runner changes.
