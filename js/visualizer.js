import Vue from "vue";
import * as log from "loglevel";

export default () => {
    Vue.component("audio-visualizer", {
        template: "<canvas></canvas>",
        props: {
            audioContext: {},
            mediaElSrc: {},
            design: {
                default: "square",
                validator(value) {
                    return value === "square" || value === "circle";
                }
            },
            barcolor: {
                type: String,
                default: "#3F51B5"
            },
            maxdb: {
                type: Number,
                default: -20
            },
            vertscale: {
                type: Number,
                default: 3
            },
            maxFPS: {
                type: Number,
                default: 30
            }
        },
        data() {
            return {
                divider: 16, // data "resolution" divider
                draw: undefined,
                frameLimit: window.performance.now()
            }
        },
        computed: {
            maxFPS_ms() {
                return 1000 / this.maxFPS;
            }
        },
        mounted() {
            window.addEventListener("resize", this.resize);
            this.init();
        },
        beforeDestroy() {
            // TODO: Check if we need to do cleanup
        },
        methods: {
            init() {
                Vue.nextTick(() => {
                    log.debug("Visualizer init", this);

                    this.analyser = this.audioContext.createAnalyser();
                    this.analyser.fftSize = this.analyser.fftSize / this.divider;
                    this.analyser.maxDecibels = this.maxdb;
                    this.analyser.smoothingTimeConstant = 0.9;

                    // connect to analyser
                    this.mediaElSrc.connect(this.analyser);

                    // setup data array
                    this.bufferLength = this.analyser.frequencyBinCount;
                    this.freqBytes = new Uint8Array(this.bufferLength);

                    // setup canvas and canvas context variables
                    this.canvas = this.$el;
                    this.c = this.canvas.getContext("2d");

                    this.resize();

                    if (this.design === "square") {
                        this.draw = this.drawSquare;
                    }
                    else {
                        this.draw = this.drawCircle;
                    }
                    this.reqFrame();
                });
            },
            /**
             * recalculate values needed by draw functions, supposed to be called on each resize event
             */
            recalc() {
                // calculate an upper bound, we want to skip the highest frequencies in the last third of the array
                this.upperbound = Math.round(this.freqBytes.length * 2 / 3);

                // for linear bars
                this.barWidth = Math.ceil(this.canvas.width / this.upperbound);
                this.offset = Math.floor(this.barWidth / 2);

                // for circle bars
                this.center = [this.canvas.width / 2, this.canvas.height / 2];
                this.minDim = Math.min(this.center[0], this.center[1]);
                this.cBarWith = (Math.min(this.center[0], this.center[1]) / this.upperbound);

                this.grd = this.c.createLinearGradient(0, 0, 0, this.canvas.height);
                this.grd.addColorStop(0, "white");
                this.grd.addColorStop(1, "#1A237E");

                this.c.strokeStyle = this.barcolor; // material design primary

                log.debug("fftSize:           ", this.analyser.fftSize);
                log.debug("freqBytes length:  ", this.freqBytes.length);
                log.debug("upperbound:        ", this.upperbound);

                log.debug("offset:            ", this.offset);
                log.debug("cBarWith:          ", this.cBarWith);
            },

            /**
             * checks on window resize if canvas dimensions have changed. If so, update canvas client dimensions.
             * If step is skipped, canvas will be scaled and appears blurry.
             */
            resize() {
                log.debug("resize event triggered");
                // Lookup the size the browser is displaying the canvas.
                const displayWidth = this.canvas.clientWidth;
                const displayHeight = this.canvas.clientHeight;

                // Check if the canvas is not the same size.
                if (this.canvas.width !== displayWidth ||
                    this.canvas.height !== displayHeight) {

                    // Make the canvas the same size
                    this.canvas.width = displayWidth;
                    this.canvas.height = displayHeight;

                }
                this.recalc();
            },

            /**
             * Method to manage draw trigger
             * Limits FPS to this.maxFPS
             * Idle mode if audio element is paused, not visible or not ready yet
             */
            reqFrame() {
                if (( this.mediaElSrc.mediaElement && this.mediaElSrc.mediaElement.paused)
                    || this.canvas.offsetHeight === 0) {
                    //wait a while and try again
                    setTimeout(() => {
                        requestAnimationFrame(this.reqFrame);
                    }, 200)
                }
                else {
                    const now = window.performance.now();
                    if ((now - this.frameLimit) > this.maxFPS_ms) {
                        // Draw
                        this.draw();
                        this.frameLimit = now;
                    }
                    requestAnimationFrame(this.reqFrame);
                }
            },

            /**
             * Draws vertical bars
             */
            drawSquare() {
                // get data for bars
                this.analyser.getByteFrequencyData(this.freqBytes);
                // clear before redraw
                this.c.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.c.beginPath();


                // loop through data, draw bars
                for (let i = 0; i < this.freqBytes.length; i++) {
                    this.c.beginPath();
                    this.c.lineWidth = Math.max(this.barWidth - 1, 1); // -2 to have small gap
                    // offset by half because linewith goes both directions
                    this.c.moveTo(this.offset + i * this.barWidth, this.canvas.height);
                    this.c.lineTo(this.offset + i * this.barWidth, (this.canvas.height - Math.pow(
                        this.freqBytes[i] / 255, this.vertscale) * this.canvas.height));
                    this.c.stroke();
                }
            },


            /**
             * Draws circular bars
             */
            drawCircle() {
                // get data for bars
                this.analyser.getByteFrequencyData(this.freqBytes);

                this.c.clearRect(0, 0, this.canvas.width, this.canvas.height);

                // draw thin line from bottom to center, to hide render errors
                this.c.beginPath();
                this.c.moveTo(this.center[0], this.center[1]);
                this.c.lineTo(this.center[0], this.canvas.height);
                this.c.lineWidth = 1;
                this.c.stroke();

                this.c.lineWidth = Math.floor(this.cBarWith) + 2; // at least 2 extra pixels to prevent shimmering

                for (let i = 0; i <= this.upperbound; i++) {

                    const powered = Math.pow(this.freqBytes[i] / 255, 2);
                    // let powered = freqBytes[i] / 255; // To power, or not to power, that is the question

                    // radius is minDim but take away half of linewidth, then decrease each step while going through
                    // array. -1 was added in order to contain outer bars inside circle outline
                    const radius = Math.max(
                        this.minDim - 1 - this.c.lineWidth / 2 - (this.minDim / this.upperbound) * i, 0);

                    // draw first half
                    this.c.beginPath();
                    this.c.arc(this.center[0], this.center[1], radius, 0.5 * Math.PI, 0.5 * Math.PI + Math.PI * powered,
                        false);
                    this.c.stroke();

                    // draw second half
                    this.c.beginPath();
                    this.c.arc(this.center[0], this.center[1], radius, 0.5 * Math.PI, 0.5 * Math.PI - Math.PI * powered,
                        true);
                    this.c.stroke();
                }

                // draw a thin outline of the circle
                this.c.beginPath();
                const origStyle = this.c.strokeStyle;
                this.c.strokeStyle = "#000000";
                this.c.lineWidth = 1;
                this.c.arc(this.center[0], this.center[1], this.minDim - 1, 0, 2 * Math.PI);
                this.c.stroke();
                this.c.strokeStyle = origStyle;
            }
        }
    });
}