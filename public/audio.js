const SpurwingAudio = (function() {
  'use strict';
  
  let audioContext = null;
  let stream = null;
  let audioStream = null;
  let vad = null;


  this.init = async function(reverb) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext();

      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      audioStream = await audioContext.createMediaStreamSource( stream );
      if (reverb) // hear yourself, for testing purposes
        audioStream.connect( audioContext.destination ); 
    } catch(err) {
      console.error('no audio permissions', err)
      throw err;
    }
  }
  // start Voice Activity Detection
  this.startVAD = function(voice_start, voice_end) {
    const options = {
      source: audioStream,
      energy_threshold_ratio_pos: 2, // sensitivity for start
      energy_threshold_ratio_neg: 0.9, // sensitivity for stop
      voice_stop: (buffer) => {
        // console.log('voice_stop', buffer)
        const duration = buffer.byteLength / vad.options.context.sampleRate / 4; // seconds
        if (voice_end) voice_end(buffer, duration);
      },
      voice_start: () => {
        // console.log('voice_start')
        if (voice_start) voice_start();
      }
    };
    vad = new window.VADRecord(options);
  }
  this.end = function() {
    stream.getTracks().forEach(function(track) {
      track.stop();
    });
  }
  this.getAudioContext = function() {
    return audioContext;
  }
  this.getAudioStream = function() {
    return audioStream;
  }

  return this;
});