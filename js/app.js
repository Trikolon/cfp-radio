import * as log from "loglevel";
import Vue from "vue";
import VueMaterial from "vue-material";
import 'vue-material/dist/vue-material.css'
import "../css/app.css";
import visualizer from "./visualizer.js";

visualizer(); //FIXME
Vue.use(VueMaterial); //FIXME?
const app = new Vue({
    el: "#app",
    data: {
        loglevel: process.env.NODE_ENV === 'production' ? "INFO" : "DEBUG",
        title: "Liquid Radio",
        repoLink: "https://github.com/Trikolon/liquidradio",
        version: "1.1.0",
        stream: {
            play: false,
            offline: false,
            loading: false,
            volume: parseFloat(localStorage ? localStorage.getItem("volume") || "0.6" : "0.6"),
            el: "streamEl",
            dom: undefined,
            audioContext: undefined,
            mediaElSrc: undefined,
            currentStation: undefined,
            stations
        },
        notification: {
            message: "",
            duration: 4000,
            position: "bottom center",
            el: "notification-bar"
        },
        visualizer: JSON.parse(localStorage ? localStorage.getItem("visualizer") || "true" : "true"),
        socialLinks: [
            {
                name: "Facebook",
                url: "https://facebook.com/liquidradio.pro"
            },
            {
                name: "Instagram",
                url: "https://instagram.com/liquidradio.pro"
            }
        ]
    },
    watch: {
        "stream.play" (state) {
            if (!state) {
                this.stream.loading = false;
            }
            this.updatePlayState(state);
        },
        "stream.offline" (state) {
            if (state) {
                log.debug("Stream went offline");
                this.stream.play = false;
            }
        },
        "stream.volume" () {
            this.$refs[this.stream.el].volume = this.stream.volume;
        },
        "visualizer" () {
            log.debug("visualizer watch, new value:", this.visualizer);
            if (localStorage) localStorage.setItem("visualizer", this.visualizer);
        }
    },
    mounted() {
        this.stream.dom = this.$refs[this.stream.el]; // Get and save dom for further use
        this.stream.audioContext = new AudioContext(); // Create audio context for visualizer
        this.stream.mediaElSrc = this.stream.audioContext.createMediaElementSource(this.stream.dom); // for visualizer
        this.stream.mediaElSrc.connect(this.stream.audioContext.destination); // connect so we have audio

        // Attach event listeners to stream dom to watch external changes
        this.stream.dom.addEventListener("play", () => {
            this.stream.play = true;
            this.stream.loading = true;
        });
        this.stream.dom.addEventListener("pause", () => {
            this.stream.play = false;
        });
        this.stream.dom.addEventListener("volumechange", () => {
            this.stream.volume = this.$refs[this.stream.el].volume;
        });
        this.stream.dom.addEventListener("stalled", (e) => {
            log.error("Stream stalled", e);
            this.notify("Stream stalled, check your connection.");
        });

        // Audio stream has sufficiently buffered and starts playing
        this.stream.dom.addEventListener("playing", () => {
            this.stream.loading = false;
            this.notify(`Now playing ${this.stream.currentStation.title}`, 2000);
        });

        // Attach error handler to source tag
        this.attachErrorHandler();
        // Attach error handler to audio stream element
        this.stream.dom.addEventListener("error", this.streamError);

        // Set initial volume of audio element
        this.$refs[this.stream.el].volume = this.stream.volume;

        // Bind hotkey events
        window.onkeydown = (e) => {
            if (e.keyCode === 32) { // Spacebar toggles play state
                this.stream.play = !this.stream.play;
                e.preventDefault();
            }
        };
    },
    beforeMount() {
        //Set default station to first in station list.
        //This has to be done after data init but before dom-bind.
        [this.stream.currentStation] = this.stream.stations;

    },
    methods: {
        /**
         * Attached error handler to last source element, this has to be re-triggered on station switch
         */
        attachErrorHandler() {
            const sources = Array.from(this.stream.dom.getElementsByTagName("source"));
            sources[sources.length - 1].addEventListener("error", this.streamError);
        },
        /**
         * Switches to a different station in stream object and changes play state to true.
         * No action if station id is invalid
         * @param id - Identifier of station to switch to.
         */
        switchStation(id) {
            if (id === this.stream.currentStation.id) return;
            for (let i = 0; i < this.stream.stations.length; i++) {
                if (this.stream.stations[i].id === id) {
                    this.stream.currentStation = this.stream.stations[i];
                    this.stream.play = false;
                    // Wait for vue to update src url in audio element before triggering play()
                    Vue.nextTick(() => {
                        this.attachErrorHandler();
                        this.catchUp();
                    });
                    log.debug("Switched station to", this.stream.currentStation.title, this.stream.currentStation);
                    return;
                }
            }
            log.error("Attempted to switch to station with invalid station id", id);
        },
        /**
         * Modify stream volume by modifier value. Bounds of volume are 0 - 1
         * @param value - Positive or negative number that will be added.
         */
        changeVolume(value) {
            if (this.stream.volume + value > 1) {
                this.stream.volume = 1;
                log.debug("Hit upper bound for volume ctrl");
            }
            else if (this.stream.volume + value < 0) {
                this.stream.volume = 0;
                log.debug("Hit lower bound for volume ctrl");
            }
            else {
                this.stream.volume = Math.round((this.stream.volume + value) * 10) / 10;
                log.debug(`Modified volume by ${value} to ${this.stream.volume}`);
            }
            // Save volume setting to config
            if (localStorage) localStorage.setItem("volume", this.stream.volume);
        },
        /**
         * Trigger play or pause for audio el depending on state.
         * @param state - true if play, false if pause.
         */
        updatePlayState(state) {
            const el = this.$refs[this.stream.el];
            log.debug("play state changed to", state);
            if (state) {
                el.play();
                log.debug("started stream");
            }
            else {
                el.pause();
                log.debug("stopped stream");
            }
        },
        /**
         * Reloads audio element to catch up in stream.
         */
        catchUp() {
            this.stream.dom.load();
            if (this.stream.play) {
                this.updatePlayState(true);
            }
            else { // Stream play state was false before, set it to true (watcher will handle the dom play)
                this.stream.play = true;
            }
            this.stream.offline = false;
        },
        /**
         * Error handler audio stream.
         * @param e - Event fired including error information.
         */
        streamError(e) {
            log.error("Error in stream", e);
            let msg = "Unknown Error";

            // Error from source tag
            if (e.target.nodeName === "SOURCE") {
                log.debug("Error originates from SOURCE tag");

                log.debug("NetworkState", this.stream.dom.networkState);
                //NETWORK_NO_SOURCE
                if (this.stream.dom.networkState === 3) {
                    msg = "Stream offline"
                }
            }
            // Error from audio tag
            else if (e.target.nodeName === "AUDIO") {
                log.debug("Error originates from AUDIO tag");
                log.error(e.target.error.code, e.target.error.message);
                msg = "Error: ";

                switch (e.target.error.code) {
                    case e.target.error.MEDIA_ERR_ABORTED:
                        msg += "Playback aborted by user.";
                        break;
                    case e.target.error.MEDIA_ERR_NETWORK:
                        msg += "Network error. Check your connection.";
                        break;
                    case e.target.error.MEDIA_ERR_DECODE:
                        msg += "Decoding error.";
                        break;
                    default:
                        msg += `Unknown error code ${e.target.code}`;
                        break;
                }
            }
            this.stream.offline = true;
            this.notify(msg);
        },
        /**
         * Shows notification
         * @param message - Text for notification.
         * @param duration - Duration of visibility.
         */
        notify(message, duration) {
            const el = this.$refs[this.notification.el];
            if (duration) {
                this.notification.duration = duration;
            }
            this.notification.message = message;
            el.open();
        }
    }
});
log.setDefaultLevel(app.loglevel);
window.log = log;
log.debug("%cDebug messages enabled", "background: red; color: yellow; font-size: x-large");