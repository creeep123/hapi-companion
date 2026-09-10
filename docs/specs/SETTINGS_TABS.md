# Settings tabs

User request 2026-09-10: sound functionality accepted; reduce its prominence and divide the growing settings window into tabs.

- Two native segmented navigation tabs: 提醒规则 (initial page) and 声音与设置.
- Reminder page: existing session/keyword selection, duration threshold, quiet hours.
- Secondary page: notification permission and login-startup status/actions, then sound picker/volume/import/preview.
- Shared connection header, visible permission warning when blocked, test reminder and autosave footer.
- Switching does not fetch from Hub, save a new setting, reset stored rules, lose search/keyword drafts, or play sound.
- Existing model, settings persistence, audio and delivery behavior unchanged. UI-only change; no additional tests needed solely to mirror layout.
- Acceptance: existing tests and Release build; inspect both native pages at minimum window size, switch with search/draft text and verify retained, confirm sound controls on second page and default rule page on fresh launch. Provide screenshots/native preview for user review.
