$(document).ready(() => {
    "use strict";
    var audioContext;
    var start = false;
    var permission = false;
    var path;
    var seconds = 0;
    var loud_volume_threshold = 25;
    
    var soundAllowed = function (stream) {
        permission = true;
        var audioStream = audioContext.createMediaStreamSource( stream );
        //audioStream.connect( audioContext.destination ); // hear yourself


        var analyser = audioContext.createAnalyser();
        var fftSize = 1024;
        console.log(analyser)

        analyser.fftSize = fftSize;
        audioStream.connect(analyser);

        var bufferLength = analyser.frequencyBinCount;
        var frequencyArray = new Uint8Array(bufferLength);
        
        $('#visualizer').attr('viewBox', '0 0 255 255');
      
        for (var i = 0 ; i < 255; i++) {
            path = $(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
            path.attr('stroke-dasharray', '4,1');
            $('#mask').append(path);
        }

        var drawSpectro = function () {
            requestAnimationFrame(drawSpectro);
            if (start) {
                analyser.getByteFrequencyData(frequencyArray);
                var adjustedLength;
                for (var i = 0 ; i < 255; i++) {
                    adjustedLength = Math.floor(frequencyArray[i]) - (Math.floor(frequencyArray[i]) % 5);
                    $('path').eq(i).attr('d', 'M '+ (i) +',255 l 0,-' + adjustedLength);
                }
            }
            else {
                for (var i = 0 ; i < 255; i++) {
                    $('path').eq(i).attr('d', 'M '+ (i) +',255 l 0,-' + 0);
                }
            }
        }
        var showVolume = function () {
            setTimeout(showVolume, 500);
            if (start) {
                analyser.getByteFrequencyData(frequencyArray);
                var total = 0
                for(var i = 0; i < 255; i++) {
                   var x = frequencyArray[i];
                   total += x * x;
                }
                var rms = Math.sqrt(total / bufferLength);
                var db = 20 * ( Math.log(rms) / Math.log(10) );
                db = Math.max(db, 0); // sanity check
                $('.main-text').html(Math.floor(db) + " dB");
    
                if (db >= loud_volume_threshold) {
                    seconds += 0.5;
                    if (seconds >= 5) {
                        $('.sub-text').html("Youâ€™ve been in loud environment for<span> " + Math.floor(seconds) + " </span>seconds.");
                    }
                }
                else {
                    seconds = 0;
                    $('.sub-text').html("");
                }
            }
            else {
                $('.main-text').html("");
                $('.sub-text').html("");
            }
        }

        var options = {
            source: audioStream,
            voice_stop: (buffer) => {
                console.log('voice_stop', buffer)
                //console.log(_vad)
                //transcribe(buffer)
                socket.emit('stream', buffer)
            },
            voice_start: () => {
                console.log('voice_start')
            }
        };
        var _vad = new window.VADRecord(options);
        function recognizeAudio(buffer) {s
            console.log('recognizeAudio')
        }

        let socket = io({
          path: "/Spurwing/audio/socket.io"
        });
        socket.on('text', text => {
            console.log(text)
        })

        drawSpectro();
        showVolume();
    }

    var soundNotAllowed = function (error) {
        $('.main-text').html("You must allow your microphone.");
        console.log(error);
    }


    $('#button').on('click', () => {
        if (start) {
            start = false;
            $(this).html("<span class='fa fa-play'></span>Start Listen");
            $(this).attr('class', 'green-button');
        }
        else {
            if (!permission) {
                navigator.mediaDevices.getUserMedia({audio:true})
                    .then(soundAllowed)
                    .catch(soundNotAllowed);

                const AudioContext = window.AudioContext || window.webkitAudioContext;
                audioContext = new AudioContext();
            }
            start = true;
            $(this).html("<span class='fa fa-stop'></span>Stop Listen");
            $(this).attr('class', 'red-button');
        }
    });
});