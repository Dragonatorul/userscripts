// ==UserScript==
// @name         Grok Imagine Downloader - Bulk Save High-Quality Media
// @namespace    https://grok.com
// @version      2026-02-11.6
// @description  Download all videos and photos from Grok Imagine: Favorites, single post, prompt generation, AND "More like this" pages. Session-based tracking for prompt pages with JSON export.
// @author       Mykyta Shcherbyna (modified by Dragonator)
// @match        https://grok.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=grok.com
// @license      MIT
// @grant        GM_download
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// @connect      assets.grok.com
// @connect      imagine-public.x.ai
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // Logging System
    // =========================================================================

    const LOG_LEVEL = {
        OFF: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4
    };

    const LOG_LEVEL_NAMES = {
        [LOG_LEVEL.OFF]: 'Off',
        [LOG_LEVEL.ERROR]: 'Error',
        [LOG_LEVEL.WARN]: 'Warn',
        [LOG_LEVEL.INFO]: 'Info',
        [LOG_LEVEL.DEBUG]: 'Debug'
    };

    const LOG_LEVEL_KEY = 'grok_downloader_log_level';
    let currentLogLevel = LOG_LEVEL.INFO; // Default log level

    // Load saved log level
    function loadLogLevel() {
        try {
            const saved = GM_getValue(LOG_LEVEL_KEY, LOG_LEVEL.INFO);
            currentLogLevel = typeof saved === 'number' ? saved : LOG_LEVEL.INFO;
        } catch (e) {
            currentLogLevel = LOG_LEVEL.INFO;
        }
    }

    // Save log level
    function saveLogLevel(level) {
        try {
            GM_setValue(LOG_LEVEL_KEY, level);
            currentLogLevel = level;
        } catch (e) {
            console.error('[Grok Downloader] Failed to save log level:', e);
        }
    }

    // Logger object with methods for each level
    const Logger = {
        _prefix: '[Grok Downloader]',

        _formatArgs(args) {
            return args;
        },

        _getTimestamp() {
            return new Date().toISOString().substr(11, 12);
        },

        error(...args) {
            if (currentLogLevel >= LOG_LEVEL.ERROR) {
                console.error(
                    `%c${this._prefix} %c[ERROR]%c [${this._getTimestamp()}]`,
                    'color: #888',
                    'color: #ff4444; font-weight: bold',
                    'color: #888',
                    ...args
                );
            }
        },

        warn(...args) {
            if (currentLogLevel >= LOG_LEVEL.WARN) {
                console.warn(
                    `%c${this._prefix} %c[WARN]%c [${this._getTimestamp()}]`,
                    'color: #888',
                    'color: #ffaa00; font-weight: bold',
                    'color: #888',
                    ...args
                );
            }
        },

        info(...args) {
            if (currentLogLevel >= LOG_LEVEL.INFO) {
                console.info(
                    `%c${this._prefix} %c[INFO]%c [${this._getTimestamp()}]`,
                    'color: #888',
                    'color: #44aaff; font-weight: bold',
                    'color: #888',
                    ...args
                );
            }
        },

        debug(...args) {
            if (currentLogLevel >= LOG_LEVEL.DEBUG) {
                console.log(
                    `%c${this._prefix} %c[DEBUG]%c [${this._getTimestamp()}]`,
                    'color: #888',
                    'color: #44ff44; font-weight: bold',
                    'color: #888',
                    ...args
                );
            }
        },

        // Group logging for related operations
        group(label) {
            if (currentLogLevel >= LOG_LEVEL.DEBUG) {
                console.group(`${this._prefix} ${label}`);
            }
        },

        groupEnd() {
            if (currentLogLevel >= LOG_LEVEL.DEBUG) {
                console.groupEnd();
            }
        },

        // Table logging for structured data
        table(data, columns) {
            if (currentLogLevel >= LOG_LEVEL.DEBUG) {
                console.table(data, columns);
            }
        },

        // Get current level for UI
        getLevel() {
            return currentLogLevel;
        },

        // Set level from UI
        setLevel(level) {
            saveLogLevel(level);
            this.info('Log level changed to:', LOG_LEVEL_NAMES[level]);
        }
    };

    // Initialize log level
    loadLogLevel();

    // =========================================================================
    // Constants and Selectors
    // =========================================================================

    const CARD_SELECTOR = '.group\\/media-post-masonry-card:not([data-downloader-added])';
    const BUTTON_CONTAINER_SELECTOR = '.absolute.bottom-2.right-2';
    const BUTTON_CLASSES = 'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium leading-[normal] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-100 select-none rounded-full overflow-hidden h-10 w-10 p-2 bg-black/25 hover:bg-white/10 border border-white/15 text-white text-xs font-bold';
    const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download size-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>`;

    const mediaDatabase = new Map();
    // Map from child post ID to parent post ID for aggregation
    const childToParentMap = new Map();
    let lastApiData = null;

    // Track which items have been downloaded (persisted across sessions)
    const DOWNLOADED_IDS_KEY = 'grok_downloader_downloaded_ids';
    const MEDIA_DB_KEY_PREFIX = 'grok_downloader_media_db';
    const CHILD_PARENT_KEY_PREFIX = 'grok_downloader_child_parent';
    let downloadedIds = new Set();

    let downloadAllBtn = null;
    let isDownloadingAll = false;
    let cancelDownload = false; // Flag to cancel ongoing downloads
    let currentPostPageId = null; // Track which single post page we're on
    let overlayRoot = null;
    // (moved declarations near top)

    // =========================================================================
    // Page Type Detection
    // =========================================================================

    const PAGE_TYPE = {
        PROMPT: 'prompt',           // /imagine - main prompt page
        MORE_LIKE_THIS: 'more',     // /imagine/more/{id} - "More like this" generation
        FAVORITES: 'favorites',     // /imagine/favorites
        SINGLE_POST: 'single_post', // /imagine/post/{id}
        OTHER: 'other'
    };

    function detectPageType() {
        const path = window.location.pathname;
        if (path === '/imagine' || path === '/imagine/') {
            return PAGE_TYPE.PROMPT;
        } else if (path.match(/\/imagine\/more\/[a-f0-9-]+/)) {
            return PAGE_TYPE.MORE_LIKE_THIS;
        } else if (path.includes('/imagine/favorites')) {
            return PAGE_TYPE.FAVORITES;
        } else if (path.match(/\/imagine\/post\/[a-f0-9-]+/)) {
            return PAGE_TYPE.SINGLE_POST;
        } else if (path.includes('/imagine')) {
            return PAGE_TYPE.OTHER;
        }
        return PAGE_TYPE.OTHER;
    }

    // Helper to check if page type is a prompt-like generation page
    function isPromptLikePage(pageType) {
        return pageType === PAGE_TYPE.PROMPT || pageType === PAGE_TYPE.MORE_LIKE_THIS;
    }

    // Current page type is dynamically detected via detectPageType() when needed

    // =========================================================================
    // Prompt Page Session Tracking (ephemeral - not persisted)
    // =========================================================================

    // Session-based storage for prompt page generated images
    // This is separate from the persisted mediaDatabase
    const promptSessionData = {
        sessionId: Date.now().toString(36) + Math.random().toString(36).substr(2),
        startTime: new Date().toISOString(),
        prompt: '',
        images: new Map(),  // id -> {id, url, prompt, createTime, filename, downloaded}
        downloadedInSession: new Set()
    };

    const pendingPromptButtons = new Map();

    function updatePromptFromDOM() {
        // Try to capture the current prompt from the input field
        const promptInput = document.querySelector('textarea[placeholder*="imagine"], input[placeholder*="imagine"], textarea[placeholder*="Type"], input[placeholder*="Type"]');
        if (promptInput && promptInput.value) {
            promptSessionData.prompt = promptInput.value.trim();
            return;
        }

        // Fallback: capture prompt from the nearest sticky prompt chip
        const anyChip = document.querySelector('.sticky.rounded-full.truncate');
        if (anyChip && anyChip.textContent) {
            const text = anyChip.textContent.trim();
            if (text) {
                promptSessionData.prompt = text;
            }
        }
    }

    function getPromptForCard(card) {
        if (!card) return promptSessionData.prompt;

        const section = card.closest('section[id^="imagine-masonry-section-"]');
        if (section) {
            const chip = section.querySelector('.sticky.rounded-full.truncate');
            if (chip && chip.textContent) {
                const text = chip.textContent.trim();
                if (text) return text;
            }
        }

        return promptSessionData.prompt;
    }

    function addToPromptSession(imageData) {
        if (!promptSessionData.images.has(imageData.id)) {
            updatePromptFromDOM();
            promptSessionData.images.set(imageData.id, {
                ...imageData,
                prompt: imageData.prompt || promptSessionData.prompt,
                addedAt: new Date().toISOString(),
                downloaded: false
            });
            Logger.debug('Added to prompt session:', imageData.id, '- total:', promptSessionData.images.size);
            return true;
        }
        return false;
    }

    function markPromptSessionDownloaded(id) {
        promptSessionData.downloadedInSession.add(id);
        const item = promptSessionData.images.get(id);
        if (item) {
            item.downloaded = true;
            item.downloadedAt = new Date().toISOString();
        }
    }

    function getPromptSessionStats() {
        const total = promptSessionData.images.size;
        const downloaded = promptSessionData.downloadedInSession.size;
        return {
            total,
            downloaded,
            remaining: total - downloaded,
            sessionId: promptSessionData.sessionId,
            startTime: promptSessionData.startTime,
            currentPrompt: promptSessionData.prompt
        };
    }

    function getPromptSessionUndownloaded() {
        const items = [];
        for (const [itemId, item] of promptSessionData.images) {
            if (!promptSessionData.downloadedInSession.has(itemId)) {
                items.push(item);
            }
        }
        return items;
    }

    function clearPromptSession() {
        promptSessionData.images.clear();
        promptSessionData.downloadedInSession.clear();
        promptSessionData.prompt = '';
        promptSessionData.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        promptSessionData.startTime = new Date().toISOString();
        Logger.info('Prompt session cleared');
    }

    function exportPromptSessionAsJSON() {
        updatePromptFromDOM();
        const exportData = {
            exportedAt: new Date().toISOString(),
            sessionId: promptSessionData.sessionId,
            startTime: promptSessionData.startTime,
            lastPrompt: promptSessionData.prompt,
            totalImages: promptSessionData.images.size,
            downloadedCount: promptSessionData.downloadedInSession.size,
            images: Array.from(promptSessionData.images.values()).map(img => ({
                id: img.id,
                url: img.url,
                prompt: img.prompt,
                filename: img.filename,
                addedAt: img.addedAt,
                downloaded: img.downloaded,
                downloadedAt: img.downloadedAt || null
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `grok-imagine-session-${promptSessionData.sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        Logger.info('Exported session data:', exportData.totalImages, 'images');
        return exportData;
    }

    // Load persisted download tracking
    function loadDownloadedIds() {
        try {
            const saved = GM_getValue(DOWNLOADED_IDS_KEY, '[]');
            const ids = JSON.parse(saved);
            downloadedIds = new Set(ids);
            Logger.info('Loaded', downloadedIds.size, 'previously downloaded items');
        } catch (e) {
            Logger.error('Failed to load download history:', e);
            downloadedIds = new Set();
        }
    }

    // Save download tracking
    function saveDownloadedIds() {
        try {
            const ids = Array.from(downloadedIds);
            GM_setValue(DOWNLOADED_IDS_KEY, JSON.stringify(ids));
        } catch (e) {
            Logger.error('Failed to save download history:', e);
        }
    }

    // Add ID and persist
    function markAsDownloaded(id) {
        downloadedIds.add(id);
        saveDownloadedIds();
    }

    // Clear download history
    function clearDownloadHistory() {
        downloadedIds = new Set();
        saveDownloadedIds();
        Logger.info('Download history cleared');
    }

    // Clear the in-memory media database
    function clearMediaDatabase() {
        mediaDatabase.clear();
        childToParentMap.clear();
        rootPostPageId = null;
        Logger.info('Media database cleared');
    }

    function getMediaDbKey() {
        return `${MEDIA_DB_KEY_PREFIX}:${window.location.pathname}`;
    }

    function getChildParentKey() {
        return `${CHILD_PARENT_KEY_PREFIX}:${window.location.pathname}`;
    }

    function saveMediaDatabase() {
        try {
            const payload = {
                version: 1,
                path: window.location.pathname,
                savedAt: Date.now(),
                entries: Array.from(mediaDatabase.entries())
            };
            const childPayload = {
                version: 1,
                path: window.location.pathname,
                savedAt: Date.now(),
                entries: Array.from(childToParentMap.entries())
            };
            GM_setValue(getMediaDbKey(), JSON.stringify(payload));
            GM_setValue(getChildParentKey(), JSON.stringify(childPayload));
        } catch (e) {
            Logger.error('Failed to save media database:', e);
        }
    }

    function loadMediaDatabase() {
        try {
            const raw = GM_getValue(getMediaDbKey(), '');
            const childRaw = GM_getValue(getChildParentKey(), '');
            if (!raw) return false;
            const payload = JSON.parse(raw);
            if (!payload?.entries || payload.path !== window.location.pathname) return false;
            mediaDatabase.clear();
            for (const [id, media] of payload.entries) {
                if (id && media?.object) {
                    mediaDatabase.set(id, media);
                }
            }

            childToParentMap.clear();
            if (childRaw) {
                const childPayload = JSON.parse(childRaw);
                if (childPayload?.entries && childPayload.path === window.location.pathname) {
                    for (const [childId, parentId] of childPayload.entries) {
                        if (childId && parentId) {
                            childToParentMap.set(childId, parentId);
                        }
                    }
                }
            }

            Logger.info('Loaded media database with', mediaDatabase.size, 'entries');
            return true;
        } catch (e) {
            Logger.error('Failed to load media database:', e);
            return false;
        }
    }

    function refreshMediaDatabase() {
        clearMediaDatabase();
        saveMediaDatabase();
        if (lastApiData) {
            processApiData(lastApiData);
        }
        updateSettingsStats();
        updateDownloadAllButton();
        updateOverlayPositions();
        if (currentPostPageId) {
            setTimeout(loadSinglePostPageData, 500);
        }
    }

    // Deduplicate items within each media entry
    function deduplicateDatabase() {
        let totalRemoved = 0;
        for (const [, media] of mediaDatabase) {
            const seenIds = new Set();
            const uniqueItems = [];
            for (const item of media.object) {
                if (!seenIds.has(item.id)) {
                    seenIds.add(item.id);
                    uniqueItems.push(item);
                } else {
                    totalRemoved++;
                }
            }
            media.object = uniqueItems;
        }
        Logger.info('Removed', totalRemoved, 'duplicates');
        return totalRemoved;
    }

    // Get database statistics
    function getDatabaseStats() {
        let totalEntries = mediaDatabase.size;
        let totalItems = 0;
        let totalVideos = 0;
        let totalImages = 0;
        const allIds = new Set();
        let duplicates = 0;

        for (const [, media] of mediaDatabase) {
            for (const item of media.object) {
                totalItems++;
                if (allIds.has(item.id)) {
                    duplicates++;
                } else {
                    allIds.add(item.id);
                }
                if (item.filename?.endsWith('.mp4')) {
                    totalVideos++;
                } else {
                    totalImages++;
                }
            }
        }

        return {
            entries: totalEntries,
            totalItems,
            uniqueItems: allIds.size,
            duplicates,
            videos: totalVideos,
            images: totalImages,
            downloaded: downloadedIds.size
        };
    }

    // Initialize on load
    loadDownloadedIds();
    if (loadMediaDatabase()) {
        updateDownloadAllButton();
    }

    function extractPostIdFromUrl(url) {
        if (!url) return null;
        const matches = [...url.matchAll(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g)];
        return matches.length > 0 ? matches[matches.length - 1][0] : null;
    }

    function sanitizeForFilename(str) {
        return (str || '').replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
    }

    function buildFilename(item) {
        const time = item.createTime ? item.createTime.slice(0, 19).replace(/:/g, '-') : 'unknown';
        const model = item.modelName ? sanitizeForFilename(item.modelName) : '';
        let prompt = item.prompt ? sanitizeForFilename(item.prompt) : '';

        if (prompt.length > 100) prompt = prompt.slice(0, 97) + '...';

        let ext = item.isVideo ? 'mp4' : 'jpg';
        if (item.mimeType) {
            if (item.mimeType === 'video/mp4') ext = 'mp4';
            else if (item.mimeType === 'image/png') ext = 'png';
            else if (item.mimeType === 'image/jpeg') ext = 'jpg';
        }

        return buildUnifiedFilename({
            time,
            id: item.id,
            model,
            prompt,
            ext
        });
    }

    function downloadFile(item, onComplete, persistDownload = true) {
        GM_download({
            url: item.url,
            name: item.filename,
            onload: () => {
                if (persistDownload) markAsDownloaded(item.id);
                onComplete();
            },
            onerror: onComplete,
            ontimeout: onComplete
        });
    }

    function startDownloads(media, _postId, button) {
        const all = media.object;
        if (all.length === 0) return;

        let completed = 0;
        let failed = 0;
        const total = all.length;

        button.textContent = `0/${total}`;
        button.style.pointerEvents = 'none';
        button.disabled = true;

        const onComplete = () => {
            completed++;
            button.textContent = `${completed}/${total}`;
            if ((completed + failed) === total) {
                button.disabled = failed === 0;
                setTimeout(() => {
                    button.textContent = failed > 0 ? 'ERR' : 'OK!';
                }, 500);
            }
        };

        all.forEach(item => {
            downloadFile(item, onComplete);
        });
    }

    function createMediaObject(source, fallbackParent) {
        const isVideo = source.mediaType === 'MEDIA_POST_TYPE_VIDEO';
        const url = isVideo && source.hdMediaUrl ? source.hdMediaUrl : source.mediaUrl;

        let item = {
            id: source.id,
            url: url,
            createTime: source.createTime || fallbackParent?.createTime || '',
            modelName: source.modelName || fallbackParent?.modelName || '',
            prompt: (source.originalPrompt || source.prompt || fallbackParent?.originalPrompt || fallbackParent?.prompt || '').trim(),
            isVideo: isVideo,
            mimeType: source.mimeType
        };

        const filename = buildFilename(item);

        return {
            id: item.id,
            url: item.url,
            createTime: item.createTime,
            modelName: item.modelName,
            prompt: item.prompt,
            filename: filename
        };
    }

    function processApiData(apiData) {
        if (!apiData?.posts) return;

        lastApiData = apiData;

        Logger.info('Processing', apiData.posts.length, 'posts from API');

        for (const post of apiData.posts) {
            if (!post.id) continue;

            Logger.debug('Processing post', post.id, '- has mediaUrl:', !!post.mediaUrl, 'childPosts:', post.childPosts?.length || 0, 'videos:', post.videos?.length || 0);

            // On single post pages, aggregate all media under the root post ID
            const targetId = rootPostPageId || post.id;

            let media = mediaDatabase.get(targetId);
            if (!media) {
                media = {id: targetId, object: []};
            }

            if (post.mediaUrl) {
                const item = createMediaObject(post, null);
                // Check for duplicates before adding
                if (!media.object.some(o => o.id === item.id)) {
                    media.object.push(item);
                    Logger.debug('Added main media item', item.id, 'to target', targetId);
                }
            }

            // Create parent image object (needed for child entries)
            const parentImageItem = post.mediaUrl ? createMediaObject(post, null) : null;

            // Process childPosts (includes videos generated from images)
            if (post.childPosts?.length) {
                Logger.debug('Processing', post.childPosts.length, 'childPosts for post', post.id);
                for (const child of post.childPosts) {
                    const item = createMediaObject(child, post);
                    // Check for duplicates before adding
                    if (!media.object.some(o => o.id === item.id)) {
                        media.object.push(item);
                        Logger.debug('Added child item', item.id, 'to target', targetId, '- total items now:', media.object.length);
                    }

                    // Create a separate entry for the child's own ID (for favorites page card buttons)
                    // Skip this on single post pages where we aggregate everything under root
                    if (!rootPostPageId && child.id && child.id !== post.id) {
                        let childMedia = mediaDatabase.get(child.id);
                        if (!childMedia) {
                            childMedia = {id: child.id, object: []};
                        }
                        // Add the parent image first (source image for the video)
                        if (parentImageItem && !childMedia.object.some(o => o.id === parentImageItem.id)) {
                            childMedia.object.push(parentImageItem);
                            Logger.debug('Created child entry', child.id, 'and added parent image', parentImageItem.id);
                        }
                        // Add the child item (video)
                        if (!childMedia.object.some(o => o.id === item.id)) {
                            childMedia.object.push(item);
                            Logger.debug('Added child video', item.id, 'to child entry', child.id, '- total items now:', childMedia.object.length);
                        }
                         mediaDatabase.set(child.id, childMedia);
                         childToParentMap.set(child.id, post.id);
                    }
                }
            }

            // Also process the videos array (some API responses use this instead of childPosts)
            if (post.videos?.length) {
                Logger.debug('Processing', post.videos.length, 'videos for post', post.id);
                for (const video of post.videos) {
                    const item = createMediaObject(video, post);
                    // Add to parent if not already there
                    if (!media.object.some(o => o.id === item.id)) {
                        media.object.push(item);
                        Logger.debug('Added video item', item.id, 'to target', targetId);
                    }

                    // Create separate entry for video's own ID (for favorites page card buttons)
                    // Skip this on single post pages where we aggregate everything under root
                    if (!rootPostPageId && video.id && video.id !== post.id) {
                        let videoMedia = mediaDatabase.get(video.id);
                        if (!videoMedia) {
                            videoMedia = {id: video.id, object: []};
                        }
                        // Add the parent image first (source image for the video)
                        if (parentImageItem && !videoMedia.object.some(o => o.id === parentImageItem.id)) {
                            videoMedia.object.push(parentImageItem);
                            Logger.debug('Created video entry', video.id, 'and added parent image', parentImageItem.id);
                        }
                        // Add the video
                        if (!videoMedia.object.some(o => o.id === item.id)) {
                            videoMedia.object.push(item);
                            Logger.debug('Added video', item.id, 'to video entry', video.id, '- total items now:', videoMedia.object.length);
                        }
                         mediaDatabase.set(video.id, videoMedia);
                         childToParentMap.set(video.id, post.id);
                    }
                }
            }

            if (media.object.length > 0) {
                mediaDatabase.set(targetId, media);
                Logger.debug('Final media entry for', targetId, 'has', media.object.length, 'items');
            }
        }

        // Run deduplication to clean up any duplicates
        deduplicateDatabase();

        saveMediaDatabase();

        // Update the floating button count
        updateDownloadAllButton();
    }

    function processCards() {
        if (isPromptLikePage(detectPageType())) {
            processPendingPromptButtons();
            return;
        }
        const cards = document.querySelectorAll(CARD_SELECTOR);

        Logger.debug('Found', document.querySelectorAll('.group\\/media-post-masonry-card').length, 'total cards in DOM');
        Logger.debug('Found', cards.length, 'unprocessed cards (without data-downloader-added)');

        Logger.debug('Processing', cards.length, 'cards');

        for (const card of cards) {
            const container = card.querySelector(BUTTON_CONTAINER_SELECTOR);
            if (!container) {
                Logger.warn("No button container found!", card);
                continue;
            }

            const img = card.querySelector('img');
            const video = card.querySelector('video');
            const src = img?.currentSrc || img?.src || img?.dataset?.src || img?.dataset?.lazy ||
                video?.poster || video?.dataset?.src || video?.dataset?.lazy || '';

            const postId = extractPostIdFromUrl(src);
            Logger.debug('Card src:', src.substring(0, 100) + '...', '-> extracted postId:', postId);

            if (!postId) {
                Logger.debug('No postId extracted from src, skipping card');
                continue;
            }

            Logger.debug('Processing card with postId:', postId);

            let media = mediaDatabase.get(postId);
            let displayCount = 0;

            // Prefer parent aggregation for child posts (favorites page cards)
            if (childToParentMap.has(postId)) {
                const parentId = childToParentMap.get(postId);
                const parentMedia = mediaDatabase.get(parentId);
                if (parentMedia?.object?.length) {
                    media = parentMedia;
                    displayCount = parentMedia.object.length;
                    Logger.debug('Child post', postId, 'using parent', parentId, 'count:', displayCount);
                }
            }

            if (!displayCount && media) {
                displayCount = media.object.length;
                Logger.debug('Found media for postId:', postId, 'with', displayCount, 'items');
            }

            if (!media) {
                Logger.debug('No media found for postId:', postId, '- available keys:', Array.from(mediaDatabase.keys()).slice(0, 5));
                continue;
            }

            card.setAttribute('data-downloader-added', 'true');

            const btn = document.createElement('button');
            btn.innerHTML = DOWNLOAD_ICON;
            btn.className = BUTTON_CLASSES;
            btn.title = `Download ${displayCount} media`;
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                startDownloads(media, postId, btn);
            });

            container.prepend(btn);
        }
    }

    const origFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async function (url, options) {
        const resp = await origFetch(url, options);
        if (typeof url === 'string') {
            // Handle /rest/media/post/list (favorites page, etc.)
            if (url.includes('/rest/media/post/list')) {
                // Skip API interception on single post pages - we use DOM extraction instead
                // to avoid aggregating unrelated posts that may be returned by the API
                if (!currentPostPageId) {
                    try {
                        const clone = resp.clone();
                        const data = await clone.json();
                        processApiData(data);
                        debouncedProcessCards();
                    } catch (e) {
                        Logger.error('API intercept error:', e);
                    }
                } else {
                    Logger.debug('Skipping API intercept on single post page (using DOM extraction)');
                }
            }

            // Handle /rest/media/post/create (prompt page image generation)
            if (url.includes('/rest/media/post/create')) {
                try {
                    const clone = resp.clone();
                    const data = await clone.json();
                    if (data?.post) {
                        processCreatedPost(data.post);
                    }
                } catch (e) {
                    Logger.error('Post create intercept error:', e);
                }
            }
        }
        return resp;
    };

    // Process a newly created post from the /rest/media/post/create API
    function processCreatedPost(post) {
        if (!post?.id || !post?.mediaUrl) {
            Logger.debug('Skipping post without id or mediaUrl:', post);
            return;
        }

        Logger.debug('Processing newly created post:', post.id, 'prompt:', post.prompt?.substring(0, 50));

        // Build the image data object
        const imageData = {
            id: post.id,
            url: post.mediaUrl,
            prompt: post.originalPrompt || post.prompt || '',
            createTime: post.createTime || new Date().toISOString(),
            modelName: post.modelName || '',
            filename: buildPromptFilename(post.id, post.originalPrompt || post.prompt || '')
        };

        // Add to prompt session (ephemeral tracking)
        if (addToPromptSession(imageData)) {
            Logger.debug('Added to prompt session via API intercept:', imageData.id);
            // Update the download button
            updateDownloadAllButton();

            // Also try to find and add download button to the corresponding DOM element
            // The image may not be in DOM yet, so we'll retry a few times
            queuePendingPromptButton(post.id, imageData);
            setTimeout(() => addDownloadButtonByImageId(post.id, imageData), 200);
            setTimeout(() => addDownloadButtonByImageId(post.id, imageData), 500);
            setTimeout(() => addDownloadButtonByImageId(post.id, imageData), 1000);
        }
    }

    function queuePendingPromptButton(imageId, imageData) {
        if (!pendingPromptButtons.has(imageId)) {
            pendingPromptButtons.set(imageId, {
                imageData,
                attempts: 0,
                lastAttempt: 0
            });
        }
    }

    function processPendingPromptButtons() {
        if (pendingPromptButtons.size === 0) return;

        const now = Date.now();
        for (const [imageId, pending] of pendingPromptButtons) {
            if (pending.attempts >= 30) {
                pendingPromptButtons.delete(imageId);
                continue;
            }

            if (now - pending.lastAttempt < 400) continue;

            pending.attempts += 1;
            pending.lastAttempt = now;

            const added = addDownloadButtonByImageId(imageId, pending.imageData);
            if (added) {
                pendingPromptButtons.delete(imageId);
            }
        }
    }

    // Find an image by ID in the DOM and add download button
    function addDownloadButtonByImageId(imageId, imageData) {
        // Look for the image in cards
        const cards = document.querySelectorAll(PROMPT_CARD_SELECTOR);
        for (const card of cards) {
            // Check if this card already has a download button
            if (card.querySelector('.grok-prompt-download-btn')) continue;

            const img = card.querySelector('img');
            if (!img) continue;

            if (img.src && img.src.startsWith('data:')) {
                queuePendingPromptButton(imageId, imageData);
                continue;
            }

            // Check if this is our image
            let matchesId = false;

            const imgSrc = img.currentSrc || img.getAttribute('data-src') || img.src || '';

            // Check CDN URL patterns
            if (imgSrc.includes(imageId)) {
                matchesId = true;
            }
            // Check data URI images via React fiber
            else if (imgSrc.startsWith('data:')) {
                const fiberId = extractIdFromReactFiber(card);
                if (fiberId === imageId) {
                    matchesId = true;
                }
            }

            if (matchesId) {
                imageData.url = resolvePromptImageUrl(imageData, img);
                addDownloadButtonToPromptImage(img, imageData);
                Logger.debug('Added download button to image:', imageId);
                return true;
            }
        }
        return false;
    }

    let debounceTimer;
    const debouncedProcessCards = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processCards();
            processPendingPromptButtons();
        }, 120);
    };

    function onBodyReady(callback) {
        if (document.body) {
            callback();
            return;
        }
        document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
    }

    onBodyReady(() => {
        const observer = new MutationObserver(debouncedProcessCards);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'data-src', 'data-lazy', 'poster']
        });

        debouncedProcessCards();
    });

    // =========================================================================
    // Prompt Page Support (/imagine)
    // Primary method: Intercepts /rest/media/post/create API for newly generated images
    // Fallback: DOM scanning for images that may have been loaded before script init
    // Uses session-based tracking (not persisted) since images are temporary
    // =========================================================================

    // Selector for prompt page image card containers (same as favorites)
    const PROMPT_CARD_SELECTOR = '.group\\/media-post-masonry-card';

    // Helper to extract UUID from React fiber (fallback for DOM-based detection)
    function extractIdFromReactFiber(element) {
        const keys = Object.keys(element);
        const fiberKey = keys.find(k => k.startsWith('__reactFiber'));
        if (!fiberKey) return null;

        try {
            let fiber = element[fiberKey];
            const visited = new Set();
            const queue = [fiber];

            while (queue.length > 0) {
                const current = queue.shift();
                if (!current || visited.has(current)) continue;
                visited.add(current);

                // Check memoizedProps for UUIDs
                const props = current.memoizedProps || current.pendingProps;
                if (props) {
                    try {
                        const propsStr = JSON.stringify(props, (_key, val) => {
                            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                                const shallow = {};
                                for (const k of Object.keys(val).slice(0, 10)) {
                                    if (typeof val[k] !== 'object') shallow[k] = val[k];
                                }
                                return shallow;
                            }
                            return val;
                        });
                        const uuidMatch = propsStr.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
                        if (uuidMatch) return uuidMatch[0];
                    } catch (e) { /* ignore */ }
                }

                if (current.child && !visited.has(current.child)) queue.push(current.child);
                if (current.sibling && !visited.has(current.sibling)) queue.push(current.sibling);
                if (visited.size > 50) break;
            }
        } catch (e) {
            Logger.error('Error extracting ID from fiber:', e);
        }
        return null;
    }

    // Get userId from page (needed to construct download URLs for data URI images)
    function getUserIdFromPage() {
        // Try to get from cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'x-userid') return value;
        }
        // Try to get from existing CDN image
        const cdnImg = document.querySelector('img[src*="assets.grok.com/users/"]');
        if (cdnImg) {
            const match = cdnImg.src.match(/users\/([a-f0-9-]+)\//);
            if (match) return match[1];
        }
        return null;
    }

    // Fallback: Extract images from DOM (for images loaded before script init)
    function extractPromptPageImages() {
        if (!isPromptLikePage(detectPageType())) return [];

        const images = [];
        const userId = getUserIdFromPage();

        document.querySelectorAll(PROMPT_CARD_SELECTOR).forEach(card => {
            const img = card.querySelector('img');
            if (!img) return;

            // Skip tiny images (icons, avatars, etc.)
            if (img.width < 100 || img.height < 100) return;

            let imageId = null;
            let imageUrl = null;

            // Check if it's a CDN URL first (imagine-public.x.ai is the primary format)
            const imgSrc = img.currentSrc || img.getAttribute('data-src') || img.src || '';

            if (imgSrc.includes('imagine-public.x.ai')) {
                // Format: imagine-public.x.ai/imagine-public/images/{id}.jpg
                const match = imgSrc.match(/images\/([a-f0-9-]+)\./);
                if (match) {
                    imageId = match[1];
                    // Remove any CDN resize params to get full resolution
                    imageUrl = imgSrc.replace(/\/cdn-cgi\/image\/[^/]+\//, '/').split('?')[0];
                }
            } else if (imgSrc.includes('assets.grok.com')) {
                // Format: assets.grok.com/users/{userId}/generated/{id}/preview_image.jpg or image.jpg
                const match = imgSrc.match(/generated\/([a-f0-9-]+)\//);
                if (match) {
                    imageId = match[1];
                    // Use the full-res image.jpg URL for download
                    imageUrl = imgSrc.replace('/preview_image.jpg', '/image.jpg').split('?')[0];
                }
            } else if (imgSrc.startsWith('data:')) {
                // Data URI - extract ID from React fiber
                imageId = extractIdFromReactFiber(card);
                if (imageId && userId) {
                    // Construct CDN URL from ID - use imagine-public format
                    imageUrl = `https://imagine-public.x.ai/imagine-public/images/${imageId}.jpg`;
                }
            }

            if (imageId && !images.some(i => i.id === imageId)) {
                images.push({
                    id: imageId,
                    url: imageUrl,
                    element: img,
                    prompt: getPromptForCard(card)
                });
            }
        });

        return images;
    }

    // Fallback DOM scanning for prompt page (for images that were already on page)
    function processPromptPageImages() {
        if (!isPromptLikePage(detectPageType())) return;

        const images = extractPromptPageImages();
        let addedCount = 0;

        for (const img of images) {
            // Skip if already in session (likely added via API intercept)
            if (promptSessionData.images.has(img.id)) {
                // But still add download button if missing
                if (!img.element.closest('.relative, .group, [class*="card"]')?.querySelector('.grok-prompt-download-btn')) {
                    const existingData = promptSessionData.images.get(img.id);
                    addDownloadButtonToPromptImage(img.element, existingData);
                }
                continue;
            }

            if (!img.prompt) {
                updatePromptFromDOM();
            }
            const imageData = {
                id: img.id,
                url: img.url,
                prompt: img.prompt || promptSessionData.prompt,
                createTime: new Date().toISOString(),
                filename: buildPromptFilename(img.id, img.prompt || promptSessionData.prompt)
            };

            if (addToPromptSession(imageData)) {
                addedCount++;
                // Add download button to the image
                addDownloadButtonToPromptImage(img.element, imageData);
                pendingPromptButtons.delete(img.id);
            }
        }

        if (addedCount > 0) {
            Logger.info('Added', addedCount, 'new prompt page images via DOM scan');
            updateDownloadAllButton();
        }
    }

    function buildPromptFilename(id, prompt) {
        const time = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        let sanitizedPrompt = sanitizeForFilename(prompt || 'no-prompt');
        if (sanitizedPrompt.length > 100) {
            sanitizedPrompt = sanitizedPrompt.slice(0, 97) + '...';
        }
        return buildUnifiedFilename({
            time,
            id,
            model: '',
            prompt: sanitizedPrompt,
            ext: 'jpg'
        });
    }

    function buildUnifiedFilename({ time, id, model, prompt, ext }) {
        const parts = ['grok', time || 'unknown', id || 'unknown'];
        if (model) parts.push(model);
        if (prompt) parts.push(prompt);
        return `${parts.join('_')}.${ext}`;
    }

    function addDownloadButtonToPromptImage(imgElement, imageData) {
        // Find the parent container that holds the image
        let container = imgElement.closest('.relative, .group, [class*="card"]');
        if (!container) {
            container = imgElement.parentElement;
        }
        if (!container) return;

        // Check if we already added a button
        if (container.querySelector('.grok-prompt-download-btn')) return;

        // Mark the container
        container.style.position = 'relative';

        const btn = document.createElement('button');
        btn.className = 'grok-prompt-download-btn';
        btn.innerHTML = DOWNLOAD_ICON;
        btn.title = 'Download this image';
        const hasBottomRightAction = !!container.querySelector('.absolute.bottom-2.right-2 button');
        const rightOffset = hasBottomRightAction ? 52 : 8;

        btn.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: ${rightOffset}px;
            z-index: 100;
            width: 36px;
            height: 36px;
            padding: 6px;
            background: rgba(0, 0, 0, 0.6);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            opacity: 0;
            pointer-events: auto;
        `;

        // Show on hover
        container.addEventListener('mouseenter', () => {
            btn.style.opacity = '1';
        });
        container.addEventListener('mouseleave', () => {
            btn.style.opacity = '0';
        });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const resolvedUrl = resolvePromptImageUrl(imageData, imgElement);
            if (!resolvedUrl) {
                btn.innerHTML = '✗';
                btn.style.background = 'rgba(128, 0, 0, 0.6)';
                btn.disabled = false;
                return;
            }

            imageData.url = resolvedUrl;
            promptSessionData.images.set(imageData.id, imageData);

            btn.innerHTML = '⏳';
            btn.disabled = true;

            GM_download({
                url: resolvedUrl,
                name: imageData.filename,
                onload: () => {
                    markPromptSessionDownloaded(imageData.id);
                    markAsDownloaded(imageData.id);
                    btn.innerHTML = '✓';
                    btn.style.background = 'rgba(0, 128, 0, 0.6)';
                    updateDownloadAllButton();
                },
                onerror: () => {
                    btn.innerHTML = '✗';
                    btn.style.background = 'rgba(128, 0, 0, 0.6)';
                    btn.disabled = false;
                },
                ontimeout: () => {
                    btn.innerHTML = '✗';
                    btn.style.background = 'rgba(128, 0, 0, 0.6)';
                    btn.disabled = false;
                }
            });
        });

        container.appendChild(btn);
    }

    function resolvePromptImageUrl(imageData, imgElement) {
        if (imageData?.url && !imageData.url.startsWith('data:')) {
            return imageData.url;
        }

        const imgSrc = imgElement?.currentSrc || imgElement?.getAttribute?.('data-src') || imgElement?.src || '';
        if (imgSrc.includes('imagine-public.x.ai')) {
            return imgSrc.replace(/\/cdn-cgi\/image\/[^/]+\//, '/').split('?')[0];
        }
        if (imgSrc.includes('assets.grok.com')) {
            return imgSrc.replace('/preview_image.jpg', '/image.jpg').split('?')[0];
        }
        if (imgSrc.startsWith('data:') && imageData?.id) {
            return `https://imagine-public.x.ai/imagine-public/images/${imageData.id}.jpg`;
        }
        return imageData?.url || null;
    }

    // Set up observer for prompt page
    let promptPageObserver = null;

    function setupPromptPageObserver() {
        if (!isPromptLikePage(detectPageType())) {
            if (promptPageObserver) {
                promptPageObserver.disconnect();
                promptPageObserver = null;
            }
            return;
        }

        if (promptPageObserver) return; // Already set up

        Logger.info('Setting up prompt page observer');

        // Initial scan
        setTimeout(processPromptPageImages, 500);

        // Watch for new images
        promptPageObserver = new MutationObserver(() => {
            // Debounce the processing
            clearTimeout(promptPageObserver._debounceTimer);
            promptPageObserver._debounceTimer = setTimeout(processPromptPageImages, 200);
        });

        promptPageObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src']
        });
    }

    // =========================================================================
    // Single Post Page Support
    // On /imagine/post/{id} pages, we need to fetch all children manually
    // =========================================================================

    function extractVideoUrlsFromDOM() {
        // On single post pages, video URLs are visible in the DOM
        const videoData = [];

        // Get thumbnail images that indicate videos
        document.querySelectorAll('img').forEach(img => {
            if (img.src.includes('assets.grok.com') && img.src.includes('preview_image')) {
                const match = img.src.match(/generated\/([a-f0-9-]+)\//);
                if (match) {
                    const videoId = match[1];
                    videoData.push({
                        id: videoId,
                        previewUrl: img.src,
                        videoUrl: img.src.replace('preview_image.jpg', 'generated_video.mp4').split('?')[0]
                    });
                }
            }
        });

        // Also check actual video elements
        document.querySelectorAll('video').forEach(video => {
            if (video.src && video.src.includes('generated_video.mp4')) {
                const match = video.src.match(/generated\/([a-f0-9-]+)\//);
                if (match) {
                    const videoId = match[1];
                    if (!videoData.some(v => v.id === videoId)) {
                        videoData.push({
                            id: videoId,
                            previewUrl: video.poster,
                            videoUrl: video.src.split('?')[0]
                        });
                    }
                }
            }
        });

        return videoData;
    }

    // Track the root post ID for single post pages (doesn't change when switching tabs)
    let rootPostPageId = null;

    function extractImageUrlsFromDOM() {
        const imageData = [];

        document.querySelectorAll('img').forEach(img => {
            // Format 1: imagine-public.x.ai/imagine-public/images/{id}.jpg
            if (img.src.includes('imagine-public.x.ai')) {
                const match = img.src.match(/images\/([a-f0-9-]+)\./);
                if (match) {
                    const imageId = match[1];
                    if (!imageData.some(i => i.id === imageId)) {
                        imageData.push({
                            id: imageId,
                            url: img.src.split('?')[0]
                        });
                    }
                }
            }
            // Format 2: assets.grok.com/users/{userId}/generated/{id}/image.jpg
            else if (img.src.includes('assets.grok.com') && img.src.includes('/image.jpg')) {
                const match = img.src.match(/generated\/([a-f0-9-]+)\/image\.jpg/);
                if (match) {
                    const imageId = match[1];
                    if (!imageData.some(i => i.id === imageId)) {
                        imageData.push({
                            id: imageId,
                            url: img.src.split('?')[0]
                        });
                    }
                }
            }
        });

        return imageData;
    }

    async function loadSinglePostPageData() {
        // Check if we're on a single post page
        if (!currentPostPageId) return;

        // Set the root post ID on first load (this is what we aggregate media under)
        if (!rootPostPageId) {
            rootPostPageId = currentPostPageId;
        }

        Logger.debug('Scanning single post page for:', currentPostPageId, '(root:', rootPostPageId, ')');

        // On single post pages, we DON'T use API interception
        // because that returns data for multiple posts and causes inflated counts.
        // Instead, we extract media directly from the DOM which shows only visible content.

        // 1. Extract image URLs from the DOM (handles both URL formats)
        const imageData = extractImageUrlsFromDOM();
        Logger.debug('Found', imageData.length, 'images in DOM');

        // 2. Extract video URLs from the DOM
        const videoData = extractVideoUrlsFromDOM();
        Logger.debug('Found', videoData.length, 'videos in DOM');

        // 3. Create/update the entry for the ROOT post page (aggregate all media)
        let postMedia = mediaDatabase.get(rootPostPageId);
        if (!postMedia) {
            postMedia = { id: rootPostPageId, object: [] };
        }

        // Add images
        for (const image of imageData) {
            const imageItem = {
                id: image.id,
                url: image.url,
                createTime: '',
                modelName: '',
                prompt: '',
                filename: `${image.id}.jpg`
            };
            if (!postMedia.object.some(o => o.id === image.id)) {
                postMedia.object.push(imageItem);
            }
        }

        // Add videos
        for (const video of videoData) {
            const videoItem = {
                id: video.id,
                url: video.videoUrl,
                createTime: '',
                modelName: '',
                prompt: '',
                filename: `${video.id}.mp4`
            };
            if (!postMedia.object.some(o => o.id === video.id)) {
                postMedia.object.push(videoItem);
            }
        }

        if (postMedia.object.length > 0) {
            mediaDatabase.set(rootPostPageId, postMedia);
            Logger.debug('Root post now has', postMedia.object.length, 'items');
        }

        saveMediaDatabase();
        updateDownloadAllButton();
    }

    // Load single post page data when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(loadSinglePostPageData, 500);
        });
    } else {
        setTimeout(loadSinglePostPageData, 500);
    }

    // =========================================================================
    // Floating "Download All" Button
    // =========================================================================

    // (moved declarations near top)

    function getOrCreateOverlayRoot() {
        if (overlayRoot && document.documentElement?.contains(overlayRoot)) {
            return overlayRoot;
        }

        if (!document.documentElement) return null;

        overlayRoot = document.getElementById('grok-downloader-overlay-root');
        if (!overlayRoot) {
            overlayRoot = document.createElement('div');
            overlayRoot.id = 'grok-downloader-overlay-root';
            overlayRoot.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 10000;
                pointer-events: none;
            `;
            document.documentElement.appendChild(overlayRoot);
        }

        return overlayRoot;
    }

    function getBottomOffsetForDownloadAll() {
        let baseBottom = 20;
        const exportBtn = document.getElementById('grok-export-button');
        if (exportBtn) {
            const rect = exportBtn.getBoundingClientRect();
            if (rect.width && rect.height) {
                const distanceFromBottomToTop = window.innerHeight - rect.top;
                baseBottom = Math.max(baseBottom, distanceFromBottomToTop + 10);
            }
        }
        return baseBottom;
    }

    function updateOverlayPositions() {
        if (!downloadAllBtn) return;
        const baseBottom = getBottomOffsetForDownloadAll();
        downloadAllBtn.style.bottom = `${baseBottom}px`;

        if (settingsBtn) {
            const downloadRect = downloadAllBtn.getBoundingClientRect();
            const downloadHeight = downloadRect.height || 40;
            const settingsBottom = baseBottom + downloadHeight + 10;
            settingsBtn.style.bottom = `${settingsBottom}px`;

            if (settingsPanel) {
                settingsPanel.style.bottom = `${settingsBottom + 50}px`;
            }
        }
    }

    function getUndownloadedItems() {
        const items = [];
        const seenIds = new Set();
        const pageType = detectPageType();

        // On prompt-like pages, use session-based tracking only
        if (isPromptLikePage(pageType)) {
            return getPromptSessionUndownloaded();
        }

        // On single post pages, only get items for the ROOT post (aggregated media)
        const postId = rootPostPageId || currentPostPageId;
        if (postId && pageType === PAGE_TYPE.SINGLE_POST) {
            const media = mediaDatabase.get(postId);
            if (media) {
                for (const item of media.object) {
                    if (!downloadedIds.has(item.id) && !seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        items.push(item);
                    }
                }
            }
            return items;
        }

        // On favorites/other pages, get all items from the persisted database
        for (const [, media] of mediaDatabase) {
            for (const item of media.object) {
                if (!downloadedIds.has(item.id) && !seenIds.has(item.id)) {
                    seenIds.add(item.id);
                    items.push(item);
                }
            }
        }
        return items;
    }

    function updateDownloadAllButton() {
        if (!downloadAllBtn) return;
        if (isDownloadingAll) {
            // Show cancel option while downloading
            downloadAllBtn.disabled = false;
            return;
        }

        const undownloaded = getUndownloadedItems();
        const count = undownloaded.length;
        const pageType = detectPageType();

        // Page-specific labels
        let label = 'Download All';
        if (isPromptLikePage(pageType)) {
            label = 'Download Session';
        } else if (pageType === PAGE_TYPE.FAVORITES) {
            label = 'Download Favorites';
        } else if (pageType === PAGE_TYPE.SINGLE_POST) {
            label = 'Download Post';
        }

        if (count === 0) {
            downloadAllBtn.textContent = '✓ All Done';
            downloadAllBtn.disabled = true;
            downloadAllBtn.style.opacity = '0.6';
        } else {
            downloadAllBtn.textContent = `⬇ ${label} (${count})`;
            downloadAllBtn.disabled = false;
            downloadAllBtn.style.opacity = '1';
        }
        updateOverlayPositions();
    }

    function handleDownloadButtonClick() {
        if (isDownloadingAll) {
            // Cancel the download
            cancelDownload = true;
            downloadAllBtn.textContent = 'Cancelling...';
            downloadAllBtn.disabled = true;
        } else {
            // Start downloading
            startDownloadAll();
        }
    }

    function startDownloadAll() {
        const items = getUndownloadedItems();
        if (items.length === 0 || isDownloadingAll) return;

        const pageType = detectPageType();
        const isPromptPage = isPromptLikePage(pageType);

        isDownloadingAll = true;
        cancelDownload = false;
        let completed = 0;
        let failed = 0;
        const total = items.length;

        downloadAllBtn.textContent = `⏹ Cancel (0/${total})`;
        downloadAllBtn.disabled = false;
        downloadAllBtn.style.opacity = '1';

        const downloadNext = (index) => {
            // Check if cancelled
            if (cancelDownload) {
                isDownloadingAll = false;
                cancelDownload = false;
                downloadAllBtn.textContent = `Cancelled (${completed}/${total} done)`;
                downloadAllBtn.disabled = false;
                setTimeout(updateDownloadAllButton, 2000);
                return;
            }

            if (index >= items.length) {
                // All done
                isDownloadingAll = false;
                setTimeout(() => {
                    if (failed > 0) {
                        downloadAllBtn.textContent = `Done (${failed} failed)`;
                    } else {
                        downloadAllBtn.textContent = '✓ All Done';
                    }
                    downloadAllBtn.style.opacity = '0.6';
                    downloadAllBtn.disabled = true;
                    // Refresh count after a moment
                    setTimeout(updateDownloadAllButton, 2000);
                }, 500);
                return;
            }

            const item = items[index];

            // Custom download handler for prompt page items
            if (isPromptPage) {
                GM_download({
                    url: item.url,
                    name: item.filename,
                    onload: () => {
                        markPromptSessionDownloaded(item.id);
                        markAsDownloaded(item.id);
                        completed++;
                        if (!cancelDownload) {
                            downloadAllBtn.textContent = `⏹ Cancel (${completed}/${total})`;
                        }
                        setTimeout(() => downloadNext(index + 1), 100);
                    },
                    onerror: () => {
                        failed++;
                        setTimeout(() => downloadNext(index + 1), 100);
                    },
                    ontimeout: () => {
                        failed++;
                        setTimeout(() => downloadNext(index + 1), 100);
                    }
                });
            } else {
                // Standard download for favorites/post pages
                downloadFile(item, () => {
                    completed++;
                    if (!cancelDownload) {
                        downloadAllBtn.textContent = `⏹ Cancel (${completed}/${total})`;
                    }
                    // Small delay between downloads to avoid overwhelming the browser
                    setTimeout(() => downloadNext(index + 1), 100);
                }, true);
            }
        };

        // Start downloading (sequential to avoid browser limits)
        downloadNext(0);
    }

    function createDownloadAllButton() {
        // Only show on /imagine pages
        if (!window.location.pathname.includes('/imagine')) return;

        const root = getOrCreateOverlayRoot();
        if (!root) {
            setTimeout(createDownloadAllButton, 100);
            return;
        }

        if (downloadAllBtn) {
            if (!root.contains(downloadAllBtn)) {
                root.appendChild(downloadAllBtn);
            }
            updateDownloadAllButton();
            return;
        }

        downloadAllBtn = document.createElement('button');
        downloadAllBtn.id = 'grok-download-all-btn';
        downloadAllBtn.textContent = '⬇ Download All (0)';
        downloadAllBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            padding: 12px 20px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 25px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            pointer-events: auto;
        `;

        downloadAllBtn.addEventListener('mouseenter', () => {
            if (!downloadAllBtn.disabled) {
                downloadAllBtn.style.transform = 'scale(1.05)';
                downloadAllBtn.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.4)';
            }
        });

        downloadAllBtn.addEventListener('mouseleave', () => {
            downloadAllBtn.style.transform = 'scale(1)';
            downloadAllBtn.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';
        });

        downloadAllBtn.addEventListener('click', handleDownloadButtonClick);

        root.appendChild(downloadAllBtn);
        updateDownloadAllButton();
        updateOverlayPositions();

        // Also create settings panel
        createSettingsPanel();
    }

    function ensureDownloadAllButton() {
        if (!window.location.pathname.includes('/imagine')) return;
        if (downloadAllBtn && document.documentElement && document.documentElement.contains(downloadAllBtn)) return;
        downloadAllBtn = null;
        createDownloadAllButton();
        updateOverlayPositions();
    }

    function ensureSettingsPanel() {
        if (!window.location.pathname.includes('/imagine')) return;
        if (settingsBtn && document.documentElement && document.documentElement.contains(settingsBtn)) return;
        createSettingsPanel();
        updateOverlayPositions();
    }

    // =========================================================================
    // Settings Panel
    // =========================================================================

    let settingsPanel = null;
    let settingsBtn = null;

    function createSettingsPanel() {
        if (settingsPanel) {
            const root = getOrCreateOverlayRoot();
            if (root && !root.contains(settingsPanel)) {
                root.appendChild(settingsPanel);
            }
            if (root && settingsBtn && !root.contains(settingsBtn)) {
                root.appendChild(settingsBtn);
            }
            return;
        }

        // Settings button (gear icon)
        settingsBtn = document.createElement('button');
        settingsBtn.id = 'grok-downloader-settings-btn';
        settingsBtn.innerHTML = '⚙️';
        settingsBtn.title = 'Downloader Settings';
        settingsBtn.style.cssText = `
            position: fixed;
            bottom: 70px;
            right: 20px;
            z-index: 10000;
            width: 40px;
            height: 40px;
            padding: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            font-size: 18px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
            pointer-events: auto;
        `;
        settingsBtn.addEventListener('click', toggleSettingsPanel);
        const root = getOrCreateOverlayRoot();
        if (root) {
            root.appendChild(settingsBtn);
        }

        // Settings panel
        settingsPanel = document.createElement('div');
        settingsPanel.id = 'grok-downloader-settings-panel';
        settingsPanel.style.cssText = `
            position: fixed;
            bottom: 120px;
            right: 20px;
            z-index: 10001;
            width: 300px;
            padding: 16px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            display: none;
            pointer-events: auto;
        `;

        settingsPanel.innerHTML = `
            <div style="font-weight: bold; font-size: 15px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">
                📥 Downloader Settings
            </div>
            <div id="grok-page-type" style="margin-bottom: 8px; padding: 6px 8px; background: rgba(100,100,200,0.3); border-radius: 6px; font-size: 11px; text-align: center;">
                Loading page info...
            </div>
            <div id="grok-stats" style="margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; font-size: 12px;">
                Loading stats...
            </div>
            <div id="grok-prompt-section" style="display: none; margin-bottom: 12px; padding: 8px; background: rgba(50,100,50,0.2); border-radius: 6px; border: 1px solid rgba(100,200,100,0.3);">
                <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">🎨 Prompt Session</div>
                <div id="grok-prompt-stats" style="font-size: 11px; margin-bottom: 8px;">
                    No images captured yet
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <button id="grok-export-session-btn" style="padding: 6px 10px; background: #2d6a4f; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                        📄 Export Session (JSON)
                    </button>
                    <button id="grok-clear-prompt-session-btn" style="padding: 6px 10px; background: #8b4513; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
                        🗑️ Clear Session
                    </button>
                </div>
            </div>
            <div id="grok-favorites-section" style="display: flex; flex-direction: column; gap: 8px;">
                <button id="grok-dedupe-btn" style="padding: 8px 12px; background: #2a5298; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    🔄 Remove Duplicates
                </button>
                <button id="grok-refresh-db-btn" style="padding: 8px 12px; background: #2d6a4f; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    ♻️ Refresh Media Database
                </button>
                <button id="grok-clear-session-btn" style="padding: 8px 12px; background: #8b4513; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    🗑️ Clear Session Data
                </button>
                <button id="grok-clear-history-btn" style="padding: 8px 12px; background: #8b0000; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    ⚠️ Clear Download History
                </button>
            </div>
            <div id="grok-log-level-section" style="margin-top: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                <div style="font-weight: bold; font-size: 12px; margin-bottom: 8px;">📋 Log Level</div>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button class="grok-log-btn" data-level="0" style="padding: 4px 8px; background: #333; color: #888; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px;">Off</button>
                    <button class="grok-log-btn" data-level="1" style="padding: 4px 8px; background: #333; color: #ff4444; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px;">Error</button>
                    <button class="grok-log-btn" data-level="2" style="padding: 4px 8px; background: #333; color: #ffaa00; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px;">Warn</button>
                    <button class="grok-log-btn" data-level="3" style="padding: 4px 8px; background: #333; color: #44aaff; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px;">Info</button>
                    <button class="grok-log-btn" data-level="4" style="padding: 4px 8px; background: #333; color: #44ff44; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px;">Debug</button>
                </div>
                <div id="grok-log-level-desc" style="margin-top: 6px; font-size: 10px; color: rgba(255,255,255,0.5);">
                    Current: Info
                </div>
            </div>
            <div style="margin-top: 12px; font-size: 11px; color: rgba(255,255,255,0.6);">
                Favorites: persisted across sessions.<br>
                Prompt page: session-only (export to save).
            </div>
        `;

        if (root) {
            root.appendChild(settingsPanel);
        }

        // Add event listeners
        document.getElementById('grok-dedupe-btn').addEventListener('click', () => {
            const removed = deduplicateDatabase();
            updateSettingsStats();
            updateDownloadAllButton();
            updateOverlayPositions();
            saveMediaDatabase();
            alert(`Removed ${removed} duplicate entries.`);
        });

        document.getElementById('grok-refresh-db-btn').addEventListener('click', () => {
            if (confirm('Refresh media database? This will clear stored items and reload from the latest API data.')) {
                refreshMediaDatabase();
            }
        });

        document.getElementById('grok-clear-session-btn').addEventListener('click', () => {
            if (confirm('Clear all session data? This will reset the media database for this page.')) {
                clearMediaDatabase();
                saveMediaDatabase();
                updateSettingsStats();
                updateDownloadAllButton();
                updateOverlayPositions();
            }
        });

        document.getElementById('grok-clear-history-btn').addEventListener('click', () => {
            if (confirm('Clear download history? All items will appear as not downloaded.')) {
                clearDownloadHistory();
                updateSettingsStats();
                updateDownloadAllButton();
                updateOverlayPositions();
            }
        });

        // Prompt session buttons
        document.getElementById('grok-export-session-btn').addEventListener('click', () => {
            const stats = getPromptSessionStats();
            if (stats.total === 0) {
                alert('No images in session to export.');
                return;
            }
            exportPromptSessionAsJSON();
            alert(`Exported ${stats.total} images to JSON file.`);
        });

        document.getElementById('grok-clear-prompt-session-btn').addEventListener('click', () => {
            const stats = getPromptSessionStats();
            if (stats.total === 0) {
                alert('Session is already empty.');
                return;
            }
            if (confirm(`Clear prompt session? This will remove ${stats.total} tracked images.\n\nNote: The images will be gone when you navigate away anyway. Use Export to save links first.`)) {
                clearPromptSession();
                // Remove download buttons from DOM
                document.querySelectorAll('.grok-prompt-download-btn').forEach(btn => btn.remove());
                updateSettingsStats();
                updateDownloadAllButton();
                updateOverlayPositions();
            }
        });

        // Log level buttons
        document.querySelectorAll('.grok-log-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const level = parseInt(btn.dataset.level, 10);
                Logger.setLevel(level);
                updateLogLevelUI();
            });
        });

        // Initialize log level UI
        updateLogLevelUI();
    }

    function updateLogLevelUI() {
        const levelDesc = document.getElementById('grok-log-level-desc');
        const buttons = document.querySelectorAll('.grok-log-btn');
        const currentLevel = Logger.getLevel();

        if (levelDesc) {
            levelDesc.textContent = `Current: ${LOG_LEVEL_NAMES[currentLevel]}`;
        }

        buttons.forEach(btn => {
            const btnLevel = parseInt(btn.dataset.level, 10);
            if (btnLevel === currentLevel) {
                btn.style.border = '2px solid #fff';
                btn.style.background = '#444';
            } else {
                btn.style.border = '1px solid #555';
                btn.style.background = '#333';
            }
        });
    }

    function toggleSettingsPanel() {
        if (!settingsPanel) return;
        const isVisible = settingsPanel.style.display !== 'none';
        settingsPanel.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            updateSettingsStats();
            updateLogLevelUI();
        }
    }

    function updateSettingsStats() {
        const statsDiv = document.getElementById('grok-stats');
        const pageTypeDiv = document.getElementById('grok-page-type');
        const promptSection = document.getElementById('grok-prompt-section');
        const favoritesSection = document.getElementById('grok-favorites-section');
        const promptStatsDiv = document.getElementById('grok-prompt-stats');

        const pageType = detectPageType();

        // Update page type indicator
        if (pageTypeDiv) {
            const pageLabels = {
                [PAGE_TYPE.PROMPT]: '🎨 Prompt Generation Page',
                [PAGE_TYPE.MORE_LIKE_THIS]: '🔄 More Like This Page',
                [PAGE_TYPE.FAVORITES]: '⭐ Favorites Page',
                [PAGE_TYPE.SINGLE_POST]: '📄 Single Post Page',
                [PAGE_TYPE.OTHER]: '📁 Other Imagine Page'
            };
            pageTypeDiv.textContent = pageLabels[pageType] || 'Unknown Page';
        }

        // Show/hide sections based on page type
        if (promptSection) {
            promptSection.style.display = isPromptLikePage(pageType) ? 'block' : 'none';
        }
        if (favoritesSection) {
            favoritesSection.style.display = !isPromptLikePage(pageType) ? 'flex' : 'none';
        }

        // Update prompt session stats
        if (promptStatsDiv && isPromptLikePage(pageType)) {
            const pStats = getPromptSessionStats();
            promptStatsDiv.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px;">
                    <span>🖼️ Captured:</span><span>${pStats.total}</span>
                    <span>✅ Downloaded:</span><span>${pStats.downloaded}</span>
                    <span>⏳ Remaining:</span><span>${pStats.remaining}</span>
                </div>
                ${pStats.currentPrompt ? `<div style="margin-top: 6px; font-size: 10px; opacity: 0.8; word-break: break-all;">Prompt: "${pStats.currentPrompt.substring(0, 50)}${pStats.currentPrompt.length > 50 ? '...' : ''}"</div>` : ''}
            `;
        }

        // Update main stats (for favorites/post pages)
        if (statsDiv) {
            if (isPromptLikePage(pageType)) {
                const pStats = getPromptSessionStats();
                statsDiv.innerHTML = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                        <span>🎨 Session images:</span><span>${pStats.total}</span>
                        <span>✅ Downloaded:</span><span>${pStats.downloaded}</span>
                        <span>⏳ Remaining:</span><span>${pStats.remaining}</span>
                    </div>
                    <div style="margin-top: 8px; font-size: 10px; opacity: 0.7;">
                        ⚠️ Images not saved/favorited will be lost on navigation
                    </div>
                `;
            } else {
                const stats = getDatabaseStats();
                statsDiv.innerHTML = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                        <span>📁 Entries:</span><span>${stats.entries}</span>
                        <span>🖼️ Images:</span><span>${stats.images}</span>
                        <span>🎬 Videos:</span><span>${stats.videos}</span>
                        <span>📦 Total items:</span><span>${stats.totalItems}</span>
                        <span>⚠️ Duplicates:</span><span style="color: ${stats.duplicates > 0 ? '#ff6b6b' : '#6bff6b'}">${stats.duplicates}</span>
                        <span>✅ Downloaded:</span><span>${stats.downloaded}</span>
                    </div>
                `;
            }
        }
    }

    // Detect and set the current post page ID
    function detectCurrentPostPage() {
        const match = window.location.pathname.match(/\/imagine\/post\/([a-f0-9-]+)/);
        if (match) {
            const newPostId = match[1];
            // If we're navigating to a completely different post, reset the root
            if (!rootPostPageId || !currentPostPageId) {
                rootPostPageId = newPostId;
            }
            currentPostPageId = newPostId;
            Logger.debug('On single post page:', currentPostPageId, '(root:', rootPostPageId, ')');
        } else {
            currentPostPageId = null;
            rootPostPageId = null;
        }
    }

    // Create button when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            detectCurrentPostPage();
            createDownloadAllButton();
            ensureDownloadAllButton();
            // Set up prompt page observer if we're on a prompt-like page
            if (isPromptLikePage(detectPageType())) {
                setupPromptPageObserver();
            }
        });
    } else {
        detectCurrentPostPage();
        createDownloadAllButton();
        ensureDownloadAllButton();
        // Set up prompt page observer if we're on a prompt-like page
        if (isPromptLikePage(detectPageType())) {
            setupPromptPageObserver();
        }
    }

    // Also check on navigation (SPA)
    function handleNavigation() {
        setTimeout(() => {
            const pageType = detectPageType();
            detectCurrentPostPage();

            if (window.location.pathname.includes('/imagine')) {
                createDownloadAllButton();
                ensureDownloadAllButton();

                // Handle page-type specific setup
                if (isPromptLikePage(pageType)) {
                    // Set up prompt page observer for prompt and "more like this" pages
                    setupPromptPageObserver();
                    Logger.info('Navigated to prompt-like page:', pageType);
                } else if (pageType === PAGE_TYPE.SINGLE_POST && currentPostPageId) {
                    // Load single post page data
                    setTimeout(loadSinglePostPageData, 500);
                } else if (pageType === PAGE_TYPE.FAVORITES) {
                    // Disconnect prompt observer when leaving prompt-like pages
                    if (promptPageObserver) {
                        promptPageObserver.disconnect();
                        promptPageObserver = null;
                    }
                }

                updateDownloadAllButton();
                updateSettingsStats();
            } else {
                // Remove UI elements when leaving /imagine pages
                if (downloadAllBtn) {
                    downloadAllBtn.remove();
                    downloadAllBtn = null;
                }
                if (settingsBtn) {
                    settingsBtn.remove();
                    settingsBtn = null;
                }
                if (settingsPanel) {
                    settingsPanel.remove();
                    settingsPanel = null;
                }
                // Disconnect prompt observer
                if (promptPageObserver) {
                    promptPageObserver.disconnect();
                    promptPageObserver = null;
                }
            }
        }, 100);
    }

    const origPushState = history.pushState;
    history.pushState = function() {
        origPushState.apply(this, arguments);
        handleNavigation();
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function() {
        origReplaceState.apply(this, arguments);
        handleNavigation();
    };

    window.addEventListener('popstate', handleNavigation);

    onBodyReady(() => {
        ensureDownloadAllButton();
        ensureSettingsPanel();
        setInterval(ensureDownloadAllButton, 1000);
        setInterval(ensureSettingsPanel, 1200);
    });

    window.addEventListener('resize', () => {
        updateOverlayPositions();
    });

    // Watch for URL changes within post pages (Video/Image tab switches)
    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            // If we're still on a post page, just rescan for new media
            if (window.location.pathname.match(/\/imagine\/post\/[a-f0-9-]+/)) {
                detectCurrentPostPage();
                setTimeout(loadSinglePostPageData, 300);
            }
        }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });
})();
