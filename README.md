# userscripts

## ⚠️ AI-Generated Content Disclaimer

Parts of the scripts in this repository may have been created or updated with the assistance of AI agents. While efforts have been made to test and ensure the safety and functionality of these scripts, users should be advised to review the code, understand its behavior, and take appropriate precautions before installing or running any userscripts. Userscripts can have significant access to browser data and websites; use at your own risk.

## Overview

This repository contains a collection of userscripts designed to enhance media downloading capabilities on various platforms. Userscripts are JavaScript programs that run in your browser to modify web pages or add functionality, typically managed by extensions like Tampermonkey, Greasemonkey, or Violentmonkey.

## Available Scripts

### Grok Imagine Downloader (`src/grok/grok-bulk-image-downloader.user.js`)

- **Author**: Mykyta Shcherbyna (modified by Dragonator)
- **Version**: 2026-02-11
- **Description**: Enables bulk downloading of AI-generated images and videos from Grok's Imagine pages, including Favorites, single posts, prompt generation, and "More like this" pages. Features session-based tracking, JSON export, and a floating download-all button with settings.
- **Supported Pages**:
  - `/imagine` (main prompt page)
  - `/imagine/more/{id}` ("More like this" generations)
  - `/imagine/favorites`
  - `/imagine/post/{id}` (single posts)
- **Features**:
  - API interception for metadata capture
  - Download buttons on image cards
  - Floating "Download All" button
  - Persistent download history
  - Session tracking for prompt pages
  - JSON export of session data
  - Settings panel for maintenance
- **Technical Documentation**: See [`src/grok/grok-imagine-downloader-technical.md`](src/grok/grok-imagine-downloader-technical.md)

### Twitter Media Downloader (`src/twitter/twitter_media_downloader.js`)

- **Author**: AMANE
- **Version**: 1.06
- **Description**: One-click download of videos and photos from Twitter (now X) posts. Supports multiple formats and provides customizable filename templates.
- **Features**:
  - Download videos and images with one click
  - Customizable filename format
  - Supports Twitter, mobile Twitter, and TweetDeck
  - History tracking

## Installation

1. Install a userscript manager extension for your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended for Chrome/Chromium)
   - [Greasemonkey](https://www.greasespot.net/) (for Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/)

2. Click on a script file in this repository (e.g., `src/grok/grok-bulk-image-downloader.user.js`)

3. Click the "Raw" button to view the script source

4. Your userscript manager should detect the script and prompt you to install it

Alternatively, you can copy the script content and paste it into your userscript manager's editor.

## Usage

After installing a script, visit the supported website (e.g., grok.com or twitter.com) and the script will automatically activate. Look for download buttons or menus added by the script.

### Grok Imagine Downloader Specifics

- On prompt pages: Download buttons appear on generated images
- On favorites/single posts: Download buttons on cards, plus floating "Download All" button
- Use the settings panel (accessible via the floating button) to manage download history, clear data, etc.
- Session data can be exported as JSON for backup

### Twitter Media Downloader Specifics

- Download buttons appear on tweets with media
- Right-click for additional options
- Configure filename format in the script settings

## Security and Privacy

- These scripts require broad permissions to function (e.g., `GM_download`, `unsafeWindow`)
- They may access and download media from websites
- Review the script code before installation
- Only install from trusted sources
- Be aware of website terms of service regarding media downloading

## Contributing

- Report issues or suggest improvements via GitHub issues
- Pull requests welcome for bug fixes or enhancements
- When modifying scripts, maintain compatibility and test thoroughly

## License

Scripts may have individual licenses as specified in their headers. This repository is provided as-is for educational and personal use.

## Related Links

- [Grok Imagine](https://grok.com/imagine)
- [Greasyfork](https://greasyfork.org/) - Alternative source for userscripts