// ==UserScript==
// @name         Display remaining Youtube playlist time
// @namespace    https://github.com/Dragosarus/Userscripts/
// @version      4.3
// @description  Displays the sum of the lengths of the remaining videos in a playlist
// @author       Dragosarus
// @match        http://www.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @require      http://code.jquery.com/jquery-latest.js
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
            observer.observe($(selectors.vidCount)[0], observerOptions);
            let miniplayerTarget = $(selectors.vidCount_miniplayer);
            if (!miniplayerTarget.length) {
                miniplayerTarget = $(selectors.vidNum_miniplayer).next().children()[1];
            } else {
                miniplayerTarget = miniplayerTarget[0];
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
        for (let attr of miniplayer_attributes) {
            miniplayerActive ||= $(selectors.ytd_app)[0].hasAttribute(attr);
        }
        return miniplayerActive;
    }

    function check() {
        miniplayerActive = isMiniplayerActive();

        if (!$(selectors.drypt_label).length || (miniplayerActive && !$(selectors.drypt_label_miniplayer).length)) {
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
                return $(selectors.currentVideo_miniplayer)[0];
            } else {
                return $(selectors.currentVideo)[0];
            }
        } catch (e) {
            debugLog("getCurrentEntry", e);
            errorFlag = true;
        }
    }

    /**
     * @param {any[]} current
     * @param {boolean} direction
     */
    function getNextEntry(current, direction){
        let previous = current;
        if (direction) {
            current = $(current).prev();
        } else {
            current = $(current).next();
        }
        if (current.length) {
            let available = current.find(selectors.unplayableText).prop("hidden")
            debugLog("getNextEntry", current, available);
            if (current[0].tagName == "YTD-MESSAGE-RENDERER") { // "n unavailable videos" at the end of a playlist
                checkIncomplete(previous, direction);
                return undefined;
            } else if (available || available == undefined) {
                return current[0];
            } else {
                return getNextEntry(current, direction);
            }
        } else {
            checkIncomplete(previous, direction);
            return undefined;
        }
    }

    /**
     * @param {any} entry
     * @param {boolean} direction
     */
    function checkIncomplete(entry, direction) {
        let vidNums = getVidNum();
        if (vidNums === undefined) { return; }
        let num;
        try {
            num = $(entry).find("#index");
            // For some reason the above now seems to fail for every entry
            if (!num.length) {
                num = $(entry).find("span").filter("#index");
            }
            num = num[0].innerText;
        } catch (e) { // most likely, the bottom of the playlist contains a message saying "n unavailable videos"
            let lastAvailableNum;
            try {
                 // Get playlist index of the video before the message
                 lastAvailableNum = $(entry).prev().find("#index");
                 if (!lastAvailableNum.length) {
                     lastAvailableNum = $(entry).find("span").filter("#index");
                 }
                 lastAvailableNum = lastAvailableNum[0].innerText;
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
            vidNum = $(selectors.vidNum_miniplayer).children();
            if (vidNum.length >= 2) { // Youtube A/B testing
                vidNum = vidNum[2].innerText;
            } else {
                // "• x / y"
                vidNum = $(selectors.vidNum_miniplayer).parent().children()[1].innerText.substring(2);
            }
        } else {
            try {
                // the desired element is hidden; to distinguish from
                // other hidden elements, check parent's visibility
                vidNum = $(selectors.vidNum).filter(function(){
                    return $(this).parent().is(":visible");
                })[0].innerText;
            } catch (e) { // e.g. the user switched from one playlist to another
                return undefined;
            }
        }
        return vidNum.split(" / ");
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
            return $(pytplir_btn).attr("activated") == "true" ? UP : DOWN;
        }
    }

    /**
     * @param {any} entry
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
            entry = getNextEntry(entry, direction);
            if (entry) {
                addTime(entry, direction);
            }
        } else {
            errorFlag = true;
        }
    }

    /**
     * @param {any} item
     */
    function getTime(item) {
        let available = $(item).find(selectors.unplayableText).prop("hidden");
        debugLog("getTime", item, available, $(item).find(selectors.unplayableText));
        if (available || available == undefined) {
            let time = $(item).find(selectors.timestamp);
            if (!time.length) {
                // Either the timestamp has not loaded yet, or the selector stopped working for whatever reason.
                // In the latter case, searching only for the class and then filtering for the <span> tag should still work.
                time = $(item).find(selectors.timestamp2).filter("span");
            }

            if (!time.length) { // Timestamp has not loaded yet
                return "-1";
            } else {
                return $.trim(time[0].innerText);
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
            if (!$(selectors.drypt_label).length) {
                let label = document.createElement("a");
                label.setAttribute("font-family","Roboto, Noto, sans-serif");
                label.setAttribute("font-size","13px");
                label.setAttribute("fill",textColor);
                label.setAttribute("id","drypt_label");
                $(selectors.playlistHeaderText).filter(":visible")[0].appendChild(label);
            }
            $(selectors.drypt_label)[0].innerText = before + timeString + percentageString;

        } else { // miniplayer
            debugLog("miniplayer display");
            if (!$(selectors.drypt_label_miniplayer).length) {
                let label_miniplayer = document.createElement("a");
                label_miniplayer.setAttribute("font-family","Roboto, Noto, sans-serif");
                label_miniplayer.setAttribute("font-size","13px");
                label_miniplayer.setAttribute("fill",textColor);
                label_miniplayer.setAttribute("id","drypt_label_miniplayer");
                if ($(selectors.vidNum_miniplayer).length < 2) { // Youtube A/B testing
                    $(selectors.vidNum_miniplayer).parent().children()[1].appendChild(label_miniplayer);
                } else {
                    $(selectors.vidNum_miniplayer)[0].appendChild(label_miniplayer);
                }
            }
            $(selectors.drypt_label_miniplayer)[0].innerText = before_miniplayer + timeString + percentageString;
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