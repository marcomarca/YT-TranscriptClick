# YT-TranscriptClick

YT-TranscriptClick is an unofficial YouTube subtitle extractor for Tampermonkey and compatible userscript managers. It adds a floating panel on YouTube videos so you can capture subtitles, copy them as clean plain text, and paste them into an AI assistant, notes app, or research workflow.

## Features

- Floating panel on YouTube video pages
- Subtitle extraction into plain text
- Clipboard copy button
- `.txt` download button
- Draggable panel with saved position
- Trusted Types defensive handling for YouTube pages
- Capture mode for real YouTube subtitle requests when direct `timedtext` URLs return empty responses
- Works on:
  - `youtube.com`
  - `m.youtube.com`

## Installation

Install a userscript manager first:

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)

Then install YT-TranscriptClick from the raw script URL:

```text
https://raw.githubusercontent.com/marcomarca/YT-TranscriptClick/main/YT-TranscriptClick.user.js
```

Your userscript manager should detect the `.user.js` file and open the installation screen.

## Manual installation

1. Open Tampermonkey or Violentmonkey.
2. Create a new userscript.
3. Delete the default template code.
4. Copy the full raw contents of `YT-TranscriptClick.user.js`.
5. Paste it into the userscript editor.
6. Save the script.
7. Open a YouTube video.

## Usage

After installation, open a YouTube video. YT-TranscriptClick displays a floating panel with:

- Extract and copy button
- Copy again button
- Download `.txt` button
- Text area with the extracted subtitle text

Recommended flow:

1. Open a YouTube video with subtitles or auto-captions.
2. Reload the page after installing or updating the script.
3. Press **Extract and copy**.
4. If YouTube does not expose subtitles immediately, enable **CC** manually in the player, wait a few seconds, and press **Extract and copy** again.

## Repository structure

```text
YT-TranscriptClick/
├─ YT-TranscriptClick.user.js
├─ README.md
├─ LICENSE
├─ CHANGELOG.md
├─ .gitignore
└─ assets/
   └─ .gitkeep
```

## Userscript metadata

The script includes update metadata for GitHub raw installs:

```js
// @downloadURL  https://raw.githubusercontent.com/marcomarca/YT-TranscriptClick/main/YT-TranscriptClick.user.js
// @updateURL    https://raw.githubusercontent.com/marcomarca/YT-TranscriptClick/main/YT-TranscriptClick.user.js
```

These lines let supported userscript managers check for updates.

## Project status

Initial repository package. The extractor is intended as a base for development and testing against YouTube subtitle behavior.

## License

MIT License.
