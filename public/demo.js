$(document).ready(() => {
    "use strict";
    let start = false;
    let path;
    let seconds = 0;
    let loud_volume_threshold = 25;
    let transcribeID = 0;
    const spa = new SpurwingAudio();
    
    function addLog(text) {
        $('.logger').append('<div>'+text+'</div>')
    }
    function processStream(stream) {
        let analyser = spa.getAudioContext().createAnalyser();
        analyser.fftSize = 1024;
        spa.getAudioStream().connect(analyser);
        let bufferLength = analyser.frequencyBinCount;
        let frequencyArray = new Uint8Array(bufferLength);
        
        $('#visualizer').attr('viewBox', '0 0 255 255');
        for (let i = 0 ; i < 255; i++) {
            path = $(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
            path.attr('stroke-dasharray', '4,1');
            $('#mask').append(path);
        }

        let socket = io(SpurwingWSURL, {
          path: "/audio/socket.io"
        });
        socket.on('text', data => {
            console.log(data)
            $('#tid'+data.id).text(JSON.stringify(data))
        })
        spa.startVAD(()=>addLog('recording'), (buffer, duration) => {
            duration = (Math.round(duration*100)/100);
            if (duration <= 1.5 || duration >= 20.0) {
                addLog('<p>skip processing, audio too '+(duration >= 20 ? 'long':'short')+' ('+duration+' sec)</p>');
            } else {
                socket.emit('stream', {buffer, id:transcribeID})
                addLog('<p>processing ('+duration+' sec)... <span id="tid'+transcribeID+'"></span></p>')
                ++transcribeID;
            }
        })

        drawSpectro(analyser, frequencyArray);
        showVolume(analyser, frequencyArray, drawSpectro, bufferLength);
    }

    function drawSpectro(analyser, frequencyArray) {
        requestAnimationFrame(() => {drawSpectro(analyser, frequencyArray)});
        if (start) {
            analyser.getByteFrequencyData(frequencyArray);
            let adjustedLength;
            for (let i = 0 ; i < 255; i++) {
                adjustedLength = Math.floor(frequencyArray[i]) - (Math.floor(frequencyArray[i]) % 5);
                $('path').eq(i).attr('d', 'M '+ (i) +',255 l 0,-' + adjustedLength);
            }
        }
        else {
            for (let i = 0 ; i < 255; i++) {
                $('path').eq(i).attr('d', 'M '+ (i) +',255 l 0,-' + 0);
            }
        }
    }
    function showVolume(analyser, frequencyArray, drawSpectro, bufferLength) {
        setTimeout(()=>{showVolume(analyser, frequencyArray, drawSpectro, bufferLength)}, 500);
        if (start) {
            analyser.getByteFrequencyData(frequencyArray);
            let total = 0
            for(let i = 0; i < 255; i++) {
               let x = frequencyArray[i];
               total += x * x;
            }
            let rms = Math.sqrt(total / bufferLength);
            let db = 20 * ( Math.log(rms) / Math.log(10) );
            db = Math.max(db, 0); // sanity check
            $('.main-text').html(Math.floor(db) + " dB");

            if (db >= loud_volume_threshold) {
                seconds += 0.5;
                if (seconds >= 5) {
                    $('.sub-text').html("You've been in loud environment for<span> " + Math.floor(seconds) + " </span>seconds.");
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
    $('#button').on('click', async () => {
        if (start) {
            start = false;
            $('#button').html("<span class='fa fa-play'></span>Start Listen");
            $('#button').attr('class', 'green-button');
            spa.end();
        }
        else {
            spa.init().then((stream) => {
                start = true;
                $('#button').html("<span class='fa fa-stop'></span>Stop Listen");
                $('#button').attr('class', 'red-button');
                processStream(stream);
            }).catch((err) => {
                $('.main-text').html("You must allow your microphone.");
                console.log(error);
            });
        }
    });
});