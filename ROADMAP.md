# DaiDai — Technical Review & Upgrade Backlog

This review is based on the current `master` source tree. It separates release blockers from optional product enhancements so the project does not expand in too many directions at once.

## Priority 0 — Resolve before distributing APKs to other people

### 1. Protect Gemini API credentials

Current observation:
- `src/services/api.ts` can read `EXPO_PUBLIC_GEMINI_API_KEY` and sends Gemini requests from the mobile client.
- API keys entered by the user are persisted through the app's SQLite settings/repository layer.
- A value prefixed with `EXPO_PUBLIC_` is embedded in the client bundle and must not be treated as a private server secret.

Recommended work:
- Remove all shared production API keys from client build-time variables.
- Decide whether the app is strictly BYOK (each user supplies their own key) or uses a backend proxy.
- If using a backend, add user/device authentication, request quotas, rate limits, abuse controls, and server-side secret storage before routing app requests through it.
- Consider an appropriate secure-storage mechanism for user-provided keys instead of ordinary app database settings.

### 2. Secure the standalone Cloudflare Worker before deployment

Current observation:
- The Worker source includes permissive CORS headers and public request handlers.
- The current mobile API service does not appear to call this Worker.

Recommended work:
- Do not publish it as an unrestricted Gemini proxy.
- Add authentication, request validation, rate limiting, quota controls, payload limits, and explicit CORS origins.
- Only then integrate it through a typed API client and tests.

### 3. Make local speech-server connectivity configurable

Current observation:
- The mobile API tries local server candidates and also has fallback LAN addresses.
- A fixed LAN address is not portable across home, campus, and mobile networks.

Recommended work:
- Expose the local server URL in app settings.
- Add a health-check screen showing local STT availability and the selected fallback path.
- Treat local Whisper as optional; core learning should continue through cloud STT or supported cached content.

## Priority 1 — Reliability and quality

### 4. Add automated tests for critical learning logic

Start with unit tests for:
- Traditional Chinese normalization and simplified-character filtering.
- Pinyin/Chinese alignment.
- Phrase-role resolution and AI response validation.
- FSRS state conversion, due-date calculations, and repeated-answer edge cases.
- API retry, key rotation, cache, and offline fallback behavior.

Then add device-level smoke tests for Android and iOS.

### 5. Improve AI response validation and observability

- Validate every structured AI response before rendering.
- Track malformed JSON, empty content, Pinyin mismatch, latency, model fallback, and quota errors.
- Keep logs free of API keys, full audio recordings, and unnecessary personal content.
- Maintain a small, versioned regression dataset for language edge cases.

### 6. Add reliable local-data backup and export

Vocabulary and learning records are currently primarily stored on the device. Add a user-controlled export/import workflow (for example, JSON or CSV) before considering cloud synchronization. Validate schema version and restore behavior.

### 7. Complete Android release testing

- Test Android microphone permission and recording lifecycle.
- Test notifications on supported Android versions.
- Verify SQLite data survives app restart and supported upgrades.
- Test offline/local-server failure and Gemini fallback.
- Check keyboard behavior, safe areas, screen sizes, and app lifecycle.
- Produce repeatable APK builds and record the tested version/device matrix.

## Priority 2 — Product improvements after the core is stable

### 8. Learning analytics

Add progress views for new vocabulary, due reviews, retention trends, weak topics, and recent learning activity.

### 9. Better personalization

Add an initial proficiency/goal setup and use the selected learning topics to adjust vocabulary, scenarios, and review recommendations.

### 10. Extend situational practice

Add more Taiwan-specific scenarios only after current role assignment, dialogue turn structure, answer validation, and saved-vocabulary flow are reliable.

### 11. Offline learning packs

Allow users to download selected phrase packs and review saved vocabulary without a network connection. Clearly distinguish offline-supported functions from AI functions that require the network.

## Recommended semester scope

Keep the semester scope focused on:
1. Secure and stabilize the current AI/STT paths.
2. Build and test an installable Android APK.
3. Add automated tests around AI response validation, Pinyin alignment, and FSRS.
4. Test the same core learning flows on iOS and Android.
5. Document measured results and known limitations.

Do not start cloud sync, a large new game/quest system, or many new scenarios before the release and reliability work is complete.
