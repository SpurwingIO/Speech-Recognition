const fs = require("fs");
const util = require('util');
const { Readable } = require('stream');

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { path: "/Spurwing/audio/socket.io"});

const port = 8002;
const host = '0.0.0.0'; // or localhost
http.listen(port, host, () => {
  console.log('listening on *:' + port);
});

app.use('/Spurwing/audio/', express.static('public'))

app.use(function(req, res) {
  console.error(404, req.url)
  res.status(404)
  res.send('404 not found.')
})

app.use(function(err, req, res, next) {
  console.error(err)
  res.status(500);
  res.send('500 something went wrong')
})

io.of('/').on('connection', function(socket) {
  socket.on('stream', async function(data) {
    // console.log(data.length)
    // write_output_mp3(data) // for debugging purposes
    let out = await transcribe_witai(data)
    if (out.length)
      socket.emit('text', {raw:out, nlp:nlp(out)})
  });
});

io.on('connection', (socket) => {
  console.log('connection');
  socket.on('disconnect', () => {
    console.log('disconnect');
  });
});

const moment = require('moment');
const lame = require("@suldashi/lame");
const path = require('path');
async function write_output_mp3(buffer) {
    let encoder = new lame.Encoder({
      // input
      channels: 1,        // 2 channels (left and right)
      bitDepth: 16,       // 16-bit samples
      sampleRate: 44100,  // 44,100 Hz sample rate     
      // output
      mode: lame.MONO // STEREO (default), JOINTSTEREO, DUALCHANNEL or MONO
    });
    Readable.from(buffer).pipe(encoder)
          .pipe(fs.createWriteStream(path.resolve(__dirname, 'public/sample_pcm.mp3')));
}

const { wordsToNumbers } = require('words-to-numbers');
const chrono = require('chrono-node');
function nlp(text){
  return chrono.parseDate(wordsToNumbers(text),
    // moment().utcOffset((new Date()).getTimezoneOffset())
  );
}

// WitAI
let witAI_lastcallTS = null;
const {WITAPIKEY} = require('./config.json');
const witClient = require('node-witai-speech');

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function transcribe_witai(buffer) {
    try {
        // ensure we do not send more than one request per second
        if (witAI_lastcallTS != null) {
            let now = Math.floor(new Date());    
            while (now - witAI_lastcallTS < 1000) {
                await sleep(100);
                now = Math.floor(new Date());
            }
        }
    } catch (e) {
        console.log('transcribe_witai 837:' + e)
    }

    try {
        const extractSpeechIntent = util.promisify(witClient.extractSpeechIntent);
        let stream = Readable.from(buffer);
        const contenttype = "audio/wav"
        const output = await extractSpeechIntent(WITAPIKEY, stream, contenttype)
        witAI_lastcallTS = Math.floor(new Date());
        stream.destroy()
        if (output && '_text' in output)
            return output._text
        if (output && 'text' in output)
            return output.text
        return output;
    } catch (e) { console.log('transcribe_witai 851:' + e); console.log(e) }
}

