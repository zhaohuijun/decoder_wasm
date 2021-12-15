var webglPlayer, canvas, videoWidth, videoHeight, yLength, uvLength;
var LOG_LEVEL_JS = 0;
var LOG_LEVEL_WASM = 1;
var LOG_LEVEL_FFMPEG = 2;
var DECODER_H264 = 0;
var DECODER_H265 = 1;

var decoder_type = DECODER_H265;

var needStop;

function handleVideoFiles(files, type) {
    decoder_type = type;
    var file_list = files;
    var file_idx = 0;
    needStop = false
    decode_seq(file_list, file_idx);
}

async function decode_seq(file_list, file_idx) {
    if (file_idx >= file_list.length)
        return;
    var file = file_list[file_idx];
    var start_time = new Date();

    var buffer = []

    var videoSize = 0;
    var videoCallback = Module.addFunction(function (addr_y, addr_u, addr_v, stride_y, stride_u, stride_v, width, height, pts) {
        console.log("[%d]In video callback, size = %d * %d, pts = %d", ++videoSize, width, height, pts)
        let size = width * height + (width / 2)  * (height / 2) + (width / 2)  * (height / 2)
        let data = new Uint8Array(size)
        let pos = 0
        for(let i=0; i< height; i++) {
            let src = addr_y + i * stride_y
            let tmp = HEAPU8.subarray(src, src + width)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_u + i * stride_u
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        for(let i=0; i< height / 2; i++) {
            let src = addr_v + i * stride_v
            let tmp = HEAPU8.subarray(src, src + width / 2)
            tmp = new Uint8Array(tmp)
            data.set(tmp, pos)
            pos += tmp.length
        }
        var obj = {
            data: data,
            width,
            height
        }
        buffer.push(obj)
    });
    var play = () => {
        if (buffer.length > 0) {
            var o = buffer.shift()
            displayVideoFrame(o)
            displayVideoFrame2(o)
        }
        if (!needStop) {
            setTimeout(() => {
                play()
            }, 30);
        }
    }
    if (!needStop) {
        play()
    }

    var ret = Module._openDecoder(decoder_type, videoCallback, LOG_LEVEL_WASM)
    if(ret == 0) {
        console.log("openDecoder success");
    } else {
        console.error("openDecoder failed with error", ret);
        return;
    }

    var readerIndex = 0
    var CHUNK_SIZE = 128;
    var i_stream_size = 0;
    var filePos = 0;
    var totalSize = 0
    var pts = 0

    var reader = new FileReader()
    reader.addEventListener('load', e => {
        // console.log('on load:', e, file)
        if (needStop) {
            return
        }
        var typedArray = new Uint8Array(e.target.result);
        var size = typedArray.length
        var cacheBuffer = Module._malloc(size);
        Module.HEAPU8.set(typedArray, cacheBuffer);
        // console.log("[" + (++readerIndex) + "] Read len = ", size + ", Total size = " + totalSize)

        Module._decodeData(cacheBuffer, size, pts++)
        if (cacheBuffer != null) {
            Module._free(cacheBuffer);
            cacheBuffer = null;
        }
        if(size < CHUNK_SIZE || filePos >= file.size) {
            console.log('Flush frame data')
            Module._flushDecoder();
            Module._closeDecoder();
        }
        if (needStop) {
            return
        }
        var rf = () => {
            if (buffer.length > 2) {
                setTimeout(rf, 10);
            } else {
                var n = readFile(reader, file, filePos, CHUNK_SIZE)
                filePos += n
            }
        }
        rf()
    })
    var n = readFile(reader, file, filePos, CHUNK_SIZE)
    filePos += n

}

function readFile(reader, file, offset, chunkSize) {
    var end = offset + chunkSize
    var total = file.size
    if (end > total) {
        end = total
    }
    if (end <= offset) {
        return 0
    }
    var s
    if (file.slice) {
        s = file.slice(offset, end)
    } else if (file.mozSlice) {
        s = file.mozSlice(offset, end)
    } else if (file.webkitSlice) {
        s = file.webkitSlice(offset, end)
    } else {
        return 0
    }
    reader.readAsArrayBuffer(s)
    return end - offset
}

function displayVideoFrame(obj) {
    var data = new Uint8Array(obj.data);
    var width = obj.width;
    var height = obj.height;
    var yLength = width * height;
    var uvLength = (width / 2) * (height / 2);
    if(!webglPlayer) {
        const canvasId = "playCanvas";
        canvas = document.getElementById(canvasId);
        webglPlayer = new WebGLPlayer(canvas, {
            preserveDrawingBuffer: false
        });
    }
    webglPlayer.renderFrame(data, width, height, yLength, uvLength);
}

var tm = 0
function displayVideoFrame2(obj) {
    var now = Number(new Date())
    if (!tm) {
        tm = now
    }
    console.log('display:', now - tm, obj)
}

function stop() {
    console.log('stop')
    needStop = true
}