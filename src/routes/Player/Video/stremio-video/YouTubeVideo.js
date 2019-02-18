var EventEmitter = require('events');
var HTMLSubtitles = require('./HTMLSubtitles');

function YouTubeVideo(containerElement) {
    if (!(containerElement instanceof HTMLElement)) {
        throw new Error('Instance of HTMLElement required as a first argument');
    }

    var self = this;
    var ready = false;
    var loaded = false;
    var destroyed = false;
    var events = new EventEmitter();
    var dispatchArgsReadyQueue = [];
    var dispatchArgsLoadedQueue = [];
    var pausedObserved = false;
    var timeObserved = false;
    var durationObserved = false;
    var bufferingObserved = false;
    var volumeObserved = false;
    var timeChangedIntervalId = window.setInterval(onTimeChangedInterval, 100);
    var durationChangedIntervalId = window.setInterval(onDurationChangedInterval, 100);
    var volumeChangedIntervalId = window.setInterval(onVolumeChangedInterval, 100);
    var subtitles = new HTMLSubtitles(containerElement);
    var video = null;
    // TODO handle script element
    var stylesElement = document.createElement('style');
    var videoContainer = document.createElement('div');

    subtitles.addListener('error', onSubtitlesError);
    subtitles.addListener('load', updateSubtitleText);
    containerElement.appendChild(stylesElement);
    stylesElement.sheet.insertRule('#' + containerElement.id + ' .video { position: absolute; width: 100%; height: 100%; z-index: -1; }', stylesElement.sheet.cssRules.length);
    containerElement.appendChild(videoContainer);
    videoContainer.classList.add('video');

    YT.ready(() => {
        if (destroyed) {
            return;
        }

        video = new YT.Player(videoContainer, {
            height: '100%',
            width: '100%',
            playerVars: {
                autoplay: 1,
                cc_load_policy: 3,
                controls: 0,
                disablekb: 1,
                enablejsapi: 1,
                fs: 0,
                iv_load_policy: 3,
                loop: 0,
                modestbranding: 1,
                playsinline: 1,
                rel: 0
            },
            events: {
                onError: onVideoError,
                onReady: onVideoReady,
                onStateChange: onVideoStateChange
            }
        });
    });

    function getPaused() {
        if (!loaded) {
            return null;
        }

        return video.getPlayerState() !== YT.PlayerState.PLAYING;
    }
    function getTime() {
        if (!loaded) {
            return null;
        }

        return Math.floor(video.getCurrentTime() * 1000);
    }
    function getDuration() {
        if (!loaded) {
            return null;
        }

        return Math.floor(video.getDuration() * 1000);
    }
    function getBuffering() {
        if (!loaded) {
            return null;
        }

        return video.getPlayerState() === YT.PlayerState.BUFFERING;
    }
    function getVolume() {
        if (!ready || destroyed) {
            return null;
        }

        return video.isMuted() ? 0 : video.getVolume();
    }
    function getSubtitleTracks() {
        if (!loaded) {
            return Object.freeze([]);
        }

        return subtitles.dispatch('getProp', 'tracks');
    }
    function getSelectedSubtitleTrackId() {
        if (!loaded) {
            return null;
        }

        return subtitles.dispatch('getProp', 'selectedTrackId');
    }
    function getSubtitleDelay() {
        if (!loaded) {
            return null;
        }

        return subtitles.dispatch('getProp', 'delay');
    }
    function getSubtitleSize() {
        if (!ready || destroyed) {
            return null;
        }

        return subtitles.dispatch('getProp', 'size');
    }
    function getSubtitleDarkBackground() {
        if (!ready || destroyed) {
            return null;
        }

        return subtitles.dispatch('getProp', 'darkBackground');
    }
    function onEnded() {
        events.emit('ended');
    }
    function onError(error) {
        Object.freeze(error);
        events.emit('error', error);
        if (error.critical) {
            self.dispatch('command', 'stop');
        }
    }
    function onPausedChanged() {
        events.emit('propChanged', 'paused', getPaused());
    }
    function onTimeChanged() {
        events.emit('propChanged', 'time', getTime());
    }
    function onDurationChanged() {
        events.emit('propChanged', 'duration', getDuration());
    }
    function onBufferingChanged() {
        events.emit('propChanged', 'buffering', getBuffering());
    }
    function onVolumeChanged() {
        events.emit('propChanged', 'volume', getVolume());
    }
    function onSubtitleTracksChanged() {
        events.emit('propChanged', 'subtitleTracks', getSubtitleTracks());
    }
    function onSelectedSubtitleTrackIdChanged() {
        events.emit('propChanged', 'selectedSubtitleTrackId', getSelectedSubtitleTrackId());
    }
    function onSubtitleDelayChanged() {
        events.emit('propChanged', 'subtitleDelay', getSubtitleDelay());
    }
    function onSubtitleSizeChanged() {
        events.emit('propChanged', 'subtitleSize', getSubtitleSize());
    }
    function onSubtitleDarkBackgroundChanged() {
        events.emit('propChanged', 'subtitleDarkBackground', getSubtitleDarkBackground());
    }
    function onSubtitlesError(error) {
        var message;
        switch (error.code) {
            case 70:
                message = 'Failed to fetch subtitles from ' + error.track.origin;
                break;
            case 71:
                message = 'Failed to parse subtitles from ' + error.track.origin;
                break;
            default:
                message = 'Unknown subtitles error';
        }

        onError({
            code: error.code,
            message: message,
            critical: false
        });
    }
    function onVideoError(error) {
        var message;
        switch (error.data) {
            case 2:
                message = 'Invalid request';
                break;
            case 5:
                message = 'The requested content cannot be played';
                break;
            case 100:
                message = 'The video has been removed or marked as private';
                break;
            case 101:
            case 150:
                message = 'The video cannot be played in embedded players';
                break;
            default:
                message = 'Unknown error';
        }

        onError({
            code: error.data,
            message: message,
            critical: true
        });
    }
    function onVideoReady() {
        ready = true;
        onVolumeChanged();
        onSubtitleSizeChanged();
        onSubtitleDarkBackgroundChanged();
        flushDispatchArgsQueue(dispatchArgsReadyQueue);
    }
    function onVideoStateChange(state) {
        if (bufferingObserved) {
            onBufferingChanged();
        }

        switch (state.data) {
            case YT.PlayerState.ENDED:
                onEnded();
                break;
            case YT.PlayerState.PAUSED:
            case YT.PlayerState.PLAYING:
                if (pausedObserved) {
                    onPausedChanged();
                }

                if (timeObserved) {
                    onTimeChanged();
                }

                if (durationObserved) {
                    onDurationChanged();
                }

                break;
            case YT.PlayerState.UNSTARTED:
                if (pausedObserved) {
                    onPausedChanged();
                }

                break;
        }
    }
    function onTimeChangedInterval() {
        updateSubtitleText();
        if (timeObserved) {
            onTimeChanged();
        }
    }
    function onDurationChangedInterval() {
        if (durationObserved) {
            onDurationChanged();
        }
    }
    function onVolumeChangedInterval() {
        if (volumeObserved) {
            onVolumeChanged();
        }
    }
    function updateSubtitleText() {
        subtitles.dispatch('command', 'updateText', getTime());
    }
    function flushDispatchArgsQueue(dispatchArgsQueue) {
        while (dispatchArgsQueue.length > 0) {
            var args = dispatchArgsQueue.shift();
            self.dispatch.apply(self, args);
        }
    }

    this.addListener = function(eventName, listener) {
        if (destroyed) {
            throw new Error('Unable to add ' + eventName + ' listener');
        }

        events.addListener(eventName, listener);
    };

    this.removeListener = function(eventName, listener) {
        if (destroyed) {
            throw new Error('Unable to remove ' + eventName + ' listener');
        }

        events.removeListener(eventName, listener);
    };

    this.dispatch = function() {
        console.log(Array.from(arguments).map(String))
        if (destroyed) {
            throw new Error('Unable to dispatch ' + arguments[0]);
        }

        switch (arguments[0]) {
            case 'observeProp':
                switch (arguments[1]) {
                    case 'paused':
                        events.emit('propValue', 'paused', getPaused());
                        pausedObserved = true;
                        return;
                    case 'time':
                        events.emit('propValue', 'time', getTime());
                        timeObserved = true;
                        return;
                    case 'duration':
                        events.emit('propValue', 'duration', getDuration());
                        durationObserved = true;
                        return;
                    case 'buffering':
                        events.emit('propValue', 'duration', getBuffering());
                        bufferingObserved = true;
                        return;
                    case 'volume':
                        events.emit('propValue', 'volume', getVolume());
                        volumeObserved = true;
                        return;
                    case 'subtitleTracks':
                        events.emit('propValue', 'subtitleTracks', getSubtitleTracks());
                        return;
                    case 'selectedSubtitleTrackId':
                        events.emit('propValue', 'selectedSubtitleTrackId', getSelectedSubtitleTrackId());
                        return;
                    case 'subtitleSize':
                        events.emit('propValue', 'subtitleSize', getSubtitleSize());
                        return;
                    case 'subtitleDelay':
                        events.emit('propValue', 'subtitleDelay', getSubtitleDelay());
                        return;
                    case 'subtitleDarkBackground':
                        events.emit('propValue', 'subtitleDarkBackground', getSubtitleDarkBackground());
                        return;
                    default:
                        throw new Error('observeProp not supported: ' + arguments[1]);
                }
            case 'setProp':
                switch (arguments[1]) {
                    case 'paused':
                        if (loaded) {
                            arguments[2] ? video.pauseVideo() : video.playVideo();
                        } else {
                            dispatchArgsLoadedQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'time':
                        if (loaded) {
                            if (!isNaN(arguments[2])) {
                                video.seekTo(arguments[2] / 1000);
                            }
                        } else {
                            dispatchArgsLoadedQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'volume':
                        if (ready) {
                            if (!isNaN(arguments[2])) {
                                video.unMute();
                                video.setVolume(Math.max(0, Math.min(100, arguments[2])));
                            }
                        } else {
                            dispatchArgsReadyQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'selectedSubtitleTrackId':
                        if (loaded) {
                            subtitles.dispatch('setProp', 'selectedTrackId', arguments[2]);
                            onSubtitleDelayChanged();
                            onSelectedSubtitleTrackIdChanged();
                            updateSubtitleText();
                        } else {
                            dispatchArgsLoadedQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'subtitleSize':
                        if (ready) {
                            subtitles.dispatch('setProp', 'size', arguments[2]);
                            onSubtitleSizeChanged();
                        } else {
                            dispatchArgsReadyQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'subtitleDelay':
                        if (loaded) {
                            subtitles.dispatch('setProp', 'delay', arguments[2]);
                            onSubtitleDelayChanged();
                            updateSubtitleText();
                        } else {
                            dispatchArgsLoadedQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'subtitleDarkBackground':
                        if (ready) {
                            subtitles.dispatch('setProp', 'darkBackground', arguments[2]);
                            onSubtitleDarkBackgroundChanged();
                        } else {
                            dispatchArgsReadyQueue.push(Array.from(arguments));
                        }
                        return;
                    default:
                        throw new Error('setProp not supported: ' + arguments[1]);
                }
            case 'command':
                switch (arguments[1]) {
                    case 'addSubtitleTracks':
                        if (loaded) {
                            subtitles.dispatch('command', 'addTracks', arguments[2]);
                            onSubtitleTracksChanged();
                        } else {
                            dispatchArgsLoadedQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'mute':
                        if (ready) {
                            video.mute();
                        } else {
                            dispatchArgsReadyQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'unmute':
                        if (ready) {
                            video.unMute();
                            if (video.getVolume() === 0) {
                                video.setVolume(50);
                            }
                        } else {
                            dispatchArgsReadyQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'stop':
                        loaded = false;
                        dispatchArgsLoadedQueue = [];
                        subtitles.dispatch('command', 'clearTracks');
                        if (ready) {
                            video.stopVideo();
                        }
                        onPausedChanged();
                        onTimeChanged();
                        onDurationChanged();
                        onBufferingChanged();
                        onSubtitleTracksChanged();
                        onSelectedSubtitleTrackIdChanged();
                        onSubtitleDelayChanged();
                        updateSubtitleText();
                        return;
                    case 'load':
                        if (ready) {
                            debugger;
                            var dispatchArgsLoadedQueueCopy = dispatchArgsLoadedQueue.slice();
                            self.dispatch('command', 'stop');
                            dispatchArgsLoadedQueue = dispatchArgsLoadedQueueCopy;
                            var autoplay = typeof arguments[3].autoplay === 'boolean' ? arguments[3].autoplay : true;
                            var time = !isNaN(arguments[3].time) ? arguments[3].time / 1000 : 0;
                            if (autoplay) {
                                video.loadVideoById({
                                    videoId: arguments[2].ytId,
                                    startSeconds: time
                                });
                            } else {
                                video.cueVideoById({
                                    videoId: arguments[2].ytId,
                                    startSeconds: time
                                });
                            }
                            loaded = true;
                            onPausedChanged();
                            onTimeChanged();
                            onDurationChanged();
                            onBufferingChanged();
                            onSubtitleDelayChanged();
                            updateSubtitleText();
                            flushDispatchArgsQueue(dispatchArgsLoadedQueue);
                        } else {
                            dispatchArgsReadyQueue.push(Array.from(arguments));
                        }
                        return;
                    case 'destroy':
                        self.dispatch('command', 'stop');
                        destroyed = true;
                        onVolumeChanged();
                        onSubtitleSizeChanged();
                        onSubtitleDarkBackgroundChanged();
                        events.removeAllListeners();
                        clearInterval(timeChangedIntervalId);
                        clearInterval(durationChangedIntervalId);
                        clearInterval(volumeChangedIntervalId);
                        video.destroy();
                        containerElement.removeChild(videoElement);
                        containerElement.removeChild(stylesElement);
                        subtitles.dispatch('command', 'destroy');
                        return;
                    default:
                        throw new Error('command not supported: ' + arguments[1]);
                }
            default:
                throw new Error('Invalid dispatch call: ' + Array.from(arguments).map(String));
        }
    };

    Object.freeze(this);
};

YouTubeVideo.manifest = Object.freeze({
    name: 'YouTubeVideo',
    embedded: true,
    props: Object.freeze(['paused', 'time', 'duration', 'volume', 'buffering', 'subtitleTracks', 'selectedSubtitleTrackId', 'subtitleSize', 'subtitleDelay', 'subtitleDarkBackground'])
});

Object.freeze(YouTubeVideo);

module.exports = YouTubeVideo;
