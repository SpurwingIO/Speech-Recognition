(function (window) {
    var VADRecord = function (options) {
        var currentIndex = 0;
        var startIndex = 0;
        var recLength = 0;
        var recBuffers = [];
        var numChannels = 1;
        var sampleRate = null;
        function mergeBuffers(channelBuffer, recordingLength, startIndex, bufferLen) {
            var result = new Float32Array(recordingLength - startIndex);
            var offset = 0;
            var lng = channelBuffer.length;
            var startI = startIndex / bufferLen;
            for (var i = startI; i < lng; i++) {
                var buffer = channelBuffer[i];
                result.set(buffer, offset);
                offset += buffer.length;
            }
            return result;
        }
        function interleave(inputL, inputR) {
            let length = inputL.length + inputR.length;
            let result = new Float32Array(length);
            let index = 0, inputIndex = 0;
            while (index < length) {
                result[index++] = inputL[inputIndex];
                result[index++] = inputR[inputIndex];
                inputIndex++;
            }
            return result;
        }
        function writeUTFBytes(view, offset, string) {
            var lng = string.length;
            for (var i = 0; i < lng; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }
        function floatTo16BitPCM(output, offset, input) {
            for (let i = 0; i < input.length; i++, offset += 2) {
                let s = Math.max(-1, Math.min(1, input[i]));
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
        }
        function encodeWAV(samples) {
            var buffer = new ArrayBuffer(44 + samples.length * 2);
            let view = new DataView(buffer);
            /* RIFF identifier */
            writeString(view, 0, 'RIFF');
            /* RIFF chunk length */
            view.setUint32(4, 36 + samples.length * 2, true);
            /* RIFF type */
            writeString(view, 8, 'WAVE');
            /* format chunk identifier */
            writeString(view, 12, 'fmt ');
            /* format chunk length */
            view.setUint32(16, 16, true);
            /* sample format (raw) */
            view.setUint16(20, 1, true);
            /* channel count */
            view.setUint16(22, numChannels, true);
            /* sample rate */
            view.setUint32(24, sampleRate, true);
            /* byte rate (sample rate * block align) */
            view.setUint32(28, sampleRate * 4, true);
            /* block align (channel count * bytes per sample) */
            view.setUint16(32, numChannels * 2, true);
            /* bits per sample */
            view.setUint16(34, 16, true);
            /* data chunk identifier */
            writeString(view, 36, 'data');
            /* data chunk length */
            view.setUint32(40, samples.length * 2, true);
            floatTo16BitPCM(view, 44, samples);
            return buffer;
        }
        function clear() {
            recLength = 0;
            recBuffers = [];
            initBuffers();
        }
        function initBuffers() {
            for (let channel = 0; channel < numChannels; channel++) {
                recBuffers[channel] = [];
            }
        }
        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }
        this.dispose = function () {
            if (this.options.source) {
                this.options.source.disconnect();
            }
            if (this.analyser) {
                this.analyser.disconnect();
            }
            if (this.scriptProcessorNode) {
                this.scriptProcessorNode.onaudioprocess = null;
                this.scriptProcessorNode.disconnect();
            }
            this.options.source = null;
            this.analyser = null;
            this.scriptProcessorNode = null;
        };
        this.buildAudioRecord = function () {
            let buffers = [];
            for (let channel = 0; channel < numChannels; channel++) {
                buffers.push(mergeBuffers(recBuffers[channel], recLength, startIndex, this.options.bufferLen));
            }
            var interleaved;
            if (numChannels === 2) {
                interleaved = interleave(buffers[0], buffers[1]);
            }
            else {
                interleaved = buffers[0];
            }
            var buffer = encodeWAV(interleaved);
            return buffer;
        };
        // Default options
        this.options = {
            fftSize: 512,
            bufferLen: 512,
            voice_stop: function () { },
            voice_start: function () { },
            smoothingTimeConstant: 0.99,
            energy_offset: 1e-8,
            energy_threshold_ratio_pos: 2,
            energy_threshold_ratio_neg: 0.5,
            energy_integration: 1,
            filter: [
                { f: 200, v: 0 },
                { f: 2000, v: 1 } // 200 -> 2k is 1
            ],
            source: null,
            context: null
        };
        // User options
        for (var option in options) {
            if (options.hasOwnProperty(option)) {
                this.options[option] = options[option];
            }
        }
        clear();
        // Require source
        if (!this.options.source)
            throw new Error("The options must specify a MediaStreamAudioSourceNode.");
        // Set this.options.context
        this.options.context = this.options.source.context;
        // Calculate time relationships
        this.hertzPerBin = this.options.context.sampleRate / this.options.fftSize;
        this.iterationFrequency = this.options.context.sampleRate / this.options.bufferLen;
        this.iterationPeriod = 1 / this.iterationFrequency;
        sampleRate = this.options.context.sampleRate;
        var DEBUG = true;
        if (DEBUG)
            console.log('Vad' +
                ' | sampleRate: ' + this.options.context.sampleRate +
                ' | hertzPerBin: ' + this.hertzPerBin +
                ' | iterationFrequency: ' + this.iterationFrequency +
                ' | iterationPeriod: ' + this.iterationPeriod);
        this.setFilter = function (shape) {
            this.filter = [];
            for (var i = 0, iLen = this.options.fftSize / 2; i < iLen; i++) {
                this.filter[i] = 0;
                for (var j = 0, jLen = shape.length; j < jLen; j++) {
                    if (i * this.hertzPerBin < shape[j].f) {
                        this.filter[i] = shape[j].v;
                        break; // Exit j loop
                    }
                }
            }
        };
        this.setFilter(this.options.filter);
        this.ready = {};
        this.vadState = false; // True when Voice Activity Detected
        // Energy detector props
        this.energy_offset = this.options.energy_offset;
        this.energy_threshold_pos = this.energy_offset * this.options.energy_threshold_ratio_pos;
        this.energy_threshold_neg = this.energy_offset * this.options.energy_threshold_ratio_neg;
        this.voiceTrend = 0;
        this.voiceTrendMax = 10;
        this.voiceTrendMin = -10;
        this.voiceTrendStart = 5;
        this.voiceTrendEnd = -5;
        // Create analyser 
        this.analyser = this.options.context.createAnalyser();
        this.analyser.smoothingTimeConstant = this.options.smoothingTimeConstant; // 0.99;
        this.analyser.fftSize = this.options.fftSize;
        this.floatFrequencyData = new Float32Array(this.analyser.frequencyBinCount);
        // Setup local storage of the Linear FFT data
        this.floatFrequencyDataLinear = new Float32Array(this.floatFrequencyData.length);
        // Connect this.analyser
        this.options.source.connect(this.analyser);
        // Create ScriptProcessorNode
        this.scriptProcessorNode = this.options.context.createScriptProcessor(this.options.bufferLen, numChannels, numChannels);
        // Connect scriptProcessorNode (Theretically, not required)
        this.scriptProcessorNode.connect(this.options.context.destination);
        // Create callback to update/analyze floatFrequencyData
        var self = this;
        this.scriptProcessorNode.onaudioprocess = function (event) {
            self.analyser.getFloatFrequencyData(self.floatFrequencyData);
            self.update();
            self.store(event);
            self.monitor();
        };
        // Connect scriptProcessorNode
        this.options.source.connect(this.scriptProcessorNode);
        // log stuff
        this.logging = false;
        this.log_i = 0;
        this.log_limit = 100;
        this.triggerLog = function (limit) {
            this.logging = true;
            this.log_i = 0;
            this.log_limit = typeof limit === 'number' ? limit : this.log_limit;
        };
        this.log = function (msg) {
            if (this.logging && this.log_i < this.log_limit) {
                this.log_i++;
                console.log(msg);
            }
            else {
                this.logging = false;
            }
        };
        this.store = function (event) {
            for (var channel = 0; channel < numChannels; channel++) {
                recBuffers[channel].push(new Float32Array(event.inputBuffer.getChannelData(channel)));
            }
            recLength += this.options.bufferLen;
        };
        this.update = function () {
            // Update the local version of the Linear FFT
            var fft = this.floatFrequencyData;
            for (var i = 0, iLen = fft.length; i < iLen; i++) {
                this.floatFrequencyDataLinear[i] = Math.pow(10, fft[i] / 10);
            }
            this.ready = {};
        };
        this.getEnergy = function () {
            if (this.ready.energy) {
                return this.energy;
            }
            var energy = 0;
            var fft = this.floatFrequencyDataLinear;
            for (var i = 0, iLen = fft.length; i < iLen; i++) {
                energy += this.filter[i] * fft[i] * fft[i];
            }
            this.energy = energy;
            this.ready.energy = true;
            return energy;
        };
        this.monitor = function () {
            var energy = this.getEnergy();
            var signal = energy - this.energy_offset;
            if (signal > this.energy_threshold_pos) {
                this.voiceTrend = (this.voiceTrend + 1 > this.voiceTrendMax) ? this.voiceTrendMax : this.voiceTrend + 1;
            }
            else if (signal < -this.energy_threshold_neg) {
                this.voiceTrend = (this.voiceTrend - 1 < this.voiceTrendMin) ? this.voiceTrendMin : this.voiceTrend - 1;
            }
            else {
                // voiceTrend gets smaller
                if (this.voiceTrend > 0) {
                    this.voiceTrend--;
                }
                else if (this.voiceTrend < 0) {
                    this.voiceTrend++;
                }
            }
            var start = false, end = false;
            if (this.voiceTrend > this.voiceTrendStart) {
                // Start of speech detected
                start = true;
            }
            else if (this.voiceTrend < this.voiceTrendEnd) {
                // End of speech detected
                end = true;
            }
            // Integration brings in the real-time aspect through the relationship with the frequency this functions is called.
            var integration = signal * this.iterationPeriod * this.options.energy_integration;
            // Idea?: The integration is affected by the voiceTrend magnitude? - Not sure. Not doing atm.
            // The !end limits the offset delta boost till after the end is detected.
            if (integration > 0 || !end) {
                this.energy_offset += integration;
            }
            else {
                this.energy_offset += integration * 10;
            }
            this.energy_offset = this.energy_offset < 0 ? 0 : this.energy_offset;
            this.energy_threshold_pos = this.energy_offset * this.options.energy_threshold_ratio_pos;
            this.energy_threshold_neg = this.energy_offset * this.options.energy_threshold_ratio_neg;
            // Broadcast the messages
            if (start && !this.vadState) {
                this.vadState = true;
                startIndex = recLength - this.options.bufferLen * 128;
                if (startIndex < 0)
                    startIndex = 0;
                this.options.voice_start();
            }
            if (end && this.vadState) {
                this.vadState = false;
                var recordedAudio = this.buildAudioRecord();
                clear();
                this.options.voice_stop(recordedAudio);
            }
            this.log('e: ' + energy +
                ' | e_of: ' + this.energy_offset +
                ' | e+_th: ' + this.energy_threshold_pos +
                ' | e-_th: ' + this.energy_threshold_neg +
                ' | signal: ' + signal +
                ' | int: ' + integration +
                ' | voiceTrend: ' + this.voiceTrend +
                ' | start: ' + start +
                ' | end: ' + end);
            return signal;
        };
    };
    window.VADRecord = VADRecord;
})(window);