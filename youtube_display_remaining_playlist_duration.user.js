// ==UserScript==
// @name         Display remaining Youtube playlist duration
// @namespace    https://github.com/pekvasnovsky-forks-02/userscript-youtube-display-remaining-playlist-duration
// @version      1.0.0
// @description  Displays the sum of the lengths of the watched/remaining videos in a playlist
// @author       pekvasnovsky
// @license      Unlicense
// @match        http://www.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

// @ts-check


(function() {
    'use strict';

    // @ts-ignore
    let showTime = GM_getValue("showTime", true);

    function registerShowTimeMenu() {
        // @ts-ignore
        GM_registerMenuCommand(
            `Show Time: ${showTime ? "ON" : "OFF"}`,
            () => {
                showTime = !showTime;
                // @ts-ignore
                GM_setValue("showTime", showTime);

                // Update the menu item in place
                registerShowTimeMenu();

                debugLog("Forcing update!");
                update(true);
            },
            { id: "showTime-toggle" }
        );
    }

    registerShowTimeMenu();


    // @ts-ignore
    let showPercentage = GM_getValue("showPercentage", true);

    function registerShowPercentageMenu() {
        // @ts-ignore
        GM_registerMenuCommand(
            `Show Percentage: ${showPercentage ? "ON" : "OFF"}`,
            () => {
                showPercentage = !showPercentage;
                // @ts-ignore
                GM_setValue("showPercentage", showPercentage);

                // Update the menu item in place
                registerShowPercentageMenu();

                debugLog("Forcing update!");
                update(true);
            },
            { id: "showPercentage-toggle" }
        );
    }

    registerShowPercentageMenu();


    // @ts-ignore
    let debug = GM_getValue("debug", false);

    function registerDebugMenu() {
        // @ts-ignore
        GM_registerMenuCommand(
            `Debug: ${debug ? "ON" : "OFF"}`,
            () => {
                debug = !debug;
                // @ts-ignore
                GM_setValue("debug", debug);

                // Update the menu item in place
                registerDebugMenu();
            },
            { id: "debug-toggle" }
        );
    }

    registerDebugMenu();


    // @ts-ignore
    let percentageFormatSetToWatchedNotRemaining = GM_getValue("percentageFormatSetToWatchedNotRemaining", true);

    function registerPercentageFormatMenu() {
        // @ts-ignore
        GM_registerMenuCommand(
            `Percentage Format: ${percentageFormatSetToWatchedNotRemaining ? "Watched" : "Remaining"}`,
            () => {
                percentageFormatSetToWatchedNotRemaining = !percentageFormatSetToWatchedNotRemaining;
                // @ts-ignore
                GM_setValue("percentageFormatSetToWatchedNotRemaining", percentageFormatSetToWatchedNotRemaining);

                // Update the menu item in place
                registerPercentageFormatMenu();

                debugLog("Forcing update!");
                update(true);
            },
            { id: "percentageFormatSetToWatchedNotRemaining-toggle" }
        );
    }

    registerPercentageFormatMenu();



    /* true: The duration of the current video is ignored when determining the time left
     * false: The duration of the current video is added when determining the time left
    */
    const treatCurrentVideoAsWatched = false;

    const timeFormat1_forceFull = false; // e.g 0h 3m 2s instead of 3m 2s, 3h 0m 50s instead of 3h 50s, etc

    const before = " - "; // ::before
    const before_miniplayer = " • ";
    const updateCooldown = 2500; // limit how often update() is run (milliseconds)

    const time_after = " left) "; // e.g "15h 20m 15s left)"
    const time_processing = "..."; // shown after the script has started updating and before it has finished
    const time_incompleteIndicator = "(>"; // e.g "(>15h 20m 15s left)", for large playlists (> 200 videos)
    const time_completeIndicator = "("; // e.g "(15h 20m 15s left)"

    const percentageFormat0_after = "% done]";
    const percentageFormat1_after = "% left]";
    const percentage_after = [percentageFormat0_after, percentageFormat1_after];
    const percentage_processing = "[...]"; // shown after the script has started updating and before it has finished
    const percentage_incompleteIndicator = " [~"; // e.g "(10s left) [~20% done]", for large playlists (> 200 videos)
    const percentage_completeIndicator = " ["; // e.g "(10s left) [20% done]"
    const percentage_decimalPlaces = 1;


    const DOWN = false; // direction
    const UP = true; // direction
    let updateFlagTime = 0;
    let time_total_s = 0;
    let time_total_s_elapsed = 0; // stores duration of previous videos
    let direction_global = DOWN;
    let errorFlag = false;
    let incompleteFlag = false; // A playlist only displays the 199 previous+next entries in the playlist.
    let incompleteFlagR = false; // Used to determine if the percentage is accurate; checks the direction opposite to direction_global
    let miniplayerActive = false;

    const selectors = {
        "currentVideo": "#content ytd-playlist-panel-video-renderer[selected]",
        "currentVideo_miniplayer": "div.miniplayer ytd-playlist-panel-video-renderer[selected]",
        "drypt_label": "#drypt_label", // created by this script
        "drypt_label_miniplayer": "#drypt_label_miniplayer", // created by this script
        "playlistHeaderText": "div.index-message-wrapper",
        "pytplir_btn": "#content #pytplir_btn", // https://greasyfork.org/en/scripts/404986-play-youtube-playlist-in-reverse-order
        "pytplir_btn_miniplayer": "div.miniplayer #pytplir_btn",
        "timestamp": "span.ytd-thumbnail-overlay-time-status-renderer",
        "timestamp2": ".ytd-thumbnail-overlay-time-status-renderer", // requires iteration over results
        "unplayableText": "#unplayableText",
        "vidCount": ".ytd-watch-flexy #playlist #publisher-container div yt-formatted-string",
        "vidCount_miniplayer": "yt-formatted-string[id=owner-name] :nth-child(3)",
        "vidNum": "#publisher-container span.index-message",
        "vidNum_miniplayer": "yt-formatted-string[id=owner-name]",
        "ytd_app": "ytd-app"
    };

    const playlistObserver = new MutationObserver(observerCallback);
    const pytplirObserver = new MutationObserver(pytplirCallback);
    const observerOptions = {attributes:true, characterData:true};

    initObservers(playlistObserver);
    setInterval(check, updateCooldown); // init; then ensure the pytplir button is detected correctly

    /**
     * @param {MutationRecord[]} mutationList
     * @param {MutationObserver} observer
     */
    function observerCallback(mutationList, observer) {
       update();
    }

    /**
     * @param {MutationRecord[]} mutationList
     * @param {MutationObserver} observer
     */
    function pytplirCallback(mutationList, observer) {
       debugLog("Forcing update!");
       update(true); // force update regardless of cooldown
    }

    /**
     * @param {MutationObserver} observer
     */
    function initObservers(observer) {
        try {
            const vidCount = document.querySelector(selectors.vidCount);
            if (!vidCount) {
                throw new Error("Element vidCount not found");
            }
            observer.observe(vidCount, observerOptions);
            /**
             * @type {Element | null | undefined}
             */
            let miniplayerTarget = document.querySelector(selectors.vidCount_miniplayer);
            if (!miniplayerTarget) {
                miniplayerTarget = document.querySelector(selectors.vidNum_miniplayer)?.nextElementSibling?.children[1];
            }
            if (!miniplayerTarget) {
                throw new Error("Element miniplayerTarget not found");
            }
            observer.observe(miniplayerTarget, observerOptions); // miniplayer
            debugLog("Observers initiated!");
        } catch (e) {
            //debugLog("Observer error!", e);
            setTimeout(function(){initObservers(observer)},100);
        }
    }

    function isMiniplayerActive() {
        // Youtube seems to change this quite often, and due to A/B testing all of them need to be checked
        let miniplayer_attributes = ["miniplayer-is-active", "miniplayer-active_", "miniplayer-active"];
        miniplayerActive = false;
        const selectedYtdApp = document.querySelector(selectors.ytd_app);
        if (!selectedYtdApp) {
            throw new Error("Element selectedYtdApp not found");
        }
        for (let attr of miniplayer_attributes) {
            miniplayerActive ||= selectedYtdApp.hasAttribute(attr);
        }
        return miniplayerActive;
    }

    function check() {
        miniplayerActive = isMiniplayerActive();

        if (!document.querySelector(selectors.drypt_label) || (miniplayerActive && !document.querySelector(selectors.drypt_label_miniplayer))) {
            update();
        }

        let pytplir_btn;
        if (miniplayerActive) {
            pytplir_btn = document.querySelector(selectors.pytplir_btn_miniplayer);
        } else {
            pytplir_btn = document.querySelector(selectors.pytplir_btn);
        }

        if (pytplir_btn) {
            // @ts-ignore
            pytplir_btn.addEventListener("click", pytplirCallback);
        }
    }

    function update(force=false) {
        let timeSinceUpdate = Date.now() - updateFlagTime;
        if (timeSinceUpdate < updateCooldown && !force) {
            setTimeout(update, updateCooldown - timeSinceUpdate);
            return;
        }

        updateFlagTime = Date.now();
        miniplayerActive = isMiniplayerActive();
        let playlistEntry = getCurrentEntry();
        if (!playlistEntry) {return;}

        display(true); // display message to indicate the script is processing the time left

        direction_global = getDirection();
        incompleteFlag = false;
        incompleteFlagR = false;
        if (treatCurrentVideoAsWatched) {
            playlistEntry = getNextEntry(playlistEntry, direction_global);
        }

        time_total_s = 0;
        time_total_s_elapsed = 0;
        if (playlistEntry) {
            addTime(playlistEntry, direction_global);
            if (showPercentage) { // also need to sum the video durations in the other direction
                let next = getNextEntry(playlistEntry, !direction_global);
                if (next) {
                    addTime(next, !direction_global);
                }
            }
        }

        if (!errorFlag){
            debugLog("Displaying!", time_total_s, time_total_s_elapsed);
            display();
        } else {
            debugLog("Error flag active!");
            setTimeout(update,100);
            errorFlag = false;
        }
    }

    function getCurrentEntry(){ // returns <ytd-playlist-panel-video-renderer> element
        let elem;
        try {
            if (miniplayerActive) {
                return document.querySelector(selectors.currentVideo_miniplayer);
            } else {
                return document.querySelector(selectors.currentVideo);
            }
        } catch (e) {
            debugLog("getCurrentEntry", e);
            errorFlag = true;
        }

        return null;
    }

    /**
     * @param {Element | null} current
     * @param {boolean} direction
     */
    function getNextEntry(current, direction) {
        const previous = current;

        current = /** @type {Element | null} */ (direction
            ? current?.previousElementSibling
            : current?.nextElementSibling);

        if (current) {
            const unplayableText = current.querySelector(selectors.unplayableText);
            const available = /** @type {HTMLElement | null} */ (unplayableText)?.hidden;
            
            debugLog("getNextEntry", current, available);
            if (current.tagName == "YTD-MESSAGE-RENDERER") { // "n unavailable videos" at the end of a playlist
                checkIncomplete(previous, direction);
                return null;
            } else if (available || available == null) {
                return current;
            } else {
                return getNextEntry(current, direction);
            }
        } else {
            checkIncomplete(previous, direction);
            return null;
        }
    }

    /**
     * @param {any} entry
     * @param {boolean} direction
     */
    function checkIncomplete(entry, direction) {
        let vidNums = getVidNum();
        if (vidNums === undefined || vidNums === null) { return; }
        let num;
        try {
            num = entry.querySelector("#index");

            // For some reason the above now seems to fail for every entry
            if (!num) {
                num = Array.from(entry.querySelectorAll("span"))
                    .find(span => span.id === "index");
            }

            num = num.innerText;
        } catch (e) { // most likely, the bottom of the playlist contains a message saying "n unavailable videos"
            let lastAvailableNum;
            try {
                // Get playlist index of the video before the message
                lastAvailableNum = entry.previousElementSibling?.querySelector("#index");

                if (!lastAvailableNum) {
                    lastAvailableNum = Array.from(entry.querySelectorAll("span"))
                        .find(span => span.id === "index");
                }

                lastAvailableNum = lastAvailableNum.innerText;
            } catch (e2) { // perhaps the playlist has not fully loaded yet?
                debugLog(entry, direction, e, e2);
                return;
            }

            if (!(isNaN(parseInt(lastAvailableNum)))) { // last visible video in the list is not the last "available" one
                incompleteFlag = lastAvailableNum === vidNums[1];
            } else { // current video is the last "available" one, but there are unavailable videos
                incompleteFlag = false;
            }
            return;
        }
        let currentVideo = isNaN(parseInt(num)) // ▶ instead of number
        if (!currentVideo){ // current video is neither the first nor the last video in the playlist
            if (direction == direction_global) {
                incompleteFlag = (direction_global == DOWN && num !== vidNums[1]) || (direction_global == UP && num !== "1");
            } else {
                incompleteFlagR = (direction_global == UP && num !== vidNums[1]) || (direction_global == DOWN && num !== "1");
            }
        }
    }

    function getVidNum() { // returns string array [current, total], e.g "32 / 152" => ["32","152"]
        let vidNum;
        if (miniplayerActive) {
            const vidNumElement = document.querySelector(selectors.vidNum_miniplayer);
            const children = vidNumElement?.children;                
            if (children && children.length >= 2) { // Youtube A/B testing
                vidNum = /** @type {HTMLElement} */ (children[2]).innerText;
            } else {
                // "• x / y"
                vidNum = /** @type {HTMLElement | null} */ (vidNumElement?.parentElement?.children[1])?.innerText.substring(2);
            }
        } else {
            try {
                // the desired element is hidden; to distinguish from
                // other hidden elements, check parent's visibility
                const element = /** @type {HTMLElement | undefined} */ (Array.from(document.querySelectorAll(selectors.vidNum))
                    .find(el => el.parentElement?.offsetParent !== null));

                vidNum = element?.innerText;
            } catch (e) { // e.g. the user switched from one playlist to another
                return null;
            }
        }
        return vidNum?.split(" / ") ?? null;
    }

    function getDirection(){ // Compatible with https://greasyfork.org/en/scripts/404986-play-youtube-playlist-in-reverse-order
        let pytplir_btn;
        if (miniplayerActive) {
            pytplir_btn = document.querySelector(selectors.pytplir_btn_miniplayer);
        } else {
            pytplir_btn = document.querySelector(selectors.pytplir_btn);
        }
        if (!pytplir_btn) {
            return DOWN;
        } else {
            return pytplir_btn.getAttribute("activated") == "true" ? UP : DOWN;
        }
    }

    /**
     * @param {Element} entry
     * @param {boolean} direction
     */
    function addTime(entry, direction) {
        let time_raw = getTime(entry);
        debugLog("addTime", entry, time_raw);
        if (time_raw != "-1") {
            if (direction == direction_global){
                time_total_s += hmsToSecondsOnly(time_raw);
            } else { // in order to calculate % done/remaining
                time_total_s_elapsed += hmsToSecondsOnly(time_raw);
            }
            const nextEntry = getNextEntry(entry, direction);
            if (nextEntry) {
                addTime(nextEntry, direction);
            }
        } else {
            errorFlag = true;
        }
    }

    /**
     * @param {Element} item
     */
    function getTime(item) {
        const unplayableTextElement = /** @type {HTMLElement | null} */ (item.querySelector(selectors.unplayableText));
        const available = unplayableTextElement?.hidden;

        debugLog("getTime", item, available, unplayableTextElement);
        if (available || available == undefined) {
            let time = /** @type {HTMLElement | null | undefined} */ (item.querySelector(selectors.timestamp));
            if (!time) {
                // Either the timestamp has not loaded yet, or the selector stopped working for whatever reason.
                // In the latter case, searching only for the class and then filtering for the <span> tag should still work.
                time = /** @type {HTMLElement | null | undefined} */ (Array.from(item.querySelectorAll(selectors.timestamp2))
                    .find(el => el.tagName === "SPAN"));
            }

            if (!time) { // Timestamp has not loaded yet
                return "-1";
            } else {
                return time.innerText.trim();
            }
        } else { // unwatchable video => no timestamp
            return "0";
        }
    }

    // https://stackoverflow.com/questions/9640266/convert-hhmmss-string-to-seconds-only-in-javascript
    /**
     * @param {string} str
     */
    function hmsToSecondsOnly(str) {
        let p = str.split(':'),
            s = 0, m = 1;

        while (p.length > 0) {
            const item =  /** @type {String} */ (p.pop());
            s += m * parseInt(item, 10);
            m *= 60;
        }

        if (isNaN(s)) { // Likely caused by premiere video or upcoming livestream
            debugLog("NaN time:", str);
            return 0;
        }

        return s;
    }

    function display(showLoading=false) {
        let timeString = "";
        if (showLoading) { timeString = time_processing; }
        else {
            let time = formatTime(time_total_s);
            if (time == "") {return;} // this is apparently possible
            if (showTime) {
                let time_before = incompleteFlag ? time_incompleteIndicator : time_completeIndicator; // e.g "(more than " or "( "
                timeString = time_before + time + time_after;
            }
        }

        let percentageString = "";
        if (showLoading) {percentageString = percentage_processing; }
        else if (showPercentage) {
            let missingData = incompleteFlag || incompleteFlagR; // due to large playlist
            let percentage_before = missingData ? percentage_incompleteIndicator : percentage_completeIndicator;
            let playlistTime = time_total_s + time_total_s_elapsed;
            let percentage;

            /* Percentage formats:
            * 0: % watched (e.g. [42% done])
            * 1: % remaining (e.g. [58% left])
            */
            let percentageFormat = 0;
            if (percentageFormatSetToWatchedNotRemaining) {
                // show % watched
                percentageFormat = 0;
                percentage = time_total_s_elapsed;
            } else {
                // show % remaining
                percentageFormat = 1;
                percentage = time_total_s;
            }
            if (playlistTime != 0){
                percentage = 100 * percentage / playlistTime;
                if (!Number.isInteger(percentage)) {
                    percentage = percentage.toFixed(percentage_decimalPlaces);
                }
            } else { // treatCurrentVideoAsWatched == true and current video is first/last in playlist
                percentage = percentageFormat ? 0 : 100;
            }
            percentageString = percentage_before + percentage + percentage_after[percentageFormat];
        }

        let textColor = "rgb(237,240,243)";
        if (!miniplayerActive) {
            debugLog("normal display");
            if (!document.querySelector(selectors.drypt_label)) {
                let label = document.createElement("a");
                label.setAttribute("font-family","Roboto, Noto, sans-serif");
                label.setAttribute("font-size","13px");
                label.setAttribute("fill",textColor);
                label.setAttribute("id","drypt_label");
                
                const el = Array.from(document.querySelectorAll(selectors.playlistHeaderText))
                    .find(el => /** @type {HTMLElement} */ (el).offsetParent !== null);

                if (el) {
                    el.appendChild(label);
                }
            }
            const drypt_label_element = /** @type {HTMLElement | null} */ (document.querySelector(selectors.drypt_label));
            if (!drypt_label_element) {
                throw new Error("Element drypt_label_element not found");
            }
            drypt_label_element.innerText = before + timeString + percentageString;

        } else { // miniplayer
            debugLog("miniplayer display");
            if (!document.querySelector(selectors.drypt_label_miniplayer)) {
                let label_miniplayer = document.createElement("a");
                label_miniplayer.setAttribute("font-family","Roboto, Noto, sans-serif");
                label_miniplayer.setAttribute("font-size","13px");
                label_miniplayer.setAttribute("fill",textColor);
                label_miniplayer.setAttribute("id","drypt_label_miniplayer");
                const vidNum_miniplayer = document.querySelectorAll(selectors.vidNum_miniplayer);

                if (vidNum_miniplayer.length < 2) { // Youtube A/B testing
                    vidNum_miniplayer[0]?.parentElement?.children[1]?.appendChild(label_miniplayer);
                } else {
                    vidNum_miniplayer[0]?.appendChild(label_miniplayer);
                }
            }
            const drypt_label_miniplayer_element = /** @type {HTMLElement | null} */ (document.querySelector(selectors.drypt_label_miniplayer));
            if (!drypt_label_miniplayer_element) {
                throw new Error("Element drypt_label_miniplayer_element not found");
            }
            drypt_label_miniplayer_element.innerText = before_miniplayer + timeString + percentageString;
        }
        incompleteFlag = false;
    }

    /**
     * @param {number} time_total_s
     */
    function formatTime(time_total_s) { // xhxmxs (e.g 25m 2s)
        let space = " ";
        let hh = Math.floor(time_total_s / 3600);
        let mm = Math.floor((time_total_s % 3600) / 60);
        let ss = time_total_s % 60;

        let text = "";
        if (hh > 0 || timeFormat1_forceFull) {
            text += hh + "h" + space;
        };
        if (mm > 0 || timeFormat1_forceFull) {
            text += mm + "m" + space;
        };
        if (ss > 0 || timeFormat1_forceFull || !time_total_s) {
            text += ss + "s";
        };
        return text;
    }

        /**
         * @param {any[]} args
         */
    function debugLog(...args) {
        if (debug) {
            args.unshift("yt-display-duration:");
            console.log.apply(console, args);
        }
    }
})();